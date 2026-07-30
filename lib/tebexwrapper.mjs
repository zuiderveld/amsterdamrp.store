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

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
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

  const overlay = readJsonFile(path.join(root, "data", "web-redeem-packages.json"), null);
  const overlayPackages = overlay?.packages || overlay || {};
  if (overlayPackages && typeof overlayPackages === "object") {
    for (const [id, coins] of Object.entries(overlayPackages)) {
      if (id === "updatedAt") continue;
      const n = Number(id);
      const c = Number(coins);
      if (n > 0 && Number.isFinite(c)) packages[n] = c;
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
      const byId = map[pkg.id] ?? map[Number(pkg.id)];

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

      const nameCoins = String(pkg.name || "").match(/(\d+)\s*[-–]?\s*coins/i);
      const byLabel = nameCoins ? Number(nameCoins[1]) : undefined;
      const explicit = pkg.tebexwrapperCoins ?? pkg.ingameCoins;

      const priceKey = Number(pkg.totalPrice).toFixed(2);
      const byPrice = priceMap[priceKey] ?? priceMap[String(pkg.totalPrice)];

      const coins = explicit ?? byId ?? byName ?? byLabel ?? byPrice;
      return coins != null
        ? { ...pkg, tebexwrapperCoins: Number(coins), deliversVia: "tebexwrapper" }
        : { ...pkg, deliversVia: pkg.source === "ingame" ? "tebexwrapper" : "tebex" };
    }),
  }));
  return { ...catalog, categories };
}

