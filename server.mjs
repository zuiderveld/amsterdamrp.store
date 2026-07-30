import "dotenv/config";
import express from "express";
import cookieSession from "cookie-session";
import cookieParser from "cookie-parser";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import {
  packagesToCatalog,
  paymentsToRecent,
  fetchTebexPackages,
  fetchTebexPayments,
  createCheckout,
  completeCheckout,
  getTebexSecret,
  getTebexPublicToken,
} from "./lib/tebex.mjs";
import {
  getTebexwrapperPath,
  readRedeemPackages,
  annotateCatalogWithRedeem,
  readIngameStoreCatalog,
  ingameStoreToWebCatalog,
  mergeWebAndIngameCatalog,
  syncCatalogToTebexwrapper,
  upsertWebStoreProduct,
  writeRedeemPackagesOverlay,
  removeWebStoreProduct,
  annotateCatalogVisibility,
  isProductVisible,
  setProductVisibility,
  setManyProductsVisibility,
  readProductVisibility,
} from "./lib/tebexwrapper.mjs";
import {
  readRoleGrants,
  writeRoleGrants,
  upsertPackageRoleGrant,
  syncRoleGrantsToTebexwrapper,
  grantDiscordRoles,
  roleIdsForPackages,
  markRolesClaimed,
  alreadyClaimed,
  getDiscordBotToken,
  getDiscordGuildIdForRoles,
} from "./lib/discord-roles.mjs";

import {
  createNativeOrder,
  getCheckoutProvider,
  listOrders,
  updateOrder,
  getOrder,
} from "./lib/orders.mjs";
import {
  isStripeConfigured,
  createStripeCheckoutSession,
  retrieveStripeSession,
} from "./lib/stripe.mjs";
import {
  createClaimForOrder,
  getClaimByOrderId,
  redeemClaimCode,
} from "./lib/claims.mjs";
import {
  hasDurableSettingsStore,
  loadSettingsAsync,
  saveSettingsAsync,
  readSettingsFile,
  seedCatalogFallback,
} from "./lib/persist.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DATA = path.join(__dirname, "data");
const DATA =
  process.env.VERCEL === "1"
    ? path.join("/tmp", "amsterdamrp-data")
    : SEED_DATA;

// Seed /tmp data from repo on cold start (Vercel filesystem is ephemeral)
function ensureDataFiles() {
  if (process.env.VERCEL !== "1") return;
  fs.mkdirSync(DATA, { recursive: true });
  for (const file of [
    "settings.json",
    "catalog.json",
    "leaderboards.json",
    "payments.json",
    "role-grants.json",
    "announcement.json",
    "claims.json",
    "orders.json",
  ]) {
    const dest = path.join(DATA, file);
    const src = path.join(SEED_DATA, file);
    if (!fs.existsSync(src)) continue;
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
      continue;
    }
    // Re-seed empty catalog so admin/shop never stay blank after a bad /tmp write
    if (file === "catalog.json") {
      try {
        const cur = JSON.parse(fs.readFileSync(dest, "utf8"));
        if (!cur?.categories?.length) fs.copyFileSync(src, dest);
      } catch {
        fs.copyFileSync(src, dest);
      }
    }
  }
}
ensureDataFiles();
const app = express();
const PORT = process.env.PORT || 5173;

const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || "1521182074118082599";
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "";
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "";
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || "";
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const SESSION_SECRET = process.env.SESSION_SECRET || "AmsterdamRP-dev-secret-change-me";
const DEV_ADMIN_BYPASS = process.env.DEV_ADMIN_BYPASS === "1";

function readJson(file, fallback) {
  const p = path.join(DATA, file);
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    // Fall back to repo seed (important on Vercel when /tmp is empty/corrupt)
    try {
      return JSON.parse(fs.readFileSync(path.join(SEED_DATA, file), "utf8"));
    } catch {
      return structuredClone(fallback);
    }
  }
}

function writeJson(file, data) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, file), JSON.stringify(data, null, 2), "utf8");
}

const defaultSettings = () => ({
  maintenance: false,
  maintenanceMessage: "We zijn even bezig met onderhoud. Kom zo terug!",
  sitePublic: true,
  announcement: "",
  announcementEnabled: false,
  server: { name: "Amsterdam Roleplay", online: 0, max: 512, onlineMode: "live" },
  discordMembers: 0,
  discordInvite: "https://discord.gg/rRSeCBb25A",
  cfxJoin: "https://cfx.re/join/pga9aey",
  cfxCode: "pga9aey",
  adminRoleId: ADMIN_ROLE_ID,
  guildId: DISCORD_GUILD_ID,
  // Alle betaalmethodes standaard UIT → checkout stuurt naar Discord
  payments: {
    stripe: false,
    tebex: false,
  },
});

function normalizeSettings(s) {
  s.adminRoleId = ADMIN_ROLE_ID;
  if (DISCORD_GUILD_ID) s.guildId = DISCORD_GUILD_ID;
  if (!s.cfxCode && s.cfxJoin) {
    const m = String(s.cfxJoin).match(/join\/([a-z0-9]+)/i);
    if (m) s.cfxCode = m[1];
  }
  s.payments = {
    stripe: false,
    tebex: false,
    ...(s.payments && typeof s.payments === "object" ? s.payments : {}),
  };
  s.payments.stripe = Boolean(s.payments.stripe);
  s.payments.tebex = Boolean(s.payments.tebex);
  return s;
}

function getEnabledPaymentMethods(settings = getSettings()) {
  const p = settings.payments || {};
  return {
    stripe: Boolean(p.stripe) && isStripeConfigured(),
    tebex: Boolean(p.tebex) && Boolean(getTebexSecret() || getTebexPublicToken()),
    stripeConfigured: isStripeConfigured(),
    anyEnabled: (Boolean(p.stripe) && isStripeConfigured()) || (Boolean(p.tebex) && Boolean(getTebexSecret() || getTebexPublicToken())),
  };
}

