import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WRAPPER_CANDIDATES = [
  process.env.TEBEXWRAPPER_PATH,
  path.resolve(
    __dirname,
    "..",
    "..",
    "[server]",
    "[serverfiles]",
    "server-data",
    "resources",
    "[scripts]",
    "[main]",
    "tebexwrapper"
  ),
  "C:\\Users\\Administrator\\Desktop\\[server]\\[serverfiles]\\server-data\\resources\\[scripts]\\[main]\\tebexwrapper",
].filter(Boolean);

export function getTebexwrapperPath() {
  for (const dir of WRAPPER_CANDIDATES) {
    try {
      if (fs.existsSync(path.join(dir, "fxmanifest.lua"))) return dir;
    } catch {
      /* ignore */
    }
  }
  return "";
}

/** Parse Config.Redeem.packages { [id] = coins } from tebexwrapper config.lua */
export function readRedeemPackages() {
  const root = getTebexwrapperPath();
  if (!root) return { path: "", packages: {}, packageNames: {}, prices: {} };

  let raw = "";
  try {
    raw = fs.readFileSync(path.join(root, "config.lua"), "utf8");
  } catch {
    return { path: root, packages: {}, packageNames: {}, prices: {} };
  }

  const packages = {};
  const packageNames = {};
  const prices = {};

  // Only parse Config.Redeem { ... } so StoreData product tables are ignored
  const redeemBlock = raw.match(/Config\.Redeem\s*=\s*\{([\s\S]*?)\n\}/);
  const scope = redeemBlock?.[1] || "";

  const packagesBlock = scope.match(/packages\s*=\s*\{([\s\S]*?)\n\s*\},/);
  if (packagesBlock) {
    for (const m of packagesBlock[1].matchAll(/\[(\d+)\]\s*=\s*(\d+)/g)) {
      packages[Number(m[1])] = Number(m[2]);
    }
  }

  const namesBlock = scope.match(/packageNames\s*=\s*\{([\s\S]*?)\n\s*\},/);
  if (namesBlock) {
    for (const m of namesBlock[1].matchAll(/([A-Za-z0-9_]+)\s*=\s*(\d+)/g)) {
      packageNames[m[1].toLowerCase()] = Number(m[2]);
    }
  }

  const pricesBlock = scope.match(/prices\s*=\s*\{([\s\S]*?)\n\s*\},/);
  if (pricesBlock) {
    for (const m of pricesBlock[1].matchAll(/\[['"]([\d.]+)['"]\]\s*=\s*(\d+)/g)) {
      prices[m[1]] = Number(m[2]);
    }
  }

  return { path: root, packages, packageNames, prices };
}

/** Annotate web catalog packages with in-game coin amounts from tebexwrapper redeem map */
export function annotateCatalogWithRedeem(catalog, redeem) {
  const map = redeem?.packages || {};
  const nameMap = redeem?.packageNames || {};
  const priceMap = redeem?.prices || {};

  const categories = (catalog?.categories || []).map((cat) => ({
    ...cat,
    packages: (cat.packages || []).map((pkg) => {
      const byId = map[pkg.id];

      let byName;
      const slug = String(pkg.name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
      for (const [key, coins] of Object.entries(nameMap)) {
        if (slug === key || slug === `${key}`) {
          byName = coins;
          break;
        }
      }

      // "15 - Coins" / "100 Coins" → display amount for UI
      const nameCoins = String(pkg.name || "").match(/(\d+)\s*[-–]?\s*coins/i);
      const byLabel = nameCoins ? Number(nameCoins[1]) : undefined;

      const priceKey = Number(pkg.totalPrice).toFixed(2);
      const byPrice = priceMap[priceKey] ?? priceMap[String(pkg.totalPrice)];

      const coins = byId ?? byName ?? byLabel ?? byPrice;
      return coins != null
        ? { ...pkg, tebexwrapperCoins: coins, deliversVia: "tebexwrapper" }
        : { ...pkg, deliversVia: "tebex" };
    }),
  }));
  return { ...catalog, categories };
}