/** Fallback: parse active products from config.lua StoreData when export JSON is empty. */
export function parseStoreDataFromConfigLua() {
  const root = getTebexwrapperPath();
  if (!root) return { categories: [] };

  let raw = "";
  try {
    raw = fs.readFileSync(path.join(root, "config.lua"), "utf8");
  } catch {
    return { categories: [] };
  }

  const start = raw.indexOf("Config.StoreData");
  if (start < 0) return { categories: [] };
  raw = raw.slice(start);

  // Strip full-line comments only (keep inline code)
  raw = raw
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("--")) return "";
      return line;
    })
    .join("\n");

  const categories = [];
  // Categorieën staan op indentatie van ~8 spaties onder categories = {
  const catRe = /\n([ \t]{8})([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{/g;
  const keys = [];
  let m;
  while ((m = catRe.exec(raw))) {
    if (["Config", "StoreData", "categories", "products", "images", "items", "rewards"].includes(m[2])) {
      continue;
    }
    keys.push({ key: m[2], index: m.index });
  }

  for (let i = 0; i < keys.length; i++) {
    const { key, index } = keys[i];
    const end = i + 1 < keys.length ? keys[i + 1].index : raw.length;
    const block = raw.slice(index, end);
    if (!/products\s*=\s*\{/.test(block)) continue;

    const title = (block.match(/title\s*=\s*["']([^"']+)["']/) || [])[1] || key;
    const description = (block.match(/description\s*=\s*["']([^"']*)["']/) || [])[1] || "";
    const icon = (block.match(/icon\s*=\s*["']([^"']*)["']/) || [])[1] || "";
    const products = [];
    const seen = new Set();

    for (const pm of block.matchAll(/id\s*=\s*["']([^"']+)["']/g)) {
      const id = pm[1];
      if (seen.has(id)) continue;
      // Neem een venster rond deze id voor velden
      const from = Math.max(0, pm.index - 40);
      const to = Math.min(block.length, pm.index + 600);
      const body = block.slice(from, to);
      const name = (body.match(/name\s*=\s*["']([^"']+)["']/) || [])[1] || id;
      const desc = (body.match(/description\s*=\s*["']([^"']*)["']/) || [])[1] || "";
      const price = Number((body.match(/price\s*=\s*([0-9.]+)/) || [])[1] || 0);
      const type = (body.match(/type\s*=\s*["']([^"']+)["']/) || [])[1] || "item";
      const amount = Number((body.match(/amount\s*=\s*([0-9.]+)/) || [])[1] || 1);
      const image = (body.match(/images\s*=\s*\{\s*["']([^"']+)["']/) || [])[1] || "";
      // Skip nested pack item ids (meestal zonder price in venster + type item binnen pack)
      if (!body.includes("price") && type === "item" && !body.includes("name")) continue;
      seen.add(id);
      products.push({
        id,
        name,
        description: desc,
        price,
        images: image ? [image] : [],
        type,
        amount,
      });
    }

    if (products.length) {
      categories.push({ key, title, description, icon, products });
    }
  }

  return { updatedAt: new Date().toISOString(), categories };
}

/** Read store catalog export written by web_store_sync.lua (or parse config.lua). */
export function readIngameStoreCatalog() {
  const root = getTebexwrapperPath();
  if (!root) return { path: "", categories: [], source: "none" };

  const exportPath = path.join(root, "data", "store-catalog-export.json");
  const exported = readJsonFile(exportPath, null);
  if (exported?.categories?.length) {
    return { path: root, ...exported, source: "export" };
  }

  const parsed = parseStoreDataFromConfigLua();
  if (parsed.categories.length) {
    try {
      writeJsonFile(exportPath, parsed);
    } catch {
      /* ignore */
    }
  }
  return { path: root, ...parsed, source: parsed.categories.length ? "config.lua" : "none" };
}

/** Convert tebexwrapper StoreData categories → website catalog categories */
export function ingameStoreToWebCatalog(store) {
  const categories = [];
  for (const cat of store?.categories || []) {
    const packages = (cat.products || []).map((p) => ({
      id: p.id,
      name: p.name || p.id,
      slug: String(cat.key || cat.title || "ingame")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-"),
      description: p.description || "",
      image: Array.isArray(p.images) && p.images[0] ? p.images[0] : "/assets/img/logo-t.png",
      remoteImage: Array.isArray(p.images) && p.images[0] ? p.images[0] : null,
      totalPrice: Number(p.price) || 0,
      discount: 0,
      currency: "COINS",
      type: p.type || "item",
      amount: p.amount ?? 1,
      source: "ingame",
      categoryKey: cat.key,
      ingame: true,
    }));

    categories.push({
      id: `ingame-${cat.key}`,
      name: cat.title || cat.key,
      slug: String(cat.key || "ingame")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-"),
      description: cat.description || "Ingame tebexwrapper store",
      source: "ingame",
      categoryKey: cat.key,
      packages,
    });
  }
  return { categories };
}

/** Merge website EUR catalog + ingame store categories. */
export function mergeWebAndIngameCatalog(webCatalog, ingameCatalog) {
  const byKey = new Map();
  for (const cat of webCatalog?.categories || []) {
    const key = String(cat.categoryKey || cat.slug || cat.id);
    byKey.set(key, { ...cat, packages: [...(cat.packages || [])] });
  }
  for (const cat of ingameCatalog?.categories || []) {
    const key = String(cat.categoryKey || cat.slug || cat.id);
    if (byKey.has(key)) {
      const existing = byKey.get(key);
      const seen = new Set((existing.packages || []).map((p) => String(p.id)));
      for (const pkg of cat.packages || []) {
        if (!seen.has(String(pkg.id))) existing.packages.push(pkg);
      }
    } else {
      byKey.set(key, cat);
    }
  }
  return { categories: [...byKey.values()] };
}

export function writeRedeemPackagesOverlay(packagesMap) {
  const root = getTebexwrapperPath();
  if (!root) return { ok: false, reason: "tebexwrapper_not_found" };

  const file = path.join(root, "data", "web-redeem-packages.json");
  const current = readJsonFile(file, { packages: {} });
  const packages = { ...(current.packages || {}) };

  for (const [id, coins] of Object.entries(packagesMap || {})) {
    const n = Number(id);
    const c = Number(coins);
    if (!n || !Number.isFinite(c) || c < 0) continue;
    packages[String(n)] = Math.floor(c);
  }

  const payload = { packages, updatedAt: new Date().toISOString() };
  writeJsonFile(file, payload);
  return { ok: true, path: file, count: Object.keys(packages).length, packages };
}

export function upsertWebStoreProduct({ categoryKey, category, product }) {
  const root = getTebexwrapperPath();
  if (!root) return { ok: false, reason: "tebexwrapper_not_found" };
  if (!categoryKey || !product?.id) return { ok: false, reason: "bad_product" };

  const file = path.join(root, "data", "web-store-products.json");
  const current = readJsonFile(file, { items: [], categories: {} });
  current.items = Array.isArray(current.items) ? current.items : [];

  const ingameProduct = {
    id: String(product.id),
    name: product.name || String(product.id),
    description: product.description || "",
    price: Number(product.price ?? product.totalPrice ?? product.ingamePrice ?? 0) || 0,
    images: product.images || (product.image ? [product.image] : ["/assets/img/logo-t.png"]),
    type: product.type || product.ingameType || "item",
    amount: Number(product.amount) || 1,
  };
  if (product.discordRoleId) ingameProduct.discordRoleId = String(product.discordRoleId);

  const idx = current.items.findIndex(
    (x) => String(x.categoryKey) === String(categoryKey) && String(x.product?.id) === String(ingameProduct.id)
  );
  const entry = {
    categoryKey: String(categoryKey),
    category: category || { title: String(categoryKey) },
    product: ingameProduct,
  };
  if (idx >= 0) current.items[idx] = entry;
  else current.items.push(entry);

  current.updatedAt = new Date().toISOString();
  writeJsonFile(file, current);
  return { ok: true, path: file, item: entry, count: current.items.length };
}

export function removeWebStoreProduct(categoryKey, productId) {
  const root = getTebexwrapperPath();
  if (!root) return { ok: false, reason: "tebexwrapper_not_found" };
  const file = path.join(root, "data", "web-store-products.json");
  const current = readJsonFile(file, { items: [], categories: {} });
  current.items = (current.items || []).filter(
    (x) => !(String(x.categoryKey) === String(categoryKey) && String(x.product?.id) === String(productId))
  );
  current.updatedAt = new Date().toISOString();
  writeJsonFile(file, current);
  return { ok: true, count: current.items.length };
}

/** Sync website catalog → tebexwrapper redeem + store overlays. */
export function syncCatalogToTebexwrapper(catalog) {
  const root = getTebexwrapperPath();
  if (!root) return { ok: false, reason: "tebexwrapper_not_found" };

  const redeem = {};
  let storeCount = 0;

  for (const cat of catalog?.categories || []) {
    const categoryKey =
      cat.categoryKey ||
      cat.slug ||
      String(cat.name || "webshop")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_");

    for (const pkg of cat.packages || []) {
      const coins =
        pkg.tebexwrapperCoins ??
        pkg.ingameCoins ??
        (String(pkg.name || "").match(/(\d+)\s*[-–]?\s*coins/i) || [])[1];

      const numericId = Number(pkg.id);
      if (numericId > 0 && coins != null && Number(coins) >= 0) {
        redeem[String(numericId)] = Math.floor(Number(coins));
      }

      const shouldStore =
        pkg.ingame ||
        pkg.source === "ingame" ||
        pkg.syncIngame ||
        pkg.currency === "COINS" ||
        Boolean(pkg.ingameType) ||
        !Number.isFinite(numericId);

      if (shouldStore) {
        const res = upsertWebStoreProduct({
          categoryKey,
          category: { title: cat.name, description: cat.description || "" },
          product: {
            id: pkg.id,
            name: pkg.name,
            description: pkg.description,
            price: pkg.ingamePrice ?? (pkg.currency === "COINS" ? pkg.totalPrice : coins) ?? pkg.totalPrice,
            image: pkg.image || pkg.remoteImage,
            type: pkg.ingameType || pkg.type || "item",
            amount: pkg.amount || 1,
            discordRoleId: pkg.discordRoleId,
          },
        });
        if (res.ok) storeCount += 1;
      }
    }
  }

  const redeemRes = writeRedeemPackagesOverlay(redeem);
  return {
    ok: true,
    path: root,
    redeem: redeemRes,
    storeProducts: storeCount,
  };
}

/** Zichtbaarheid website + ingame (zelfde setting). */
export function readProductVisibility() {
  const root = getTebexwrapperPath();
  if (!root) {
    return { path: "", products: {} };
  }
  const file = path.join(root, "data", "web-product-visibility.json");
  const data = readJsonFile(file, { products: {} });
  return { path: root, file, products: data.products || {} };
}

/**
 * Default zichtbaarheid:
 * - expliciete web-product-visibility entry wint
 * - anders admin-overrides.available (ingame toggle)
 * - web/EUR pakketten: zichtbaar
 * - ingame/COINS: verborgen tot aangezet
 */
export function isProductVisible(pkg, visibilityMap = null) {
  const map = visibilityMap || readProductVisibility().products || {};
  const entry = map[String(pkg?.id)];
  if (entry && typeof entry.visible === "boolean") return entry.visible;
  if (typeof entry === "boolean") return entry;
  if (pkg?.visible === false) return false;
  if (pkg?.visible === true) return true;

  // Ingame admin-overrides (omgekeerde sync)
  const root = getTebexwrapperPath();
  if (root) {
    try {
      const overrides = readJsonFile(path.join(root, "data", "admin-overrides.json"), null);
      const ov = overrides?.products?.[String(pkg?.id)];
      if (ov && typeof ov.available === "boolean") return ov.available;
    } catch {
      /* ignore */
    }
  }

  if (pkg?.source === "ingame" || pkg?.ingame || pkg?.currency === "COINS") return false;
  return true;
}

export function annotateCatalogVisibility(catalog, visibilityMap = null) {
  const map = visibilityMap || readProductVisibility().products || {};
  return {
    ...catalog,
    categories: (catalog?.categories || []).map((cat) => ({
      ...cat,
      packages: (cat.packages || []).map((pkg) => ({
        ...pkg,
        visible: isProductVisible(pkg, map),
      })),
    })),
  };
}

export function setProductVisibility(productId, visible) {
  const root = getTebexwrapperPath();
  if (!root) return { ok: false, reason: "tebexwrapper_not_found" };
  if (!productId && productId !== 0) return { ok: false, reason: "bad_id" };

  const file = path.join(root, "data", "web-product-visibility.json");
  const data = readJsonFile(file, { products: {} });
  data.products = data.products || {};
  data.products[String(productId)] = {
    visible: Boolean(visible),
    updatedAt: new Date().toISOString(),
  };
  data.updatedAt = new Date().toISOString();
  writeJsonFile(file, data);

  // Zelfde setting in admin-overrides (ingame available)
  const overridesFile = path.join(root, "data", "admin-overrides.json");
  const overrides = readJsonFile(overridesFile, { products: {}, categories: {} });
  overrides.products = overrides.products || {};
  const prev = overrides.products[String(productId)] || {};
  overrides.products[String(productId)] = {
    ...prev,
    available: Boolean(visible),
    updatedBy: "website",
    updatedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
  };
  writeJsonFile(overridesFile, overrides);

  return {
    ok: true,
    id: String(productId),
    visible: Boolean(visible),
    products: data.products,
  };
}

/** Zet zichtbaarheid voor een lijst product-IDs (website + ingame). */
export function setManyProductsVisibility(productIds, visible) {
  const root = getTebexwrapperPath();
  if (!root) return { ok: false, reason: "tebexwrapper_not_found", count: 0 };

  const ids = [...new Set((productIds || []).map((id) => String(id)).filter(Boolean))];
  const file = path.join(root, "data", "web-product-visibility.json");
  const data = readJsonFile(file, { products: {} });
  data.products = data.products || {};

  const overridesFile = path.join(root, "data", "admin-overrides.json");
  const overrides = readJsonFile(overridesFile, { products: {}, categories: {} });
  overrides.products = overrides.products || {};

  const now = new Date().toISOString();
  const nowLocal = now.replace("T", " ").slice(0, 19);
  const flag = Boolean(visible);

  for (const id of ids) {
    data.products[id] = { visible: flag, updatedAt: now };
    const prev = overrides.products[id] || {};
    overrides.products[id] = {
      ...prev,
      available: flag,
      updatedBy: "website",
      updatedAt: nowLocal,
    };
  }

  data.updatedAt = now;
  writeJsonFile(file, data);
  writeJsonFile(overridesFile, overrides);

  return { ok: true, visible: flag, count: ids.length, products: data.products };
}

