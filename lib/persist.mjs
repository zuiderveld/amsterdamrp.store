/**
 * Durable-ish settings for Vercel.
 * Priority: memory → Upstash (optional) → /tmp|data file → seed file in repo.
 */
import fs from "fs";
import path from "path";

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const SETTINGS_KEY = process.env.SETTINGS_REDIS_KEY || "amsterdamrp:settings";

let memorySettings = null;
let memoryUpdatedAt = 0;

async function upstashGet() {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    const res = await fetch(UPSTASH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(["GET", SETTINGS_KEY]),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json?.result) return null;
    return typeof json.result === "string" ? JSON.parse(json.result) : json.result;
  } catch {
    return null;
  }
}

async function upstashSet(data) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return false;
  try {
    const res = await fetch(UPSTASH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(["SET", SETTINGS_KEY, JSON.stringify(data)]),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function hasDurableSettingsStore() {
  return Boolean(UPSTASH_URL && UPSTASH_TOKEN);
}

export function readSettingsFile(dataDir, seedDir, fallback) {
  if (memorySettings) return structuredClone(memorySettings);

  for (const dir of [dataDir, seedDir]) {
    try {
      const raw = fs.readFileSync(path.join(dir, "settings.json"), "utf8");
      const parsed = JSON.parse(raw);
      memorySettings = parsed;
      return structuredClone(parsed);
    } catch {
      /* try next */
    }
  }
  memorySettings = structuredClone(fallback);
  return structuredClone(fallback);
}

export async function loadSettingsAsync(dataDir, seedDir, fallback) {
  if (memorySettings && Date.now() - memoryUpdatedAt < 5000) {
    return structuredClone(memorySettings);
  }
  const remote = await upstashGet();
  if (remote && typeof remote === "object") {
    memorySettings = remote;
    memoryUpdatedAt = Date.now();
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify(remote, null, 2));
    } catch {
      /* ignore */
    }
    return structuredClone(remote);
  }
  const local = readSettingsFile(dataDir, seedDir, fallback);
  // Restore announcement snapshot if settings lost it (ephemeral /tmp)
  if (!(local.announcementEnabled && local.announcement)) {
    for (const dir of [dataDir, seedDir]) {
      try {
        const snap = JSON.parse(fs.readFileSync(path.join(dir, "announcement.json"), "utf8"));
        if (snap?.enabled && snap?.text) {
          local.announcementEnabled = true;
          local.announcement = snap.text;
          local.announcementUpdatedAt = snap.updatedAt || null;
          memorySettings = local;
          memoryUpdatedAt = Date.now();
          break;
        }
      } catch {
        /* try next */
      }
    }
  }
  return structuredClone(local);
}

export async function saveSettingsAsync(dataDir, data) {
  memorySettings = structuredClone(data);
  memoryUpdatedAt = Date.now();
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify(data, null, 2));
    fs.writeFileSync(
      path.join(dataDir, "announcement.json"),
      JSON.stringify(
        {
          enabled: Boolean(data.announcementEnabled && data.announcement),
          text: data.announcementEnabled ? data.announcement || "" : "",
          updatedAt: data.announcementUpdatedAt || new Date().toISOString(),
        },
        null,
        2
      )
    );
  } catch (err) {
    console.error("settings file write:", err.message);
  }
  const remoteOk = await upstashSet(data);
  return { ok: true, durable: remoteOk || process.env.VERCEL !== "1" };
}

export function seedCatalogFallback(dataDir, seedDir) {
  const dest = path.join(dataDir, "catalog.json");
  try {
    const current = JSON.parse(fs.readFileSync(dest, "utf8"));
    if (current?.categories?.length) return current;
  } catch {
    /* empty */
  }
  try {
    const seed = JSON.parse(fs.readFileSync(path.join(seedDir, "catalog.json"), "utf8"));
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(seed, null, 2));
    return seed;
  } catch {
    return { categories: [] };
  }
}
