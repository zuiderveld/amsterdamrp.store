(async function claimDiscordRolesAfterPurchase() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("paid") !== "1") return;
    const res = await fetch("/api/store/claim-roles", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok && data.granted?.length) {
      console.info("[AmsterdamRP] Discord rollen toegekend:", data.granted.length);
    } else if (data.reason && data.reason !== "nothing_to_claim") {
      console.info("[AmsterdamRP] Role claim:", data.reason, data.detail || "");
    }
  } catch (err) {
    console.info("[AmsterdamRP] Role claim overgeslagen", err);
  }
})();
