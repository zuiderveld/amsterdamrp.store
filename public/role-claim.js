(async function afterCheckout() {
  try {
    const params = new URLSearchParams(window.location.search);
    const ordered = params.get("ordered") === "1";
    const paid = params.get("paid") === "1";
    const cancelled = params.get("cancelled") === "1";
    if (!ordered && !paid && !cancelled) return;

    const orderId = params.get("order");
    const sessionId = params.get("session_id");

    function banner(text, color) {
      const bar = document.createElement("div");
      bar.setAttribute("role", "status");
      bar.style.cssText =
        "position:sticky;top:0;z-index:70;width:100%;background:" +
        color +
        ";border-bottom:1px solid rgba(255,255,255,.12);color:#ecfdf5;text-align:center;padding:.7rem 1rem;font-weight:700;font-size:.9rem";
      bar.textContent = text;
      const root = document.getElementById("root");
      if (root?.parentNode) root.parentNode.insertBefore(bar, root);
      else document.body.prepend(bar);
    }

    if (cancelled) {
      banner("Betaling geannuleerd. Je winkelwagen is bewaard.", "#7c2d12");
      return;
    }

    if (paid && sessionId) {
      const res = await fetch(
        `/api/store/stripe/confirm?session_id=${encodeURIComponent(sessionId)}&order=${encodeURIComponent(orderId || "")}`,
        { credentials: "same-origin", cache: "no-store" }
      );
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        banner(
          data.granted?.length
            ? `Betaling gelukt${orderId ? " (" + orderId + ")" : ""}. Discord-rol(len) toegekend.`
            : `Betaling gelukt${orderId ? " (" + orderId + ")" : ""}. Staff verwerkt je aankoop.`,
          "#052e16"
        );
      } else {
        banner("Betaling wordt gecontroleerd… neem contact op via Discord als dit blijft hangen.", "#1e3a8a");
      }
      return;
    }

    if (ordered) {
      banner(
        orderId
          ? `Bestelling ${orderId} is geplaatst.`
          : "Bestelling geplaatst.",
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
