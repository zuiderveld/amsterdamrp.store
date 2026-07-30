/**
 * Stripe Checkout via REST (geen zware SDK nodig).
 */
function getSecret() {
  return process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET || "";
}

export function isStripeConfigured() {
  return Boolean(getSecret());
}

async function stripeForm(pathname, params) {
  const secret = getSecret();
  if (!secret) {
    const err = new Error("STRIPE_SECRET_KEY ontbreekt");
    err.code = "no_stripe";
    throw err;
  }
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    body.append(key, String(value));
  }
  const res = await fetch(`https://api.stripe.com/v1${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json?.error?.message || `Stripe HTTP ${res.status}`);
    err.code = "stripe_error";
    err.payload = json;
    throw err;
  }
  return json;
}

async function stripeGet(pathname) {
  const secret = getSecret();
  if (!secret) throw new Error("STRIPE_SECRET_KEY ontbreekt");
  const res = await fetch(`https://api.stripe.com/v1${pathname}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json?.error?.message || `Stripe HTTP ${res.status}`);
    err.code = "stripe_error";
    throw err;
  }
  return json;
}

export async function createStripeCheckoutSession({
  order,
  successUrl,
  cancelUrl,
}) {
  const params = {
    mode: "payment",
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: order.id,
    "metadata[orderId]": order.id,
    "metadata[serverId]": order.serverId || "",
    "metadata[discordId]": order.discord?.id || "",
    "metadata[packageIds]": (order.items || []).map((i) => i.id).join(","),
  };

  (order.items || []).forEach((item, index) => {
    const unitAmount = Math.max(0, Math.round(Number(item.unitPrice || 0) * 100));
    params[`line_items[${index}][quantity]`] = item.quantity || 1;
    params[`line_items[${index}][price_data][currency]`] = "eur";
    params[`line_items[${index}][price_data][unit_amount]`] = unitAmount;
    params[`line_items[${index}][price_data][product_data][name]`] = item.name || `Pakket ${item.id}`;
  });

  // Stripe requires at least one line item with amount > 0 usually; allow 0 for free
  if (!(order.items || []).length) {
    const err = new Error("Geen items voor Stripe");
    err.code = "empty_basket";
    throw err;
  }

  const session = await stripeForm("/checkout/sessions", params);
  return {
    id: session.id,
    url: session.url,
  };
}

export async function retrieveStripeSession(sessionId) {
  return stripeGet(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
}
