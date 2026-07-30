import "dotenv/config";
import express from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA =
  process.env.VERCEL === "1"
    ? path.join("/tmp", "amsterdamrp-data")
    : path.join(__dirname, "data");

// Seed /tmp data from repo on cold start (Vercel filesystem is ephemeral)
function ensureDataFiles() {
  if (process.env.VERCEL !== "1") return;
  const seedDir = path.join(__dirname, "data");
  fs.mkdirSync(DATA, { recursive: true });
  for (const file of ["settings.json", "catalog.json", "leaderboards.json", "payments.json"]) {
    const dest = path.join(DATA, file);
    const src = path.join(seedDir, file);
    if (!fs.existsSync(dest) && fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
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
    return structuredClone(fallback);
  }
}

function writeJson(file, data) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, file), JSON.stringify(data, null, 2), "utf8");
}

function getSettings() {
  const s = readJson("settings.json", {
    maintenance: false,
    maintenanceMessage: "We zijn even bezig met onderhoud. Kom zo terug!",
    sitePublic: true,
    announcement: "",
    announcementEnabled: false,
    server: { name: "Amsterdam Roleplay", online: 0, max: 512, onlineMode: "live" },
    discordMembers: 0,
    discordInvite: "https://discord.gg/rRSeCBb25A",
    cfxJoin: "https://cfx.re/join/4zjlgq",
    cfxCode: "4zjlgq",
    adminRoleId: ADMIN_ROLE_ID,
    guildId: DISCORD_GUILD_ID,
  });
  s.adminRoleId = ADMIN_ROLE_ID;
  if (DISCORD_GUILD_ID) s.guildId = DISCORD_GUILD_ID;
  if (!s.cfxCode && s.cfxJoin) {
    const m = String(s.cfxJoin).match(/join\/([a-z0-9]+)/i);
    if (m) s.cfxCode = m[1];
  }
  return s;
}

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
  session({
    name: "grp.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production" || process.env.VERCEL === "1",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
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
  req.session.destroy(() => {
    res.clearCookie("grp.sid");
    res.json({ ok: true });
  });
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

app.get("/api/store/catalog", (_req, res) => {
  res.json(readJson("catalog.json", { categories: [] }));
});

app.get("/api/store/recent-payments", (_req, res) => {
  res.json(readJson("payments.json", { payments: [] }));
});

app.get("/api/leaderboards", (_req, res) => {
  res.json(readJson("leaderboards.json", { coins: [], spent: [], spentWeekly: [] }));
});

app.get("/api/site/public-config", (_req, res) => {
  const s = getSettings();
  res.json({
    maintenance: s.maintenance,
    maintenanceMessage: s.maintenanceMessage,
    sitePublic: s.sitePublic,
    announcement: s.announcementEnabled ? s.announcement : "",
    discordInvite: s.discordInvite,
    cfxJoin: s.cfxJoin,
  });
});

app.post("/api/store/checkout", (_req, res) => {
  res.status(501).json({ ok: false, reason: "Checkout is uitgeschakeld in deze clone." });
});

app.post("/api/store/checkout/complete", (_req, res) => {
  res.status(501).json({ ok: false });
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
  const user = req.session.user;
  if (!user) return res.json({ ok: false, loggedIn: false, isAdmin: false });
  res.json({
    ok: true,
    loggedIn: true,
    isAdmin: isAdmin(user),
    user: publicUser(user),
    adminRoleId: ADMIN_ROLE_ID,
    oauthConfigured: Boolean(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET),
    guildConfigured: Boolean(DISCORD_GUILD_ID || getSettings().guildId),
    devBypass: DEV_ADMIN_BYPASS,
  });
});

app.get("/api/admin/settings", requireAdmin, (_req, res) => {
  res.json({ ok: true, settings: getSettings() });
});

app.put("/api/admin/settings", requireAdmin, (req, res) => {
  const current = getSettings();
  const next = { ...current, ...req.body, adminRoleId: ADMIN_ROLE_ID };
  if (req.body.server) next.server = { ...current.server, ...req.body.server };

  // Keep mededeling history when publishing a new one
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

  writeJson("settings.json", next);
  res.json({ ok: true, settings: next });
});

app.get("/api/announcements", (_req, res) => {
  const s = getSettings();
  res.json({
    enabled: Boolean(s.announcementEnabled && s.announcement),
    text: s.announcementEnabled ? s.announcement || "" : "",
    updatedAt: s.announcementUpdatedAt || null,
  });
});

app.post("/api/admin/maintenance", requireAdmin, (req, res) => {
  const s = getSettings();
  s.maintenance = Boolean(req.body.enabled);
  if (typeof req.body.message === "string") s.maintenanceMessage = req.body.message;
  s.sitePublic = !s.maintenance;
  writeJson("settings.json", s);
  res.json({ ok: true, settings: s });
});

app.post("/api/admin/publish", requireAdmin, (req, res) => {
  const s = getSettings();
  s.maintenance = false;
  s.sitePublic = true;
  writeJson("settings.json", s);
  res.json({ ok: true, settings: s });
});

app.get("/api/admin/catalog", requireAdmin, (_req, res) => {
  res.json({ ok: true, catalog: readJson("catalog.json", { categories: [] }) });
});

app.put("/api/admin/catalog", requireAdmin, (req, res) => {
  writeJson("catalog.json", req.body.catalog || req.body);
  res.json({ ok: true });
});

app.post("/api/admin/catalog/package", requireAdmin, (req, res) => {
  const catalog = readJson("catalog.json", { categories: [] });
  const { categoryId, pkg } = req.body;
  const cat = catalog.categories.find((c) => String(c.id) === String(categoryId));
  if (!cat) return res.status(404).json({ ok: false, reason: "Categorie niet gevonden" });
  const id = pkg.id || Date.now();
  const item = {
    id,
    name: pkg.name || "Nieuw pakket",
    slug: cat.slug,
    description: pkg.description || "",
    image: pkg.image || "/assets/img/logo-t.png",
    totalPrice: Number(pkg.totalPrice) || 0,
    discount: Number(pkg.discount) || 0,
    currency: pkg.currency || "EUR",
  };
  const idx = cat.packages.findIndex((p) => String(p.id) === String(id));
  if (idx >= 0) cat.packages[idx] = { ...cat.packages[idx], ...item };
  else cat.packages.push(item);
  writeJson("catalog.json", catalog);
  res.json({ ok: true, catalog });
});

app.delete("/api/admin/catalog/package/:categoryId/:packageId", requireAdmin, (req, res) => {
  const catalog = readJson("catalog.json", { categories: [] });
  const cat = catalog.categories.find((c) => String(c.id) === String(req.params.categoryId));
  if (!cat) return res.status(404).json({ ok: false });
  cat.packages = cat.packages.filter((p) => String(p.id) !== String(req.params.packageId));
  writeJson("catalog.json", catalog);
  res.json({ ok: true, catalog });
});

app.post("/api/admin/catalog/category", requireAdmin, (req, res) => {
  const catalog = readJson("catalog.json", { categories: [] });
  const name = req.body.name || "Nieuwe categorie";
  const slug = (req.body.slug || name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  catalog.categories.push({
    id: Date.now(),
    name,
    slug,
    description: req.body.description || "",
    packages: [],
  });
  writeJson("catalog.json", catalog);
  res.json({ ok: true, catalog });
});

app.delete("/api/admin/catalog/category/:id", requireAdmin, (req, res) => {
  const catalog = readJson("catalog.json", { categories: [] });
  catalog.categories = catalog.categories.filter((c) => String(c.id) !== String(req.params.id));
  writeJson("catalog.json", catalog);
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
  res.json({ ok: true, ...readJson("payments.json", { payments: [] }) });
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
  if (req.path.startsWith("/assets") || req.path === "/logo.png" || req.path === "/background.mp4" || req.path === "/weapon.glb") {
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