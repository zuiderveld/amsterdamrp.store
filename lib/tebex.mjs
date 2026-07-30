import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readSecretFromServerCfg() {
  const candidates = [
    process.env.TEBEX_SECRET_FILE,
    path.resolve(
      __dirname,
      "..",
      "..",
      "[server]",
      "[serverfiles]",
      "server-data",
      "server.cfg"
    ),
    "C:\\Users\\Administrator\\Desktop\\[server]\\[serverfiles]\\server-data\\server.cfg",
  ].filter(Boolean);

  for (const file of candidates) {
    try {
      const raw = fs.readFileSync(file, "utf8");
      const m = raw.match(/sv_tebexSecret\s+(\S+)/i);
      if (m?.[1]) return m[1].trim();
    } catch {
      /* ignore */
    }
  }
  return "";
}

export function getTebexSecret() {
  return (
    process.env.TEBEX_SECRET ||
    process.env.sv_tebexSecret ||
    readSecretFromServerCfg() ||
    ""
  );
}

export function getTebexPublicToken() {
  return process.env.TEBEX_PUBLIC_TOKEN || process.env.TEBEX_WEBSTORE_ID || "";
}

async function tebexPlugin(pathname, { method = "GET", body } = {}) {
  const secret = getTebexSecret();
  if (!secret) {
    const err = new Error("TEBEX_SECRET ontbreekt");
    err.code = "no_token";
    throw err;
  }
  const res = await fetch(`https://plugin.tebex.io${pathname}`, {
    method,
    headers: {
      "X-Tebex-Secret": secret,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(json?.detail || json?.error || `Tebex HTTP ${res.status}`);
    err.code = "tebex_error";
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

async function tebexHeadless(pathname, { method = "GET", body, token } = {}) {
  const publicToken = token || getTebexPublicToken();
  if (!publicToken) {
    const err = new Error("TEBEX_PUBLIC_TOKEN ontbreekt");
    err.code = "no_token";
    throw err;
  }
  const res = await fetch(`https://headless.tebex.io/api/accounts/${publicToken}${pathname}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(json?.title || json?.detail || json?.error || `Tebex Headless HTTP ${res.status}`);
    err.code = "tebex_error";
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function packagePrice(pkg) {
  const base = Number(pkg.price || 0);
  const sale = pkg.sale;
  if (sale && sale.active && sale.discount > 0) {
    return {
      totalPrice: Math.max(0, base - Number(sale.discount)),
      discount: Number(sale.discount),
    };
  }
  return { totalPrice: base, discount: 0 };
}

export async function fetchTebexInformation() {
  return tebexPlugin("/information");
}

export async function fetchTebexPackages() {
  return tebexPlugin("/packages");
}

export async function fetchTebexPayments(limit = 25) {
  return tebexPlugin(`/payments?limit=${limit}`);
}

/** Map Tebex packages -> website catalog shape */
export function packagesToCatalog(packages) {
  const byCategory = new Map();
  for (const pkg of packages || []) {
    if (pkg.disabled) continue;
    const catName = pkg.category?.name || "Overig";
    const catId = pkg.category?.id || 0;
    if (!byCategory.has(catId)) {
      byCategory.set(catId, {
        id: catId,
        name: catName,
        slug: slugify(catName) || `cat-${catId}`,
        description: pkg.category?.description || "",
        packages: [],
      });
    }
    const pricing = packagePrice(pkg);
    byCategory.get(catId).packages.push({
      id: pkg.id,
      name: pkg.name,
      slug: slugify(catName) || "pakket",
      description: pkg.description || pkg.name,
      image: pkg.image || "/assets/img/logo-t.png",
      remoteImage: pkg.image || null,
      totalPrice: pricing.totalPrice,
      discount: pricing.discount,
      currency: "EUR",
      type: pkg.type || "single",
    });
  }
  return { categories: [...byCategory.values()] };
}

export function paymentsToRecent(payments) {
  const list = Array.isArray(payments) ? payments : payments?.data || [];
  return {
    payments: list.slice(0, 20).map((p) => ({
      name: p.player?.name || p.email || "Speler",
      packages: (p.packages || []).map((x) => x.name || String(x.id)),
      date: p.date || p.created_at || new Date().toISOString(),
    })),
  };
}

/**
 * Create checkout for cart items.
 * Prefers Headless API when TEBEX_PUBLIC_TOKEN is set.
 * Falls back to Tebex store package-add URL(s).
 */
export async function createCheckout({ items, serverId, coupon, completeUrl, cancelUrl }) {
  const cleaned = (items || [])
    .map((i) => ({
      id: Number(i.id),
      quantity: Math.max(1, Math.min(10, Number(i.quantity) || 1)),
    }))
    .filter((i) => i.id > 0);

  if (!cleaned.length) {
    return { ok: false, reason: "empty_basket" };
  }
  if (!serverId || String(serverId).trim().length < 1) {
    return { ok: false, reason: "bad_server_id" };
  }

  const publicToken = getTebexPublicToken();
  if (publicToken) {
    try {
      const created = await tebexHeadless("/baskets", {
        method: "POST",
        body: {
          complete_url: completeUrl,
          cancel_url: cancelUrl,
          custom: { serverId: String(serverId) },
          complete_auto_redirect: true,
          username: String(serverId),
        },
      });
      const basket = created?.data || created;
      const ident = basket?.ident;
      if (!ident) return { ok: false, reason: "no_checkout", detail: "Geen basket ident" };

      for (const item of cleaned) {
        await tebexHeadless(`/baskets/${ident}/packages`, {
          method: "POST",
          body: { package_id: item.id, quantity: item.quantity },
        });
      }

      if (coupon) {
        try {
          await tebexHeadless(`/baskets/${ident}/coupons`, {
            method: "POST",
            body: { coupon_code: String(coupon) },
          });
        } catch {
          /* coupon optional */
        }
      }

      // Refresh basket for links
      const refreshed = await tebexHeadless(`/baskets/${ident}`);
      const data = refreshed?.data || refreshed;
      const checkout = data?.links?.checkout;
      if (checkout) {
        return { ok: true, checkout, ident, mode: "tebex" };
      }

      // Needs FiveM/Minecraft auth first
      const returnUrl = encodeURIComponent(completeUrl || cancelUrl || "https://amsterdamrp-store.vercel.app/doneren/cart");
      const auth = await tebexHeadless(`/baskets/${ident}/auth?returnUrl=${returnUrl}`);
      const authList = Array.isArray(auth) ? auth : auth?.data || [];
      if (authList.length) {
        return { ok: true, mode: "auth", auth: authList, ident };
      }

      return { ok: false, reason: "no_checkout", detail: "Geen checkout-link van Tebex" };
    } catch (err) {
      return {
        ok: false,
        reason: err.code || "tebex_error",
        detail: err.message,
      };
    }
  }

  // Fallback: single/multi package add via storefront domain from plugin info
  try {
    const info = await fetchTebexInformation();
    const domain = info?.account?.domain;
    if (!domain) {
      return {
        ok: false,
        reason: "no_token",
        detail: "Zet TEBEX_PUBLIC_TOKEN (Headless) in Vercel Variables voor checkout.",
      };
    }
    // Tebex may return bare host or full URL
    let base = String(domain).trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
    // Tebex storefront add packages URL (username = FiveM server id)
    const params = new URLSearchParams();
    params.set("username", String(serverId));
    for (const item of cleaned) {
      for (let q = 0; q < item.quantity; q++) {
        params.append("package", String(item.id));
      }
    }
    if (coupon) params.set("coupon", String(coupon));
    const checkout = `${base}/checkout/packages/add?${params.toString()}`;
    return { ok: true, checkout, mode: "storefront" };
  } catch (err) {
    return { ok: false, reason: err.code || "tebex_error", detail: err.message };
  }
}

export async function completeCheckout({ ident, items, coupon, completeUrl, cancelUrl }) {
  if (!ident) return { ok: false, reason: "bad_ident" };
  const publicToken = getTebexPublicToken();
  if (!publicToken) return { ok: false, reason: "no_token" };

  try {
    if (items?.length) {
      for (const item of items) {
        const id = Number(item.id);
        const quantity = Math.max(1, Math.min(10, Number(item.quantity) || 1));
        if (!id) continue;
        try {
          await tebexHeadless(`/baskets/${ident}/packages`, {
            method: "POST",
            body: { package_id: id, quantity },
          });
        } catch {
          /* may already be in basket */
        }
      }
    }
    if (coupon) {
      try {
        await tebexHeadless(`/baskets/${ident}/coupons`, {
          method: "POST",
          body: { coupon_code: String(coupon) },
        });
      } catch {
        /* ignore */
      }
    }
    const refreshed = await tebexHeadless(`/baskets/${ident}`);
    const data = refreshed?.data || refreshed;
    const checkout = data?.links?.checkout;
    if (checkout) return { ok: true, checkout, ident };
    return { ok: false, reason: "no_checkout" };
  } catch (err) {
    return { ok: false, reason: err.code || "tebex_error", detail: err.message };
  }
}
