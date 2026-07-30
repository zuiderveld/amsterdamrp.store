(function () {
  const STYLE_ID = "arp-mededeling-style";
  const BAR_ID = "arp-mededeling-bar";
  const ADMIN_BAR_ID = "arp-admin-maint-bar";
  const CACHE_KEY = "arp_announcement_v1";

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
      #${ADMIN_BAR_ID} {
        position: sticky;
        top: 0;
        z-index: 61;
        width: 100%;
        background: #422006;
        border-bottom: 1px solid rgba(245, 158, 11, 0.45);
        color: #fbbf24;
        text-align: center;
        padding: 0.55rem 1rem;
        font-size: 0.85rem;
        font-weight: 700;
      }
      #${ADMIN_BAR_ID}[hidden] { display: none !important; }
    `;
    document.head.appendChild(style);
  }

  function ensureBar(id) {
    let bar = document.getElementById(id);
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = id;
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

  function showAnnouncement(text) {
    ensureStyle();
    const bar = ensureBar(BAR_ID);
    if (text) {
      bar.textContent = text;
      bar.hidden = false;
    } else {
      bar.hidden = true;
      bar.textContent = "";
    }
  }

  function readCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    } catch {
      return null;
    }
  }

  function writeCache(data) {
    try {
      if (data?.enabled && data?.text) {
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
      } else {
        localStorage.removeItem(CACHE_KEY);
      }
    } catch {
      /* ignore */
    }
  }

  // Paint cached announcement immediately so refresh keeps the banner visible
  const cached = readCache();
  if (cached?.enabled && cached?.text) showAnnouncement(cached.text);

  async function refresh() {
    try {
      ensureStyle();
      const [annRes, cfgRes, meRes] = await Promise.all([
        fetch("/api/announcements", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/site/public-config", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/admin/me", { credentials: "same-origin", cache: "no-store" }),
      ]);
      const data = await annRes.json();
      const cfg = await cfgRes.json().catch(() => ({}));
      const me = await meRes.json().catch(() => ({}));

      if (data.enabled && data.text) {
        writeCache(data);
        showAnnouncement(data.text);
      } else {
        writeCache(null);
        showAnnouncement("");
      }

      const adminBar = ensureBar(ADMIN_BAR_ID);
      if (cfg.maintenance && me.isAdmin) {
        adminBar.textContent =
          "ONDERHOUD ACTIEF — jij ziet de site omdat je admin bent. Bezoekers zien de onderhoudspagina (test in incognito).";
        adminBar.hidden = false;
      } else {
        adminBar.hidden = true;
      }

      if (cfg.maintenance && !me.isAdmin && !location.pathname.startsWith("/admin")) {
        if (!location.pathname.includes("maintenance")) {
          location.replace("/maintenance.html");
        }
      }
    } catch {
      const fallback = readCache();
      if (fallback?.enabled && fallback?.text) showAnnouncement(fallback.text);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refresh);
  } else {
    refresh();
  }
  setInterval(refresh, 10000);
})();