async function fulfillPaidOrder({ order, userId }) {
  if (!order) return { granted: [], claim: null };
  const packageIds = (order.items || []).map((i) => Number(i.id)).filter((id) => id > 0);
  const { roleIds, matchedPackages } = roleIdsForPackages(packageIds);
  let granted = [];
  if (roleIds.length && userId) {
    const grant = await grantDiscordRoles({
      userId,
      roleIds,
      reason: `Betaalde order ${order.id}`,
      guildId: getDiscordGuildIdForRoles(getSettings().guildId),
    });
    granted = grant.granted || [];
    if (grant.ok) {
      markRolesClaimed({
        transactionKey: `${userId}:${order.id}:paid`,
        discordId: userId,
        packageIds: matchedPackages,
        granted,
        serverId: order.serverId || null,
        orderId: order.id,
      });
    }
  }

  // Stripe/native claim-code voor ingame (/claimstore) — geen Tebex
  let claim = getClaimByOrderId(order.id);
  if (!claim) {
    try {
      const catalog = await getLiveCatalog();
      const redeem = readRedeemPackages();
      claim = createClaimForOrder({
        order,
        catalog,
        redeemPackages: redeem.packages || {},
      });
    } catch (err) {
      console.error("claim create:", err.message);
    }
  }

  updateOrder(order.id, {
    status: "paid",
    paidAt: new Date().toISOString(),
    granted,
    claimCode: claim?.code || null,
    claimCoins: claim?.coins ?? null,
  });
  return { granted, matchedPackages, claim };
}

function getSettings() {
  return normalizeSettings(readSettingsFile(DATA, SEED_DATA, defaultSettings()));
}

async function getSettingsAsync() {
  return normalizeSettings(await loadSettingsAsync(DATA, SEED_DATA, defaultSettings()));
}

async function persistSettings(next) {
  const normalized = normalizeSettings(next);
  return saveSettingsAsync(DATA, normalized);
}

let catalogCache = { at: 0, data: null };

function invalidateCatalogCache() {
  catalogCache = { at: 0, data: null };
}

function readLocalCatalog() {
  const local = seedCatalogFallback(DATA, SEED_DATA);
  return local?.categories?.length ? local : { categories: [] };
}

/**
 * Catalogus: lokale/Tebex webshop + ingame tebexwrapper StoreData.
 */
