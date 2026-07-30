import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA =
  process.env.VERCEL === "1"
    ? path.join("/tmp", "amsterdamrp-data")
    : path.join(__dirname, "..", "data");

function ensure() {
  fs.mkdirSync(DATA, { recursive: true });
}

function readOrders() {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, "orders.json"), "utf8"));
  } catch {
    return { orders: [] };
  }
}

function writeOrders(data) {
  ensure();
  fs.writeFileSync(path.join(DATA, "orders.json"), JSON.stringify(data, null, 2));
}

export function getCheckoutProvider() {
  // Legacy env override; payment methods in settings are preferred
  const raw = String(process.env.CHECKOUT_PROVIDER || "auto").toLowerCase();
  if (raw === "tebex") return "tebex";
  if (raw === "native") return "native";
  return "auto";
}

export function createNativeOrder({
  user,
  items,
  serverId,
  coupon,
  catalogPackages = [],
  provider = "native",
  status = "placed",
}) {
  const cleaned = (items || [])
    .map((i) => ({
      id: Number(i.id),
      quantity: Math.max(1, Math.min(10, Number(i.quantity) || 1)),
    }))
    .filter((i) => i.id > 0);

  if (!cleaned.length) return { ok: false, reason: "empty_basket" };
  if (!serverId || String(serverId).trim().length < 1) {
    return { ok: false, reason: "bad_server_id" };
  }
  if (!user?.id) return { ok: false, reason: "not_logged_in" };

  const byId = new Map();
  for (const cat of catalogPackages || []) {
    for (const pkg of cat.packages || []) byId.set(Number(pkg.id), pkg);
  }

  const lines = cleaned.map((item) => {
    const pkg = byId.get(item.id);
    const unit = Number(pkg?.totalPrice || 0);
    return {
      id: item.id,
      name: pkg?.name || `Pakket #${item.id}`,
      quantity: item.quantity,
      unitPrice: unit,
      total: unit * item.quantity,
    };
  });

  const total = lines.reduce((sum, l) => sum + l.total, 0);
  const orderId = `ARP-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`;

  const order = {
    id: orderId,
    status,
    provider,
    createdAt: new Date().toISOString(),
    serverId: String(serverId),
    coupon: coupon || null,
    discord: {
      id: String(user.id),
      username: user.username || user.globalName || null,
    },
    items: lines,
    total,
    currency: "EUR",
  };

  const data = readOrders();
  data.orders.unshift(order);
  data.orders = data.orders.slice(0, 500);
  writeOrders(data);

  return { ok: true, order };
}

export function updateOrder(orderId, patch) {
  const data = readOrders();
  const idx = data.orders.findIndex((o) => o.id === orderId);
  if (idx < 0) return null;
  data.orders[idx] = { ...data.orders[idx], ...patch, updatedAt: new Date().toISOString() };
  writeOrders(data);
  return data.orders[idx];
}

export function getOrder(orderId) {
  return readOrders().orders.find((o) => o.id === orderId) || null;
}

export function listOrders(limit = 50) {
  return readOrders().orders.slice(0, limit);
}
