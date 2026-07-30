(function () {
  const STYLE_ID = "arp-mededeling-style";
  const BAR_ID = "arp-mededeling-bar";

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${BAR_ID} {
        position: sticky;
        top: 0;
        z-index: 60;
        width: 100%;
        background: #0b1424;
        border-bottom: 1px solid rgba(96, 165, 250, 0.25);
        color: #7dd3fc;
        text-align: center;
        padding: 0.55rem 1rem;
        font-size: clamp(0.72rem, 1.6vw, 0.9rem);
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        line-height: 1.35;
      }
      #${BAR_ID}[hidden] { display: none !important; }
    `;
    document.head.appendChild(style);
  }

  function ensureBar() {
    let bar = document.getElementById(BAR_ID);
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = BAR_ID;
    bar.hidden = true;
    bar.setAttribute("role", "status");
    const root = document.getElementById("root");
    if (root && root.parentNode) {
      root.parentNode.insertBefore(bar, root);
    } else {
      document.body.prepend(bar);
    }
    return bar;
  }

  async function refresh() {
    try {
      const res = await fetch("/api/announcements", { credentials: "same-origin" });
      const data = await res.json();
      ensureStyle();
      const bar = ensureBar();
      if (data.enabled && data.text) {
        bar.textContent = data.text;
        bar.hidden = false;
      } else {
        bar.hidden = true;
        bar.textContent = "";
      }
    } catch {
      /* ignore */
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refresh);
  } else {
    refresh();
  }
  setInterval(refresh, 15000);
})();