async function getLiveCatalog({ forceRefresh = false } = {}) {
  const redeem = readRedeemPackages();
  if (!forceRefresh && catalogCache.data && Date.now() - catalogCache.at < 60_000) {
    return annotateCatalogVisibility(annotateCatalogWithRedeem(catalogCache.data, redeem));
  }

  let web = readLocalCatalog();
  const needTebex = forceRefresh || !web.categories.length;

  if (needTebex && getTebexSecret()) {
    try {
      const packages = await Promise.race([
        fetchTebexPackages(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Tebex catalog timeout")), 10_000)),
      ]);
      const catalog = packagesToCatalog(packages);
      if (catalog.categories.length) {
        web = catalog;
        try {
          writeJson("catalog.json", catalog);
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      console.error("Tebex catalog error:", err.message);
    }
  }

  const ingame = readIngameStoreCatalog();
  const ingameWeb = ingameStoreToWebCatalog(ingame);
  const merged = mergeWebAndIngameCatalog(web, ingameWeb);

  catalogCache = { at: Date.now(), data: merged };
  return annotateCatalogVisibility(annotateCatalogWithRedeem(merged, redeem));
}

// Warm catalog bij start zodat admin/shop niet leeg starten
getLiveCatalog().catch((err) => console.error("Catalog warmup:", err.message));

/** Live caches (refreshed in background) */
const live = {
  server: { online: 0, max: 512, name: "Amsterdam Roleplay", ok: false, updatedAt: 0, error: null },
  discord: { members: 0, ok: false, updatedAt: 0, error: null },
};

function inviteCodeFromUrl(url) {
  const m = String(url || "").match(/(?:discord\.gg\/|invite\/)([a-zA-Z0-9-]+)/);
  return m ? m[1] : null;
}

function cfxCodeFromSettings(s) {
  if (s.cfxCode) return String(s.cfxCode).trim();
  const m = String(s.cfxJoin || "").match(/join\/([a-z0-9]+)/i);
  return m ? m[1] : null;
}

async function refreshLiveServerStatus() {
  const s = getSettings();
  const code = cfxCodeFromSettings(s);
  if (!code) {
    live.server = { ...live.server, ok: false, error: "Geen CFX-code", updatedAt: Date.now() };
    return live.server;
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(`https://frontend.cfx-services.net/api/servers/single/${code}`, {
      headers: { Accept: "application/json", "User-Agent": "GRP-Website/1.0" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`CFX HTTP ${res.status}`);
    const json = await res.json();
    const data = json.Data || json.data || {};
    const online = Number(data.clients ?? data.Clients ?? 0);
    const max = Number(data.sv_maxclients ?? data.svMaxclients ?? data.svMaxClients ?? s.server.max ?? 0);
    const name = String(data.hostname || s.server.name || "FiveM").replace(/\^[0-9]/g, "");
    live.server = { online, max, name, ok: true, updatedAt: Date.now(), error: null };
  } catch (err) {
    live.server = {
      ...live.server,
      ok: false,
      error: err.message || "Live status mislukt",
      updatedAt: Date.now(),
    };
  }
  return live.server;
}

async function refreshLiveDiscordMembers() {
  const s = getSettings();
  const code = inviteCodeFromUrl(s.discordInvite);
  if (!code) {
    live.discord = { ...live.discord, ok: false, error: "Geen Discord invite", updatedAt: Date.now() };
    return live.discord;
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(`https://discord.com/api/v10/invites/${code}?with_counts=true`, {
      headers: { Accept: "application/json", "User-Agent": "GRP-Website/1.0" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`Discord HTTP ${res.status}`);
    const json = await res.json();
    const members = Number(json.approximate_member_count || json.profile?.member_count || 0);
    live.discord = { members, ok: true, updatedAt: Date.now(), error: null };
  } catch (err) {
    live.discord = {
      ...live.discord,
      ok: false,
      error: err.message || "Discord count mislukt",
      updatedAt: Date.now(),
    };
  }
  return live.discord;
}

async function refreshAllLive() {
  await Promise.allSettled([refreshLiveServerStatus(), refreshLiveDiscordMembers()]);
}

// Initial + interval refresh (frontend pollt /api/server/status elke 30s)
refreshAllLive();
setInterval(refreshAllLive, 20_000);

function isAdmin(user) {
  if (!user) return false;
  if (user.devBypass) return true;
  const roles = user.roles || [];
  return roles.map(String).includes(String(ADMIN_ROLE_ID));
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    globalName: user.globalName,
    avatar: user.avatar,
    isAdmin: isAdmin(user),
  };
}

app.set("trust proxy", 1);
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());
app.use(
  cookieSession({
    name: "arp_session",
    keys: [SESSION_SECRET, `${SESSION_SECRET}.2`],
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" || process.env.VERCEL === "1",
    httpOnly: true,
    overwrite: true,
  })
);

function requireAdmin(req, res, next) {
  if (isAdmin(req.session.user)) return next();
  return res.status(403).json({ ok: false, reason: "Geen toegang tot admin." });
}

async function fetchDiscordMemberRoles(accessToken, guildId) {
  const res = await fetch(`https://discord.com/api/users/@me/guilds/${guildId}/member`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.roles || [];
}

// —— Auth ——
app.get("/api/auth/me", (req, res) => {
  res.json({ user: publicUser(req.session.user) });
});

function getPublicUrl(req) {
  const envUrl = (PUBLIC_URL || "").replace(/\/$/, "");
  if (envUrl && !envUrl.includes("localhost")) return envUrl;
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  if (host) return `${proto}://${host}`;
  return envUrl || `http://localhost:${PORT}`;
}

app.get("/api/auth/discord/login", (req, res) => {
  const ret = String(req.query.return || "/");
  req.session.oauthReturn = ret.startsWith("/") ? ret : "/";

  if (DEV_ADMIN_BYPASS && !DISCORD_CLIENT_ID) {
    req.session.user = {
      id: "dev",
      username: "DevAdmin",
      globalName: "Dev Admin",
      avatar: null,
      roles: [ADMIN_ROLE_ID],
      devBypass: true,
    };
    return res.redirect(req.session.oauthReturn || "/admin");
  }

  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    return res.status(501).send(`<!doctype html><html lang="nl"><body style="font-family:sans-serif;background:#070b14;color:#ddd;padding:2rem;max-width:640px;margin:auto">
      <h1>Discord OAuth niet geconfigureerd</h1>
      <p>Zet in Vercel Environment Variables: <code>DISCORD_CLIENT_ID</code>, <code>DISCORD_CLIENT_SECRET</code>, <code>DISCORD_GUILD_ID</code>, <code>PUBLIC_URL</code>.</p>
      <p><a href="/" style="color:#3b82f6">Terug</a></p>
    </body></html>`);
  }

  const redirectUri = `${getPublicUrl(req)}/api/auth/discord/callback`;
  req.session.oauthRedirectUri = redirectUri;
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    response_type: "code",
    scope: "identify email guilds guilds.members.read",
    redirect_uri: redirectUri,
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get("/api/auth/discord/callback", async (req, res) => {
  const code = req.query.code;
  const ret = req.session.oauthReturn || "/admin";
  if (!code) return res.redirect(ret);

  try {
    const redirectUri =
      req.session.oauthRedirectUri || `${getPublicUrl(req)}/api/auth/discord/callback`;
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: redirectUri,
      }),
    });
    const token = await tokenRes.json();
    if (!token.access_token) {
      console.error("Discord token error:", token);
      throw new Error(token.error_description || token.error || "Geen access token");
    }

    const meRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const me = await meRes.json();

    const settings = getSettings();
    const guildId = DISCORD_GUILD_ID || settings.guildId;
    let roles = [];
    if (guildId) {
      roles = await fetchDiscordMemberRoles(token.access_token, guildId);
    }

    req.session.user = {
      id: me.id,
      username: me.username,
      globalName: me.global_name || me.username,
      avatar: me.avatar
        ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png`
        : null,
      roles,
    };

    res.redirect(ret);
  } catch (err) {
    console.error("OAuth error:", err);
    res.status(500).send(`<!doctype html><html lang="nl"><body style="font-family:sans-serif;background:#070b14;color:#ddd;padding:2rem;max-width:640px;margin:auto">
      <h1>Discord-login mislukt</h1>
      <p>${String(err.message || err)}</p>
      <p>Check of <code>PUBLIC_URL</code> en Discord Redirect exact <code>https://amsterdamrp-store.vercel.app/api/auth/discord/callback</code> zijn.</p>
      <p><a href="/api/auth/discord/login?return=/admin" style="color:#3b82f6">Opnieuw proberen</a></p>
    </body></html>`);
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session = null;
  res.clearCookie("arp_session");
  res.json({ ok: true });
});

// —— Public APIs ——
app.get("/api/server/status", async (_req, res) => {
  const s = getSettings();
  const mode = s.server.onlineMode || "live";

  if (mode === "live") {
    const stale = Date.now() - (live.server.updatedAt || 0) > 25_000;
    if (stale) await refreshLiveServerStatus();
    if (live.server.ok || live.server.updatedAt) {
      return res.json({
        online: live.server.online,
        max: live.server.max,
        name: live.server.name,
        live: live.server.ok,
        updatedAt: live.server.updatedAt,
      });
    }
  }

  let online = s.server.online;
  if (mode === "random") {
    online = Math.max(0, (s.server.online || 100) + Math.floor(Math.random() * 40) - 10);
  }
  res.json({
    online,
    max: s.server.max,
    name: s.server.name,
    live: false,
  });
});

app.get("/api/discord/members", async (_req, res) => {
  const s = getSettings();
  const stale = Date.now() - (live.discord.updatedAt || 0) > 60_000;
  if (stale) await refreshLiveDiscordMembers();
  const members = live.discord.ok ? live.discord.members : s.discordMembers;
  res.json({
    members,
    live: live.discord.ok,
    updatedAt: live.discord.updatedAt,
  });
});

app.get("/api/admin/live-status", requireAdmin, async (_req, res) => {
  await refreshAllLive();
  res.json({ ok: true, server: live.server, discord: live.discord });
});

app.get("/api/store/catalog", async (_req, res) => {
  const catalog = await getLiveCatalog();
  // Alleen producten die zichtbaar staan (zelfde setting als ingame)
  const categories = (catalog.categories || [])
    .map((cat) => ({
      ...cat,
      packages: (cat.packages || []).filter((p) => isProductVisible(p)),
    }))
    .filter((cat) => (cat.packages || []).length > 0);
  res.json({ ...catalog, categories });
});

app.get("/api/store/recent-payments", async (_req, res) => {
  try {
    if (getTebexSecret()) {
      const payments = await fetchTebexPayments(25);
      return res.json(paymentsToRecent(payments));
    }
  } catch (err) {
    console.error("Tebex payments error:", err.message);
  }
  res.json(readJson("payments.json", { payments: [] }));
});

app.get("/api/leaderboards", (_req, res) => {
  res.json(readJson("leaderboards.json", { coins: [], spent: [], spentWeekly: [] }));
});

app.get("/api/site/public-config", async (_req, res) => {
  const s = await getSettingsAsync();
  res.json({
    maintenance: s.maintenance,
    maintenanceMessage: s.maintenanceMessage,
    sitePublic: s.sitePublic,
    announcement: s.announcementEnabled ? s.announcement : "",
    discordInvite: s.discordInvite,
    cfxJoin: s.cfxJoin,
  });
});

app.get("/api/server/verify", (req, res) => {
  const id = String(req.query.id || "").trim();
  if (!id || id.length > 64 || !/^[a-zA-Z0-9:_-]+$/.test(id)) {
    return res.json({ ok: false, online: false, reason: "bad_server_id" });
  }
  res.json({ ok: true, online: true, serverId: id });
});

app.get("/api/store/status", (_req, res) => {
  const redeem = readRedeemPackages();
  const wrapperPath = getTebexwrapperPath();
  const settings = getSettings();
  const methods = getEnabledPaymentMethods(settings);
  res.json({
    ok: true,
    checkoutProvider: methods.stripe ? "stripe" : methods.tebex ? "tebex" : "discord",
    checkoutMode: methods.stripe ? "stripe" : methods.tebex ? "tebex" : "discord",
    payments: settings.payments,
    paymentMethods: methods,
    stripeConfigured: methods.stripeConfigured,
    tebexSecret: Boolean(getTebexSecret()),
    tebexPublicToken: Boolean(getTebexPublicToken()),
    tebexwrapperLinked: Boolean(wrapperPath),
    tebexwrapperPath: wrapperPath || null,
    redeemPackageIds: Object.keys(redeem.packages).map(Number),
    discordInvite: settings.discordInvite,
    deliveryCommand: "matrixwrapper:sendProduct {id} {packageId} {price} {transaction}",
  });
});

app.post("/api/store/checkout", async (req, res) => {
  try {
    const settings = await getSettingsAsync();
    const methods = getEnabledPaymentMethods(settings);

    // Geen Stripe/Tebex aan → altijd Discord (ook zonder login)
    if (!methods.anyEnabled) {
      const invite = settings.discordInvite || "https://discord.gg/rRSeCBb25A";
      return res.json({
        ok: true,
        mode: "discord",
        reason: "payments_disabled",
        message: "Online betalen staat uit. Je wordt naar Discord gestuurd.",
        checkout: invite,
      });
    }

    if (!req.session?.user) {
      return res.json({ ok: false, reason: "not_logged_in" });
    }
    const { items, serverId, coupon } = req.body || {};
    const base = getPublicUrl(req);
    const packageIds = (items || [])
      .map((i) => Number(i.id))
      .filter((id) => id > 0);

    const catalog = await getLiveCatalog();

    if (methods.stripe) {
      const created = createNativeOrder({
        user: req.session.user,
        items,
        serverId,
        coupon,
        catalogPackages: catalog.categories || [],
        provider: "stripe",
        status: "pending_payment",
      });
      if (!created.ok) return res.json(created);

      if (Number(created.order.total) <= 0) {
        const fulfilled = await fulfillPaidOrder({
          order: created.order,
          userId: req.session.user.id,
        });
        return res.json({
          ok: true,
          mode: "native",
          orderId: created.order.id,
          granted: fulfilled.granted,
          claimCode: fulfilled.claim?.code || null,
          claimCoins: fulfilled.claim?.coins ?? null,
          message: fulfilled.claim?.code
            ? `Bestelling geplaatst. In-game: /claimstore ${fulfilled.claim.code}`
            : `Bestelling ${created.order.id} geplaatst.`,
          checkout: `${base}/doneren/cart?ordered=1&order=${encodeURIComponent(created.order.id)}&claim=${encodeURIComponent(fulfilled.claim?.code || "")}`,
        });
      }

      try {
        const session = await createStripeCheckoutSession({
          order: created.order,
          successUrl: `${base}/doneren/cart?paid=1&order=${encodeURIComponent(created.order.id)}&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${base}/doneren/cart?cancelled=1`,
        });
        updateOrder(created.order.id, { stripeSessionId: session.id });
        req.session.pendingRoleClaim = {
          packageIds,
          serverId: String(serverId || ""),
          discordId: String(req.session.user.id),
          at: Date.now(),
          ident: created.order.id,
          provider: "stripe",
          verified: false,
        };
        return res.json({
          ok: true,
          mode: "stripe",
          orderId: created.order.id,
          checkout: session.url,
        });
      } catch (err) {
        updateOrder(created.order.id, { status: "stripe_error", error: err.message });
        return res.json({ ok: false, reason: "stripe_error", detail: err.message });
      }
    }

    if (methods.tebex) {
      const result = await createCheckout({
        items,
        serverId,
        coupon,
        completeUrl: `${base}/doneren/cart?paid=1`,
        cancelUrl: `${base}/doneren/cart`,
      });
      if (result.ok) {
        if (result.ident) req.session.basketIdent = result.ident;
        req.session.pendingRoleClaim = {
          packageIds,
          serverId: String(serverId || ""),
          discordId: String(req.session.user.id),
          at: Date.now(),
          ident: result.ident || null,
          provider: "tebex",
        };
      }
      return res.json(result);
    }

    const invite = settings.discordInvite || "https://discord.gg/rRSeCBb25A";
    return res.json({
      ok: true,
      mode: "discord",
      checkout: invite,
      message: "Geen actieve betaalmethode. Je wordt naar Discord gestuurd.",
    });
  } catch (err) {
    console.error("Checkout error:", err);
    return res.json({ ok: false, reason: "checkout_error", detail: err.message });
  }
});

app.get("/api/store/stripe/confirm", async (req, res) => {
  try {
    const sessionId = String(req.query.session_id || "");
    const orderId = String(req.query.order || "");
    if (!sessionId) return res.json({ ok: false, reason: "bad_session" });

    const session = await retrieveStripeSession(sessionId);
    const paid = session.payment_status === "paid" || session.status === "complete";
    if (!paid) return res.json({ ok: false, reason: "not_paid", status: session.payment_status });

    const id = orderId || session.metadata?.orderId || session.client_reference_id;
    let order = id ? getOrder(id) : null;
    if (!order && session.metadata?.orderId) order = getOrder(session.metadata.orderId);
    if (!order) return res.json({ ok: false, reason: "order_not_found" });

    if (order.status === "paid") {
      const claim = getClaimByOrderId(order.id);
      return res.json({
        ok: true,
        alreadyPaid: true,
        orderId: order.id,
        granted: order.granted || [],
        claimCode: claim?.code || order.claimCode || null,
        claimCoins: claim?.coins ?? order.claimCoins ?? null,
        claimStatus: claim?.status || null,
      });
    }

    const userId = req.session?.user?.id || order.discord?.id || session.metadata?.discordId;
    const fulfilled = await fulfillPaidOrder({ order, userId });
    req.session.pendingRoleClaim = {
      packageIds: (order.items || []).map((i) => Number(i.id)),
      serverId: order.serverId,
      discordId: String(userId || ""),
      at: Date.now(),
      ident: order.id,
      provider: "stripe",
      verified: true,
    };
    return res.json({
      ok: true,
      orderId: order.id,
      granted: fulfilled.granted || [],
      claimCode: fulfilled.claim?.code || null,
      claimCoins: fulfilled.claim?.coins ?? null,
      message: fulfilled.claim?.code
        ? `Claim in-game met: /claimstore ${fulfilled.claim.code}`
        : undefined,
    });
  } catch (err) {
    console.error("stripe confirm:", err);
    return res.json({ ok: false, reason: "stripe_error", detail: err.message });
  }
});

/** Ingame /claimstore → website (Stripe/native, geen Tebex). */
app.post("/api/store/claim-code", (req, res) => {
  const secret = process.env.STORE_CLAIM_SECRET || process.env.STORE_SYNC_SECRET || "";
  const given = String(req.headers["x-store-secret"] || req.body?.secret || "");
  if (secret && given !== secret) {
    return res.status(401).json({ ok: false, reason: "unauthorized" });
  }

  const code = req.body?.code || req.query?.code;
  const result = redeemClaimCode(code, {
    license: req.body?.license,
    fivem: req.body?.fivem,
    serverId: req.body?.serverId,
    name: req.body?.name,
  });

  if (!result.ok) {
    return res.json(result);
  }

  return res.json({
    ok: true,
    code: result.claim.code,
    coins: result.coins,
    packages: result.packages,
    orderId: result.orderId,
    message: result.coins > 0
      ? `Je ontvangt ${result.coins} coins`
      : "Code geclaimd (geen coins gekoppeld — check pakket mapping)",
  });
});

app.post("/api/store/claim-roles", async (req, res) => {
  try {
    const user = req.session?.user;
    if (!user?.id) {
      return res.json({ ok: false, reason: "not_logged_in" });
    }

    const pending = req.session.pendingRoleClaim;
    const bodyIds = Array.isArray(req.body?.packageIds) ? req.body.packageIds : [];
    const packageIds = (pending?.packageIds?.length ? pending.packageIds : bodyIds)
      .map((id) => Number(id))
      .filter((id) => id > 0);

    if (!packageIds.length) {
      return res.json({ ok: false, reason: "nothing_to_claim" });
    }

    // Pending claims expire after 6 hours
    if (pending?.at && Date.now() - pending.at > 6 * 60 * 60 * 1000) {
      delete req.session.pendingRoleClaim;
      return res.json({ ok: false, reason: "claim_expired" });
    }

    const { roleIds, matchedPackages } = roleIdsForPackages(packageIds);
    if (!roleIds.length) {
      return res.json({ ok: false, reason: "no_roles_configured", matchedPackages });
    }

    const transactionKey = [
      user.id,
      pending?.ident || pending?.serverId || "manual",
      matchedPackages.slice().sort().join("-"),
    ].join(":");

    if (alreadyClaimed(transactionKey)) {
      return res.json({ ok: true, alreadyClaimed: true, granted: [], matchedPackages });
    }

    // Stripe: only trust after /stripe/confirm set verified=true
    let verified = Boolean(pending?.verified || pending?.provider === "native");
    if (!verified && pending?.provider === "stripe") {
      verified = false;
    }
    if (!verified && getTebexSecret() && pending?.serverId && pending?.provider !== "stripe") {
      try {
        const payments = await fetchTebexPayments(40);
        const list = Array.isArray(payments) ? payments : payments?.data || [];
        const username = String(pending.serverId).toLowerCase();
        verified = list.some((p) => {
          const player = String(p.player?.name || "").toLowerCase();
          if (player !== username) return false;
          const paidPackages = (p.packages || []).map((x) => Number(x.id || x));
          return matchedPackages.some((id) => paidPackages.includes(Number(id)));
        });
      } catch (err) {
        console.error("claim-roles payment verify:", err.message);
        verified = Boolean(pending?.at && Date.now() - pending.at < 30 * 60 * 1000);
      }
    } else if (!verified && pending?.at && Date.now() - pending.at < 30 * 60 * 1000) {
      verified = true;
    }

    if (!verified) {
      return res.json({
        ok: false,
        reason: "payment_not_found",
        detail: "Geen passende Tebex-betaling gevonden. Probeer het over een minuut opnieuw.",
      });
    }

    const grant = await grantDiscordRoles({
      userId: user.id,
      roleIds,
      reason: `Webshop pakket ${matchedPackages.join(",")}`,
      guildId: getDiscordGuildIdForRoles(getSettings().guildId),
    });

    if (grant.ok) {
      markRolesClaimed({
        transactionKey,
        discordId: user.id,
        packageIds: matchedPackages,
        granted: grant.granted,
        serverId: pending?.serverId || null,
      });
      delete req.session.pendingRoleClaim;
    }

    return res.json({
      ok: grant.ok,
      granted: grant.granted || [],
      matchedPackages,
      reason: grant.reason,
      errors: grant.errors || [],
    });
  } catch (err) {
    console.error("claim-roles error:", err);
    return res.json({ ok: false, reason: "claim_error", detail: err.message });
  }
});

app.post("/api/store/checkout/complete", async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.json({ ok: false, reason: "not_logged_in" });
    }
    const { ident, items, coupon } = req.body || {};
    const basketIdent = ident || req.session.basketIdent;
    const result = await completeCheckout({
      ident: basketIdent,
      items,
      coupon,
    });
    return res.json(result);
  } catch (err) {
    console.error("Checkout complete error:", err);
    return res.json({ ok: false, reason: "tebex_error", detail: err.message });
  }
});

app.get("/api/skins", (_req, res) => {
  res.json({ skins: [] });
});

app.get("/api/skins/status", (_req, res) => {
  res.json({ skins: [] });
});

app.post("/api/skins", (_req, res) => {
  res.json({ ok: false, reason: "Skins upload is uitgeschakeld in deze clone." });
});

// —— Admin APIs ——
app.get("/api/admin/me", (req, res) => {
  const user = req.session?.user || null;
  res.json({
    ok: Boolean(user && isAdmin(user)),
    loggedIn: Boolean(user),
    isAdmin: isAdmin(user),
    user: publicUser(user),
    adminRoleId: ADMIN_ROLE_ID,
    roleCount: user?.roles?.length || 0,
    oauthConfigured: Boolean(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET),
    guildConfigured: Boolean(DISCORD_GUILD_ID || getSettings().guildId),
    guildId: DISCORD_GUILD_ID || getSettings().guildId || null,
    devBypass: DEV_ADMIN_BYPASS,
  });
});

app.get("/api/admin/settings", requireAdmin, async (_req, res) => {
  const settings = await getSettingsAsync();
  res.json({
    ok: true,
    settings: { ...settings, _stripeConfigured: isStripeConfigured() },
    durableStore: hasDurableSettingsStore(),
    paymentMethods: getEnabledPaymentMethods(settings),
  });
});

app.put("/api/admin/settings", requireAdmin, async (req, res) => {
  const current = await getSettingsAsync();
  const next = { ...current, ...req.body, adminRoleId: ADMIN_ROLE_ID };
  if (req.body.server) next.server = { ...current.server, ...req.body.server };
  if (req.body.payments) {
    next.payments = {
      ...(current.payments || { stripe: false, tebex: false }),
      ...req.body.payments,
    };
  }

  if (
    typeof req.body.announcement === "string" &&
    req.body.announcement.trim() &&
    req.body.announcementEnabled !== false &&
    req.body.announcement.trim() !== (current.announcement || "").trim()
  ) {
    const history = Array.isArray(current.announcementHistory) ? current.announcementHistory : [];
    history.unshift({ text: req.body.announcement.trim(), at: new Date().toISOString() });
    next.announcementHistory = history.slice(0, 30);
  }
  if (!Array.isArray(next.announcementHistory)) next.announcementHistory = current.announcementHistory || [];

  if (typeof next.announcement === "string") {
    next.announcementUpdatedAt = new Date().toISOString();
  }
  if (next.announcementEnabled && next.announcement) {
    next.announcement = String(next.announcement).trim();
  }

  const saved = await persistSettings(next);
  // Also keep a dedicated announcement snapshot for cold-start fallbacks
  try {
    writeJson("announcement.json", {
      enabled: Boolean(next.announcementEnabled && next.announcement),
      text: next.announcementEnabled ? next.announcement || "" : "",
      updatedAt: next.announcementUpdatedAt || null,
    });
  } catch {
    /* ignore */
  }
  res.json({ ok: true, settings: next, durable: saved.durable });
});

app.get("/api/announcements", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  let s = await getSettingsAsync();
  // Fallback snapshot if settings lost announcement on ephemeral disk
  if (!(s.announcementEnabled && s.announcement)) {
    try {
      const snap = readJson("announcement.json", null);
      if (snap?.enabled && snap?.text) {
        s = {
          ...s,
          announcementEnabled: true,
          announcement: snap.text,
          announcementUpdatedAt: snap.updatedAt || null,
        };
      }
    } catch {
      /* ignore */
    }
  }
  res.json({
    enabled: Boolean(s.announcementEnabled && s.announcement),
    text: s.announcementEnabled ? s.announcement || "" : "",
    updatedAt: s.announcementUpdatedAt || null,
  });
});

app.post("/api/admin/maintenance", requireAdmin, async (req, res) => {
  const s = await getSettingsAsync();
  s.maintenance = Boolean(req.body.enabled);
  if (typeof req.body.message === "string") s.maintenanceMessage = req.body.message;
  s.sitePublic = !s.maintenance;
  const saved = await persistSettings(s);
  res.json({
    ok: true,
    settings: s,
    durable: saved.durable,
    note: s.maintenance
      ? "Onderhoud staat AAN. Admins zien de site nog wel — test in een incognito-venster."
      : "Site is openbaar.",
  });
});

app.post("/api/admin/publish", requireAdmin, async (_req, res) => {
  const s = await getSettingsAsync();
  s.maintenance = false;
  s.sitePublic = true;
  const saved = await persistSettings(s);
  res.json({ ok: true, settings: s, durable: saved.durable });
});

app.get("/api/admin/role-grants", requireAdmin, async (_req, res) => {
  const grants = readRoleGrants();
  const catalog = await getLiveCatalog();

  const packages = [];
  for (const cat of catalog.categories || []) {
    for (const pkg of cat.packages || []) {
      const cfg = grants.packages?.[String(pkg.id)] || {
        enabled: false,
        roleIds: [],
        label: pkg.name,
      };
      packages.push({
        id: pkg.id,
        name: pkg.name,
        price: pkg.totalPrice,
        category: cat.name,
        enabled: Boolean(cfg.enabled),
        roleIds: cfg.roleIds || [],
        label: cfg.label || pkg.name,
      });
    }
  }
  res.json({
    ok: true,
    grants,
    packages,
    botConfigured: Boolean(getDiscordBotToken()),
    guildId: getDiscordGuildIdForRoles(getSettings().guildId) || null,
    wrapperSync: syncRoleGrantsToTebexwrapper(grants),
  });
});

app.put("/api/admin/role-grants", requireAdmin, (req, res) => {
  const next = writeRoleGrants(req.body.grants || req.body);
  res.json({ ok: true, grants: next, wrapperSync: syncRoleGrantsToTebexwrapper(next) });
});

app.put("/api/admin/role-grants/:packageId", requireAdmin, (req, res) => {
  const next = upsertPackageRoleGrant(req.params.packageId, req.body || {});
  res.json({
    ok: true,
    grants: next,
    package: next.packages[String(req.params.packageId)] || null,
    wrapperSync: syncRoleGrantsToTebexwrapper(next),
  });
});

app.get("/api/admin/catalog", requireAdmin, async (req, res) => {
  const forceRefresh = String(req.query.refresh || "") === "1";
  const catalog = await getLiveCatalog({ forceRefresh });
  const ingame = readIngameStoreCatalog();
  const local = readLocalCatalog();
  const source = forceRefresh && getTebexSecret()
    ? "tebex+ingame"
    : local.categories.length
      ? `catalog+${ingame.source}`
      : getTebexSecret()
        ? "tebex+ingame"
        : `seed+${ingame.source}`;
  res.json({
    ok: true,
    catalog,
    source,
    tebexwrapperPath: getTebexwrapperPath() || null,
    ingameSource: ingame.source,
    categoryCount: catalog?.categories?.length || 0,
    packageCount: (catalog?.categories || []).reduce((n, c) => n + (c.packages?.length || 0), 0),
  });
});

app.post("/api/admin/catalog/sync-ingame", requireAdmin, async (_req, res) => {
  const catalog = await getLiveCatalog({ forceRefresh: true });
  const sync = syncCatalogToTebexwrapper(catalog);
  invalidateCatalogCache();
  res.json({ ok: sync.ok, sync, catalog: await getLiveCatalog({ forceRefresh: true }) });
});

app.put("/api/admin/catalog/visibility/:productId", requireAdmin, (req, res) => {
  const visible = req.body?.visible !== false && req.body?.visible !== "off";
  const result = setProductVisibility(req.params.productId, visible);
  invalidateCatalogCache();
  res.json({
    ok: result.ok,
    ...result,
    note: "Zelfde zichtbaarheid voor website (/doneren) en ingame store",
  });
});

app.put("/api/admin/catalog/visibility", requireAdmin, async (req, res) => {
  const visible = req.body?.visible !== false && req.body?.visible !== "off";
  const scope = String(req.body?.scope || "all"); // all | category
  const catalog = await getLiveCatalog();
  let cats = catalog?.categories || [];
  if (scope === "category" && req.body?.categoryId != null) {
    cats = cats.filter((c) => String(c.id) === String(req.body.categoryId));
  }
  const ids = cats.flatMap((c) => (c.packages || []).map((p) => p.id));
  const result = setManyProductsVisibility(ids, visible);
  invalidateCatalogCache();
  res.json({
    ok: result.ok,
    ...result,
    note: "Zelfde zichtbaarheid voor website én ingame",
  });
});

app.get("/api/admin/catalog/visibility", requireAdmin, (_req, res) => {
  res.json({ ok: true, ...readProductVisibility() });
});

app.put("/api/admin/catalog", requireAdmin, (req, res) => {
  const next = req.body.catalog || req.body;
  writeJson("catalog.json", next);
  invalidateCatalogCache();
  const sync = syncCatalogToTebexwrapper(next);
  catalogCache = { at: Date.now(), data: next };
  res.json({ ok: true, catalog: next, sync });
});

app.post("/api/admin/catalog/package", requireAdmin, (req, res) => {
  const catalog = readLocalCatalog();
  const { categoryId, pkg } = req.body;
  let cat = catalog.categories.find((c) => String(c.id) === String(categoryId));

  // Ingame categorie (nog niet in lokale catalog) → aanmaken
  if (!cat && String(categoryId).startsWith("ingame-")) {
    const key = String(categoryId).replace(/^ingame-/, "");
    cat = {
      id: categoryId,
      name: pkg.categoryName || key,
      slug: key,
      categoryKey: key,
      description: "",
      packages: [],
      source: "ingame",
    };
    catalog.categories.push(cat);
  }

  if (!cat) return res.status(404).json({ ok: false, reason: "Categorie niet gevonden" });
  const id = pkg.id || Date.now();
  const syncIngame = pkg.syncIngame !== false;
  const item = {
    id,
    name: pkg.name || "Nieuw pakket",
    slug: cat.slug,
    description: pkg.description || "",
    image: pkg.image || "/assets/img/logo-t.png",
    totalPrice: Number(pkg.totalPrice) || 0,
    discount: Number(pkg.discount) || 0,
    currency: pkg.currency || (syncIngame && !Number(pkg.id) ? "COINS" : "EUR"),
    tebexwrapperCoins: pkg.tebexwrapperCoins != null ? Number(pkg.tebexwrapperCoins) : undefined,
    ingameCoins: pkg.ingameCoins != null ? Number(pkg.ingameCoins) : undefined,
    ingameType: pkg.ingameType || pkg.type || undefined,
    amount: pkg.amount != null ? Number(pkg.amount) : 1,
    syncIngame,
    source: cat.source === "ingame" || syncIngame ? "ingame" : "web",
    categoryKey: cat.categoryKey || cat.slug,
    ingame: Boolean(cat.source === "ingame" || syncIngame),
  };
  const idx = cat.packages.findIndex((p) => String(p.id) === String(id));
  if (idx >= 0) cat.packages[idx] = { ...cat.packages[idx], ...item };
  else cat.packages.push(item);
  writeJson("catalog.json", catalog);
  invalidateCatalogCache();

  if (pkg.discordRoleEnabled !== undefined || pkg.discordRoleId !== undefined) {
    upsertPackageRoleGrant(id, {
      enabled: Boolean(pkg.discordRoleEnabled) && Boolean(pkg.discordRoleId),
      roleIds: pkg.discordRoleId || "",
      label: item.name,
    });
  }

  // → tebexwrapper (redeem + store)
  const coins = item.tebexwrapperCoins ?? item.ingameCoins;
  let redeemSync = null;
  if (Number(id) > 0 && coins != null) {
    redeemSync = writeRedeemPackagesOverlay({ [String(id)]: Number(coins) });
  }
  let storeSync = null;
  if (item.syncIngame || item.ingame || item.currency === "COINS") {
    storeSync = upsertWebStoreProduct({
      categoryKey: item.categoryKey || cat.slug || "webshop",
      category: { title: cat.name, description: cat.description || "" },
      product: {
        id: item.id,
        name: item.name,
        description: item.description,
        price: item.currency === "COINS" ? item.totalPrice : coins ?? item.totalPrice,
        image: item.image,
        type: item.ingameType || "item",
        amount: item.amount || 1,
        discordRoleId: pkg.discordRoleId,
      },
    });
  }

  res.json({ ok: true, catalog, package: item, redeemSync, storeSync });
});

app.delete("/api/admin/catalog/package/:categoryId/:packageId", requireAdmin, (req, res) => {
  const catalog = readLocalCatalog();
  const cat = catalog.categories.find((c) => String(c.id) === String(req.params.categoryId));
  if (!cat) return res.status(404).json({ ok: false });
  cat.packages = cat.packages.filter((p) => String(p.id) !== String(req.params.packageId));
  writeJson("catalog.json", catalog);
  invalidateCatalogCache();
  removeWebStoreProduct(cat.categoryKey || cat.slug, req.params.packageId);
  res.json({ ok: true, catalog });
});

app.post("/api/admin/catalog/category", requireAdmin, (req, res) => {
  const catalog = readLocalCatalog();
  const name = req.body.name || "Nieuwe categorie";
  const slug = (req.body.slug || name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const categoryKey = (req.body.categoryKey || slug).replace(/[^a-z0-9_]+/gi, "_");
  catalog.categories.push({
    id: Date.now(),
    name,
    slug,
    categoryKey,
    description: req.body.description || "",
    packages: [],
    source: req.body.ingame ? "ingame" : "web",
  });
  writeJson("catalog.json", catalog);
  invalidateCatalogCache();
  catalogCache = { at: Date.now(), data: catalog };
  res.json({ ok: true, catalog });
});

app.delete("/api/admin/catalog/category/:id", requireAdmin, (req, res) => {
  const catalog = readLocalCatalog();
  catalog.categories = catalog.categories.filter((c) => String(c.id) !== String(req.params.id));
  writeJson("catalog.json", catalog);
  invalidateCatalogCache();
  catalogCache = { at: Date.now(), data: catalog };
  res.json({ ok: true, catalog });
});

app.get("/api/admin/leaderboards", requireAdmin, (_req, res) => {
  res.json({ ok: true, leaderboards: readJson("leaderboards.json", {}) });
});

app.put("/api/admin/leaderboards", requireAdmin, (req, res) => {
  writeJson("leaderboards.json", req.body.leaderboards || req.body);
  res.json({ ok: true });
});

app.get("/api/admin/payments", requireAdmin, (_req, res) => {
  res.json({ ok: true, ...readJson("payments.json", { payments: [] }), orders: listOrders(50) });
});

app.put("/api/admin/payments", requireAdmin, (req, res) => {
  writeJson("payments.json", { payments: req.body.payments || [] });
  res.json({ ok: true });
});

app.post("/api/admin/payments", requireAdmin, (req, res) => {
  const data = readJson("payments.json", { payments: [] });
  data.payments.unshift({
    name: req.body.name || "Speler",
    packages: Array.isArray(req.body.packages) ? req.body.packages : [String(req.body.packages || "Pakket")],
    date: req.body.date || new Date().toISOString(),
  });
  data.payments = data.payments.slice(0, 50);
  writeJson("payments.json", data);
  res.json({ ok: true, payments: data.payments });
});

app.delete("/api/admin/payments/:index", requireAdmin, (req, res) => {
  const data = readJson("payments.json", { payments: [] });
  data.payments.splice(Number(req.params.index), 1);
  writeJson("payments.json", data);
  res.json({ ok: true, payments: data.payments });
});

// —— Maintenance gate ——
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  if (req.path.startsWith("/admin")) return next();
  if (
    req.path.startsWith("/assets") ||
    req.path === "/logo.png" ||
    req.path === "/background.mp4" ||
    req.path === "/weapon.glb" ||
    req.path === "/announcements.js" ||
    req.path === "/role-claim.js" ||
    req.path === "/maintenance.html"
  ) {
    return next();
  }

  const s = getSettings();
  if (s.maintenance && !isAdmin(req.session.user)) {
    if (req.path === "/maintenance.html" || req.accepts("html")) {
      return res.status(503).sendFile(path.join(__dirname, "public", "maintenance.html"));
    }
  }
  next();
});

app.use(express.static(path.join(__dirname, "public")));

app.get(["/admin", "/admin/"], (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin", "index.html"));
});

app.get("*", (req, res) => {
  const s = getSettings();
  if (s.maintenance && !isAdmin(req.session.user)) {
    return res.status(503).sendFile(path.join(__dirname, "public", "maintenance.html"));
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

export default app;

if (process.env.VERCEL !== "1") {
  app.listen(PORT, () => {
    console.log(`AmsterdamRP clone → http://localhost:${PORT}`);
    console.log(`Admin panel       → http://localhost:${PORT}/admin`);
    console.log(`Admin role ID     → ${ADMIN_ROLE_ID}`);
    if (DEV_ADMIN_BYPASS) console.log("DEV_ADMIN_BYPASS=1 actief");
  });
}