import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";
import { getTebexwrapperPath } from "./tebexwrapper.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA =
  process.env.VERCEL === "1"
    ? path.join("/tmp", "amsterdamrp-data")
    : path.join(__dirname, "..", "data");

function ensure() {
  fs.mkdirSync(DATA, { recursive: true });
}

function claimsPath() {
  return path.join(DATA, "claims.json");
}

function readClaims() {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(claimsPath(), "utf8"));
  } catch {
    return { claims: [] };
  }
}

function writeClaims(data) {
  ensure();
  writeFileSafe(claimsPath(), data);
  syncClaimsToTebexwrapper(data);
}

function writeFileSafe(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function syncClaimsToTebexwrapper(data) {
  const root = getTebexwrapperPath();
  if (!root) return;
  try {
    const dest = path.join(root, "data", "web-claim-codes.json");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // Compact map for Lua offline fallback
    const map = {};
    for (const c of data.claims || []) {
      if (c.status === "open") {
        map[c.code] = {
          coins: c.coins,
          orderId: c.orderId,
          packages: c.packages,
          serverId: c.serverId || null,
          discordId: c.discordId || null,
        };
      }
    }
    writeFileSafe(dest, { updatedAt: new Date().toISOString(), codes: map });
  } catch {
    /* ignore */
  }
}

function makeClaimCode() {
  return `ARP-${randomBytes(4).toString("hex").toUpperCase()}`;
}

/** Bereken coins voor orderregels via catalog/redeem map. */
export function coinsForOrderItems(items, catalog, redeemPackages = {}) {
  const byId = new Map();
  for (const cat of catalog?.categories || []) {
    for (const pkg of cat.packages || []) byId.set(String(pkg.id), pkg);
  }

  let coins = 0;
  const packages = [];
  for (const line of items || []) {
    const pkg = byId.get(String(line.id));
    const qty = Math.max(1, Number(line.quantity) || 1);
    const fromPkg = pkg?.tebexwrapperCoins ?? pkg?.ingameCoins;
    const fromRedeem = redeemPackages[Number(line.id)] ?? redeemPackages[String(line.id)];
    const nameMatch = String(pkg?.name || line.name || "").match(/(\d+)\s*[-–]?\s*coins/i);
    const per = Number(fromPkg ?? fromRedeem ?? nameMatch?.[1] ?? 0) || 0;
    coins += per * qty;
    packages.push({
      id: line.id,
      name: line.name || pkg?.name || String(line.id),
      quantity: qty,
      coins: per * qty,
    });
  }
  return { coins, packages };
}

export function createClaimForOrder({ order, catalog, redeemPackages }) {
  if (!order?.id) return null;
  const data = readClaims();
  const existing = data.claims.find((c) => c.orderId === order.id && c.status === "open");
  if (existing) return existing;

  const { coins, packages } = coinsForOrderItems(order.items, catalog, redeemPackages);
  const claim = {
    code: makeClaimCode(),
    orderId: order.id,
    status: "open",
    createdAt: new Date().toISOString(),
    coins,
    packages,
    serverId: order.serverId || null,
    discordId: order.discord?.id || null,
    provider: order.provider || "stripe",
    total: order.total,
  };

  data.claims.unshift(claim);
  data.claims = data.claims.slice(0, 1000);
  writeClaims(data);
  return claim;
}

export function getClaimByCode(code) {
  const normalized = String(code || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!normalized) return null;
  return readClaims().claims.find((c) => c.code === normalized) || null;
}

export function getClaimByOrderId(orderId) {
  return readClaims().claims.find((c) => c.orderId === orderId) || null;
}

/**
 * Markeer claim als gebruikt en geef payload terug voor ingame grant.
 */
export function redeemClaimCode(code, meta = {}) {
  const normalized = String(code || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!/^ARP-[A-F0-9]{8}$/i.test(normalized)) {
    return { ok: false, reason: "bad_code" };
  }

  const data = readClaims();
  const idx = data.claims.findIndex((c) => c.code === normalized);
  if (idx < 0) return { ok: false, reason: "not_found" };

  const claim = data.claims[idx];
  if (claim.status === "redeemed") {
    return { ok: false, reason: "already_redeemed", claim };
  }
  if (claim.status !== "open") {
    return { ok: false, reason: "invalid_status", claim };
  }

  claim.status = "redeemed";
  claim.redeemedAt = new Date().toISOString();
  claim.redeemedBy = {
    license: meta.license || null,
    fivem: meta.fivem || null,
    serverId: meta.serverId || null,
    name: meta.name || null,
  };
  data.claims[idx] = claim;
  writeClaims(data);

  return {
    ok: true,
    claim,
    coins: Number(claim.coins) || 0,
    packages: claim.packages || [],
    orderId: claim.orderId,
  };
}

export function listOpenClaims(limit = 50) {
  return readClaims()
    .claims.filter((c) => c.status === "open")
    .slice(0, limit);
}
