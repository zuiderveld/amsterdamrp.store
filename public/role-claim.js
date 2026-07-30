(async function afterCheckout() {
  try {
    const params = new URLSearchParams(window.location.search);
    const ordered = params.get("ordered") === "1";
    const paid = params.get("paid") === "1";
    const cancelled = params.get("cancelled") === "1";
    if (!ordered && !paid && !cancelled) return;

    const orderId = params.get("order");
    const sessionId = params.get("session_id");
    let claimFromUrl = params.get("claim");

    function banner(text, color) {
      const bar = document.createElement("div");
      bar.setAttribute("role", "status");
      bar.style.cssText =
        "position:sticky;top:0;z-index:70;width:100%;background:" +
        color +
        ";border-bottom:1px solid rgba(255,255,255,.12);color:#ecfdf5;text-align:center;padding:.7rem 1rem;font-weight:700;font-size:.9rem;line-height:1.4";
      bar.innerHTML = text;
      const root = document.getElementById("root");
      if (root?.parentNode) root.parentNode.insertBefore(bar, root);
      else document.body.prepend(bar);
    }

    if (cancelled) {
      banner("Betaling geannuleerd. Je winkelwagen is bewaard.", "#7c2d12");
      return;
    }

    let claimCode = claimFromUrl;
    let claimCoins = null;

    if (paid && sessionId) {
      const res = await fetch(
        `/api/store/stripe/confirm?session_id=${encodeURIComponent(sessionId)}&order=${encodeURIComponent(orderId || "")}`,
        { credentials: "same-origin", cache: "no-store" }
      );
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        claimCode = data.claimCode || claimCode;
        claimCoins = data.claimCoins;
        const claimHint = claimCode
          ? `<br/><span style="font-weight:800;letter-spacing:.04em">In-game claimen: /claimstore ${claimCode}</span>` +
            (claimCoins != null ? ` (${claimCoins} coins)` : "")
          : "";
        banner(
          (data.granted?.length
            ? `Betaling gelukt${orderId ? " (" + orderId + ")" : ""}. Discord-rol(len) toegekend.`
            : `Betaling gelukt${orderId ? " (" + orderId + ")" : ""}.`) + claimHint,
          "#052e16"
        );
      } else {
        banner("Betaling wordt gecontroleerd… neem contact op via Discord als dit blijft hangen.", "#1e3a8a");
      }
    } else if (ordered) {
      const claimHint = claimCode
        ? `<br/><span style="font-weight:800;letter-spacing:.04em">In-game claimen: /claimstore ${claimCode}</span>`
        : "";
      banner(
        (orderId ? `Bestelling ${orderId} is geplaatst.` : "Bestelling geplaatst.") + claimHint,
        "#052e16"
      );
    }

    if (paid || ordered) {
      await fetch("/api/store/claim-roles", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => {});
    }
  } catch (err) {
    console.info("[AmsterdamRP] Checkout follow-up overgeslagen", err);
  }
})();
