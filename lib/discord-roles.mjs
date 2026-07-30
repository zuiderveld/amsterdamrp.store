import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getTebexwrapperPath } from "./tebexwrapper.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA =
  process.env.VERCEL === "1"
    ? path.join("/tmp", "amsterdamrp-data")
    : path.join(__dirname, "..", "data");

function ensureDataDir() {
  fs.mkdirSync(DATA, { recursive: true });
}

export function readRoleGrants() {
  ensureDataDir();
  const file = path.join(DATA, "role-grants.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { packages: {} };
  }
}

export function writeRoleGrants(data) {
  ensureDataDir();
  const normalized = { packages: {} };
  for (const [id, raw] of Object.entries(data?.packages || {})) {
    const roleIds = normalizeRoleIds(raw?.roleIds ?? raw?.roleId);
    normalized.packages[String(id)] = {
      enabled: Boolean(raw?.enabled) && roleIds.length > 0,
      roleIds,
      label: String(raw?.label || ""),
      updatedAt: raw?.updatedAt || new Date().toISOString(),
    };
  }
  fs.writeFileSync(path.join(DATA, "role-grants.json"), JSON.stringify(normalized, null, 2));
  syncRoleGrantsToTebexwrapper(normalized);
  return normalized;
}

export function upsertPackageRoleGrant(packageId, patch) {
  const current = readRoleGrants();
  const id = String(packageId);
  const prev = current.packages[id] || { enabled: false, roleIds: [], label: "" };
  const roleIds = normalizeRoleIds(
    patch.roleIds !== undefined ? patch.roleIds : patch.roleId !== undefined ? patch.roleId : prev.roleIds
  );
  current.packages[id] = {
    enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : prev.enabled,
    roleIds,
    label: patch.label !== undefined ? String(patch.label || "") : prev.label,
    updatedAt: new Date().toISOString(),
  };
  if (!current.packages[id].roleIds.length) current.packages[id].enabled = false;
  return writeRoleGrants(current);
}

function normalizeRoleIds(input) {
  const list = Array.isArray(input)
    ? input
    : String(input || "")
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
  return [...new Set(list.map((id) => String(id).trim()).filter((id) => /^\d{17,20}$/.test(id)))];
}

/** Write compact map for tebexwrapper runtime */
export function syncRoleGrantsToTebexwrapper(grants = readRoleGrants()) {
  const root = getTebexwrapperPath();
  if (!root) return { ok: false, reason: "no_wrapper" };
  const out = {};
  for (const [id, cfg] of Object.entries(grants.packages || {})) {
    if (!cfg?.enabled || !cfg.roleIds?.length) continue;
    out[String(id)] = cfg.roleIds.length === 1 ? cfg.roleIds[0] : cfg.roleIds;
  }
  const dir = path.join(root, "data");
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "web-role-grants.json"), JSON.stringify(out, null, 2));
    return { ok: true, path: path.join(dir, "web-role-grants.json"), count: Object.keys(out).length };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

function readBotTokenFromWrapper() {
  const root = getTebexwrapperPath();
  if (!root) return "";
  try {
    const raw = fs.readFileSync(path.join(root, "config.lua"), "utf8");
    const m = raw.match(/botToken\s*=\s*['"]([^'"]+)['"]/);
    return m?.[1] || "";
  } catch {
    return "";
  }
}

export function getDiscordBotToken() {
  return process.env.DISCORD_BOT_TOKEN || readBotTokenFromWrapper() || "";
}

export function getDiscordGuildIdForRoles(fallback = "") {
  return (
    process.env.DISCORD_GUILD_ID ||
    process.env.DISCORD_ROLES_GUILD_ID ||
    fallback ||
    ""
  );
}

export async function grantDiscordRoles({ userId, roleIds, reason = "Webshop aankoop", guildId }) {
  const token = getDiscordBotToken();
  const resolvedGuild = guildId || getDiscordGuildIdForRoles();
  const roles = normalizeRoleIds(roleIds);
  if (!token) return { ok: false, reason: "no_bot_token", granted: [] };
  if (!resolvedGuild) return { ok: false, reason: "no_guild", granted: [] };
  if (!userId || !roles.length) return { ok: false, reason: "bad_request", granted: [] };

  const granted = [];
  const errors = [];
  for (const roleId of roles) {
    try {
      const res = await fetch(
        `https://discord.com/api/v10/guilds/${resolvedGuild}/members/${userId}/roles/${roleId}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bot ${token}`,
            "X-Audit-Log-Reason": reason.slice(0, 512),
          },
        }
      );
      if (res.status === 204 || res.ok) {
        granted.push(roleId);
      } else {
        const text = await res.text();
        errors.push({ roleId, status: res.status, detail: text.slice(0, 200) });
      }
    } catch (err) {
      errors.push({ roleId, detail: err.message });
    }
  }

  return {
    ok: granted.length > 0,
    granted,
    errors,
    reason: granted.length ? undefined : errors[0]?.detail || "grant_failed",
  };
}

export function roleIdsForPackages(packageIds, grants = readRoleGrants()) {
  const roles = [];
  const matched = [];
  for (const id of packageIds || []) {
    const cfg = grants.packages?.[String(id)];
    if (!cfg?.enabled || !cfg.roleIds?.length) continue;
    matched.push(String(id));
    for (const roleId of cfg.roleIds) roles.push(roleId);
  }
  return { roleIds: [...new Set(roles)], matchedPackages: matched };
}

export function readClaimLog() {
  ensureDataDir();
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, "role-claims.json"), "utf8"));
  } catch {
    return { claims: [] };
  }
}

export function markRolesClaimed(entry) {
  const data = readClaimLog();
  data.claims.unshift({
    ...entry,
    at: new Date().toISOString(),
  });
  data.claims = data.claims.slice(0, 500);
  fs.writeFileSync(path.join(DATA, "role-claims.json"), JSON.stringify(data, null, 2));
  return data;
}

export function alreadyClaimed(transactionKey) {
  if (!transactionKey) return false;
  const data = readClaimLog();
  return data.claims.some((c) => c.transactionKey === transactionKey);
}
