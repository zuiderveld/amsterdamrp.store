const titles = {
  overview: "Overzicht",
  mededelingen: "Mededelingen",
  site: "Site & onderhoud",
  server: "Server status",
  shop: "Webshop",
  products: "Producten",
  roles: "Discord rollen",
  leaderboards: "Leaderboards",
  payments: "Betalingen",
  links: "Links",
};

const PRESETS = {
  "preset-opening": "🎉 SERVER OPENING! | ONTVANG DIRECT INGAME ⚡ | 11K+ DISCORD LEDEN!",
  "preset-event": "⚡ WEEKEND EVENT LIVE! | SPEEL MEE EN WIN PRIJZEN | JOIN NU",
  "preset-update": "🛠️ GROTE UPDATE ONLINE! | NIEUWE FEATURES & FIXES | HERSTART DE GAME",
  "preset-sale": "💰 SHOP SALE ACTIEF! | KORTING OP VIP & COINS | BEKIJK /doneren",
  "preset-restart": "🔄 SERVER RESTART OVER ENKELE MINUTEN | SLA OP WAT JE DOET",
  "preset-discord": "💬 JOIN ONZE DISCORD! | SUPPORT · SOLLICITEREN · EVENTS | discord.gg/rRSeCBb25A",
};

let settings = null;
let catalog = null;
let catalogSource = "—";
let selectedCategoryId = null;
let rolePackages = [];
let roleMeta = { botConfigured: false, guildId: null };
let leaderboards = null;
let payments = [];
let durableStore = false;

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), 2200);
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.reason || data.message || `HTTP ${res.status}`);
  return data;
}

function setTab(name) {
  $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab").forEach((t) => t.classList.toggle("hidden", t.id !== `tab-${name}`));
  $("#page-title").textContent = titles[name] || name;
  if (name === "products" || name === "shop" || name === "overview") {
    renderShop();
    updateCatalogMeta();
    if (!(catalog?.categories || []).length) {
      loadCatalog().then(() => {
        updateCatalogMeta();
        renderShop();
      });
    }
  }
  if (name === "roles") {
    loadRoleGrants().catch(() => {});
  }
}

function fillForms() {
  if (!settings) return;
  $("#maint-msg").value = settings.maintenanceMessage || "";
  const durableHint = $("#durable-hint");
  if (durableHint) {
    durableHint.textContent = durableStore
      ? "Instellingen worden duurzaam opgeslagen (Upstash)."
      : "Let op: op Vercel zonder Upstash verdwijnen onderhoud/mededelingen na een cold start. Zet UPSTASH_REDIS_REST_URL + TOKEN.";
  }
  const maintHint = $("#maint-hint");
  if (maintHint && settings.maintenance) {
    maintHint.innerHTML =
      "<strong>Onderhoud staat AAN.</strong> Jij ziet de site nog als admin. Test in <strong>incognito</strong> (uitgelogd).";
  } else if (maintHint) {
    maintHint.innerHTML =
      "Admins zien de website altijd. Test onderhoud in een <strong>incognito-venster</strong> (uitgelogd).";
  }
  $("#announce-on").checked = !!settings.announcementEnabled;
  $("#announce-text").value = settings.announcement || "";
  updateAnnouncePreview();
  renderAnnounceHistory();
  $("#srv-name").value = settings.server?.name || "";
  $("#srv-online").value = settings.server?.online ?? 0;
  $("#srv-max").value = settings.server?.max ?? 256;
  $("#srv-mode").value = settings.server?.onlineMode || "live";
  $("#srv-discord").value = settings.discordMembers ?? 0;
  $("#srv-cfx").value = settings.cfxCode || "";
  $("#link-discord").value = settings.discordInvite || "";
  $("#link-cfx").value = settings.cfxJoin || "";
  $("#link-guild").value = settings.guildId || "";

  if ($("#pay-stripe")) {
    $("#pay-stripe").value = settings.payments?.stripe ? "on" : "off";
  }
  if ($("#pay-tebex")) {
    $("#pay-tebex").value = settings.payments?.tebex ? "on" : "off";
  }
  const stripeHint = $("#pay-stripe-hint");
  if (stripeHint) {
    stripeHint.textContent = settings._stripeConfigured
      ? "STRIPE_SECRET_KEY is gezet."
      : "Zet STRIPE_SECRET_KEY in Vercel Variables om Stripe te gebruiken.";
  }
  const payStatus = $("#pay-methods-status");
  if (payStatus) {
    const stripeOn = settings.payments?.stripe;
    const tebexOn = settings.payments?.tebex;
    if (!stripeOn && !tebexOn) {
      payStatus.textContent = "Alle methodes UIT → checkout stuurt naar Discord.";
    } else {
      payStatus.textContent = `Actief: ${[stripeOn ? "Stripe" : null, tebexOn ? "Tebex" : null].filter(Boolean).join(" + ")}`;
    }
  }

  const pill = $("#live-pill");
  if (pill) {
    if (settings.maintenance) {
      pill.textContent = "ONDERHOUD";
      pill.className = "status-pill warn";
    } else {
      pill.textContent = "OPENBAAR";
      pill.className = "status-pill ok";
    }
  }
  const ovSite = $("#ov-site");
  if (ovSite) ovSite.textContent = settings.maintenance ? "In onderhoud" : "Openbaar";
  const ovOnline = $("#ov-online");
  if (ovOnline) ovOnline.textContent = `${settings.server?.online ?? 0}/${settings.server?.max ?? 0}`;
  const ovDiscord = $("#ov-discord");
  if (ovDiscord) ovDiscord.textContent = String(settings.discordMembers ?? 0);

  updateCatalogMeta();
}

function updateCatalogMeta() {
  const pkgCount = (catalog?.categories || []).reduce((n, c) => n + (c.packages?.length || 0), 0);
  const ovPkg = $("#ov-packages");
  if (ovPkg) ovPkg.textContent = String(pkgCount);
  const sourceText = `Bron: ${catalogSource} · ${(catalog?.categories || []).length} categorieën · ${pkgCount} producten`;
  const shopSource = $("#shop-source");
  if (shopSource) shopSource.textContent = sourceText;
  const productsSource = $("#products-source");
  if (productsSource) productsSource.textContent = sourceText;
}

function renderShop() {
  const select = $("#pkg-cat");
  if (select) {
    select.innerHTML = "";
    for (const cat of catalog?.categories || []) {
      const opt = document.createElement("option");
      opt.value = cat.id;
      opt.textContent = cat.name;
      select.appendChild(opt);
    }
  }

  const cats = catalog?.categories || [];
  const tabs = $("#products-cats");
  const list = $("#products-list");
  if (!list) return;

  if (!cats.length) {
    if (tabs) tabs.innerHTML = "";
    list.innerHTML = `<div class="card"><p class="muted">Geen producten gevonden. Controleer <code>data/catalog.json</code> of klik <strong>Catalogus vernieuwen</strong>.</p></div>`;
    return;
  }

  if (!selectedCategoryId || !cats.some((c) => String(c.id) === String(selectedCategoryId))) {
    selectedCategoryId = cats[0].id;
  }

  if (tabs) {
    tabs.innerHTML = "";
    for (const cat of cats) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `cat-btn${String(cat.id) === String(selectedCategoryId) ? " active" : ""}`;
      btn.dataset.selectCat = String(cat.id);
      const count = (cat.packages || []).length;
      btn.innerHTML = `${escapeHtml(cat.name)} <span class="cat-count">${count}</span>`;
      tabs.appendChild(btn);
    }
  }

  const cat = cats.find((c) => String(c.id) === String(selectedCategoryId)) || cats[0];
  const pkgs = cat.packages || [];

  const box = document.createElement("div");
  box.className = "list-card";
  box.innerHTML = `<header>
    <div>
      <strong>${escapeHtml(cat.name)}</strong>
      <div class="meta">${pkgs.length} producten in deze categorie</div>
    </div>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" data-goto="shop">+ Pakket</button>
      <button class="btn btn-danger btn-sm" data-del-cat="${cat.id}">Verwijder categorie</button>
    </div>
  </header>`;

  if (!pkgs.length) {
    const empty = document.createElement("div");
    empty.className = "list-item";
    empty.innerHTML = `<div class="meta">Geen producten in deze categorie</div>`;
    box.appendChild(empty);
  }

  for (const pkg of pkgs) {
    const grant = rolePackages.find((p) => String(p.id) === String(pkg.id));
    const roleLabel =
      grant?.enabled && grant?.roleIds?.length
        ? `Discord rol: ${(grant.roleIds || []).join(", ")}`
        : "Discord rol: uit";
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `
      <div class="pkg-main">
        <img class="pkg-thumb" src="${escapeHtml(pkg.image || pkg.remoteImage || "/assets/img/logo-t.png")}" alt="" onerror="this.src='/assets/img/logo-t.png'" />
        <div>
          <strong>${escapeHtml(pkg.name)}</strong>
          <div class="meta">ID ${escapeHtml(String(pkg.id))} · ${escapeHtml(roleLabel)}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
        <span class="price">${
          pkg.currency === "COINS"
            ? `${Number(pkg.totalPrice).toLocaleString("nl-NL")} coins`
            : `€${Number(pkg.totalPrice).toFixed(2)}`
        }</span>
        ${
          pkg.tebexwrapperCoins != null
            ? `<span class="meta">→ ${Number(pkg.tebexwrapperCoins)} ingame</span>`
            : pkg.source === "ingame"
              ? `<span class="meta">ingame</span>`
              : ""
        }
        <button class="btn ${pkg.visible !== false ? "btn-ok" : "btn-ghost"} btn-sm" data-toggle-visible="${pkg.id}" title="Zelfde setting voor website en ingame">
          ${pkg.visible !== false ? "Zichtbaar" : "Verborgen"}
        </button>
        <button class="btn btn-ghost btn-sm" data-edit-pkg="${cat.id}:${pkg.id}">Bewerken</button>
        <button class="btn btn-danger btn-sm" data-del-pkg="${cat.id}:${pkg.id}">Verwijder</button>
      </div>`;
    box.appendChild(row);
  }

  list.innerHTML = "";
  list.appendChild(box);

  if (select && cat) select.value = String(cat.id);
}

function renderRoles() {
  const list = $("#roles-list");
  const status = $("#roles-status");
  if (!list) return;
  list.innerHTML = "";
  if (status) {
    status.textContent = `Bot: ${roleMeta.botConfigured ? "OK" : "ontbreekt"} · Guild: ${roleMeta.guildId || "onbekend"} · ${rolePackages.length} pakketten`;
  }
  if (!rolePackages.length) {
    list.innerHTML = `<div class="card"><p class="muted">Geen pakketten. Zet TEBEX_SECRET in Vercel Variables en klik Vernieuwen.</p></div>`;
    return;
  }
  const byCat = new Map();
  for (const pkg of rolePackages) {
    const key = pkg.category || "Overig";
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key).push(pkg);
  }
  for (const [catName, pkgs] of byCat) {
    const box = document.createElement("div");
    box.className = "list-card";
    box.innerHTML = `<header><strong>${escapeHtml(catName)}</strong><span class="meta">${pkgs.length} pakketten</span></header>`;
    for (const pkg of pkgs) {
      const row = document.createElement("div");
      row.className = "list-item role-row";
      row.innerHTML = `
        <div class="role-info">
          <strong>${escapeHtml(pkg.name)}</strong>
          <div class="meta">Tebex ID ${escapeHtml(String(pkg.id))} · €${Number(pkg.price || 0).toFixed(2)}</div>
        </div>
        <div class="role-controls">
          <label class="switch"><input type="checkbox" data-role-enabled="${pkg.id}" ${pkg.enabled ? "checked" : ""} /><span>Aan</span></label>
          <input type="text" data-role-ids="${pkg.id}" value="${escapeHtml((pkg.roleIds || []).join(", "))}" placeholder="Discord role ID(s)" />
          <button class="btn btn-primary btn-sm" data-save-role="${pkg.id}">Opslaan</button>
        </div>`;
      box.appendChild(row);
    }
    list.appendChild(box);
  }
}

async function loadRoleGrants() {
  const res = await api("/api/admin/role-grants");
  rolePackages = res.packages || [];
  roleMeta = { botConfigured: Boolean(res.botConfigured), guildId: res.guildId || null };
  renderRoles();
  return res;
}

function renderLeaderboards() {
  const list = $("#lb-list");
  if (!list) return;
  list.innerHTML = "";
  const boards = [
    ["coins", "Coins"],
    ["spent", "Uitgegeven"],
    ["spentWeekly", "Deze week"],
  ];
  for (const [key, label] of boards) {
    const rows = leaderboards?.[key] || [];
    const box = document.createElement("div");
    box.className = "list-card";
    box.innerHTML = `<header><strong>${label}</strong><span class="meta">${rows.length} spelers</span></header>`;
    rows.forEach((r, i) => {
      const row = document.createElement("div");
      row.className = "list-item";
      row.innerHTML = `
        <div><strong>#${i + 1} ${escapeHtml(r.name)}</strong></div>
        <div style="display:flex;gap:.75rem;align-items:center">
          <span class="price">${Number(r.value).toLocaleString("nl-NL")}</span>
          <button class="btn btn-danger btn-sm" data-del-lb="${key}:${i}">X</button>
        </div>`;
      box.appendChild(row);
    });
    list.appendChild(box);
  }
}

function renderPayments() {
  const list = $("#pay-list");
  if (!list) return;
  list.innerHTML = `<div class="list-card"><header><strong>Recente betalingen</strong></header></div>`;
  const box = list.querySelector(".list-card");
  (payments || []).forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(p.name)}</strong>
        <div class="meta">${escapeHtml((p.packages || []).join(", "))}</div>
      </div>
      <div style="display:flex;gap:.75rem;align-items:center">
        <span class="meta">${p.date ? new Date(p.date).toLocaleString("nl-NL") : ""}</span>
        <button class="btn btn-danger btn-sm" data-del-pay="${i}">X</button>
      </div>`;
    box.appendChild(row);
  });
}

function updateAnnouncePreview() {
  const el = $("#announce-preview");
  if (!el) return;
  const on = $("#announce-on")?.checked;
  const text = ($("#announce-text")?.value || "").trim();
  if (on && text) {
    el.textContent = text;
    el.classList.add("active");
  } else {
    el.textContent = "Geen actieve mededeling";
    el.classList.remove("active");
  }
}

function renderAnnounceHistory() {
  const box = $("#announce-history");
  if (!box) return;
  const items = settings?.announcementHistory || [];
  if (!items.length) {
    box.innerHTML = `<span class="muted small">Nog geen eerdere mededelingen.</span>`;
    return;
  }
  box.innerHTML = items
    .slice(0, 12)
    .map(
      (item, i) => `<div class="list-item" style="padding:.55rem 0;border-bottom:1px solid var(--border)">
      <div><strong style="font-size:.85rem">${escapeHtml(item.text || "")}</strong>
      <div class="meta">${item.at ? new Date(item.at).toLocaleString("nl-NL") : ""}</div></div>
      <button class="btn btn-ghost btn-sm" data-reuse-announce="${i}">Gebruik</button>
    </div>`
    )
    .join("");
}

async function publishAnnouncement(text, enabled = true) {
  $("#announce-text").value = text;
  $("#announce-on").checked = enabled;
  updateAnnouncePreview();
  await saveSettings({
    announcement: text,
    announcementEnabled: enabled,
  });
  try {
    if (enabled && text) {
      localStorage.setItem(
        "arp_announcement_v1",
        JSON.stringify({ enabled: true, text, updatedAt: new Date().toISOString() })
      );
    } else {
      localStorage.removeItem("arp_announcement_v1");
    }
  } catch {
    /* ignore */
  }
  toast(enabled ? "Mededeling live — blijft staan na refresh" : "Mededeling uitgezet");
}

async function loadCatalog(forceRefresh = false) {
  const refresh = forceRefresh ? "?refresh=1" : "";
  try {
    const c = await api(`/api/admin/catalog${refresh}`);
    if (c?.catalog?.categories) {
      catalog = c.catalog;
      catalogSource = c.source || "catalog";
      return catalog;
    }
  } catch (err) {
    console.warn("admin catalog:", err.message);
  }
  try {
    const store = await api("/api/store/catalog");
    if (store?.categories) {
      catalog = store;
      catalogSource = "store";
      return catalog;
    }
    if (Array.isArray(store)) {
      catalog = { categories: store };
      catalogSource = "store";
      return catalog;
    }
  } catch (err) {
    console.warn("store catalog:", err.message);
  }
  if (!catalog) catalog = { categories: [] };
  return catalog;
}

async function reloadAll(opts = {}) {
  // Catalogus eerst + meteen tonen (niet laten crashen door andere tabs)
  try {
    await loadCatalog(Boolean(opts.refresh));
  } catch (err) {
    console.warn("catalog load:", err);
    if (!catalog) catalog = { categories: [] };
  }
  updateCatalogMeta();
  renderShop();

  const settled = await Promise.allSettled([
    api("/api/admin/settings"),
    api("/api/admin/leaderboards"),
    api("/api/admin/payments"),
  ]);
  const [s, l, p] = settled.map((r) => (r.status === "fulfilled" ? r.value : null));

  if (s?.settings) {
    settings = s.settings;
    durableStore = Boolean(s.durableStore);
  }
  if (l?.leaderboards) leaderboards = l.leaderboards;
  if (p?.payments) payments = p.payments || [];

  try {
    if (settings) fillForms();
  } catch (err) {
    console.warn("fillForms:", err);
  }
  try {
    renderLeaderboards();
  } catch (err) {
    console.warn("leaderboards:", err);
  }
  try {
    renderPayments();
  } catch (err) {
    console.warn("payments:", err);
  }
  try {
    await loadRoleGrants();
  } catch {
    /* optional */
  }

  updateCatalogMeta();
  renderShop();
}

async function saveSettings(patch) {
  const body = { ...settings, ...patch };
  delete body._stripeConfigured;
  delete body.paymentMethods;
  if (patch.server) body.server = { ...settings.server, ...patch.server };
  if (patch.payments) {
    body.payments = {
      stripe: Boolean(patch.payments.stripe),
      tebex: Boolean(patch.payments.tebex),
    };
  }
  const res = await api("/api/admin/settings", { method: "PUT", body: JSON.stringify(body) });
  settings = res.settings;
  fillForms();
  toast("Opgeslagen");
  return res;
}

async function handleAction(action) {
  try {
    switch (action) {
      case "maintenance-on": {
        const res = await api("/api/admin/maintenance", {
          method: "POST",
          body: JSON.stringify({ enabled: true, message: $("#maint-msg").value }),
        });
        await reloadAll();
        toast(res.note || "Onderhoudmodus AAN — test in incognito");
        break;
      }
      case "publish": {
        await api("/api/admin/publish", { method: "POST", body: "{}" });
        await reloadAll();
        toast("Website openbaar");
        break;
      }
      case "shop-refresh":
        await reloadAll({ refresh: true });
        setTab("products");
        toast(`Catalogus: ${catalogSource} (${(catalog?.categories || []).reduce((n, c) => n + (c.packages?.length || 0), 0)} pakketten)`);
        break;
      case "sync-ingame": {
        const res = await api("/api/admin/catalog/sync-ingame", { method: "POST", body: "{}" });
        catalog = res.catalog || catalog;
        renderShop();
        updateCatalogMeta();
        const sync = res.sync || {};
        toast(
          sync.ok
            ? `Gesynchroniseerd → redeem ${sync.redeem?.count ?? 0}, store ${sync.storeProducts ?? 0}`
            : `Sync mislukt: ${sync.reason || "onbekend"}`
        );
        break;
      }
      case "visibility-all-on":
      case "visibility-all-off":
      case "visibility-cat-on":
      case "visibility-cat-off": {
        const visible = action.endsWith("-on");
        const onlyCat = action.includes("-cat-");
        const label = onlyCat ? "deze categorie" : "alle producten";
        if (!confirm(`${visible ? "Zichtbaar" : "Verborgen"} zetten voor ${label}? (website + ingame)`)) break;
        const body = { visible, scope: onlyCat ? "category" : "all" };
        if (onlyCat) body.categoryId = selectedCategoryId;
        const res = await api("/api/admin/catalog/visibility", {
          method: "PUT",
          body: JSON.stringify(body),
        });
        await reloadAll();
        toast(`${res.count || 0} producten ${visible ? "zichtbaar" : "verborgen"}`);
        break;
      }
      case "roles-reload":
        await loadRoleGrants();
        toast("Rollen vernieuwd");
        break;
      case "roles-sync": {
        const res = await api("/api/admin/role-grants");
        const sync = res.wrapperSync;
        toast(sync?.ok ? `Gesynchroniseerd (${sync.count})` : `Sync: ${sync?.reason || "mislukt"}`);
        break;
      }
      case "save-maint-msg":
        await saveSettings({ maintenanceMessage: $("#maint-msg").value });
        break;
      case "save-announce":
        await saveSettings({
          announcementEnabled: $("#announce-on").checked,
          announcement: $("#announce-text").value,
        });
        updateAnnouncePreview();
        break;
      case "announce-publish":
        await publishAnnouncement(($("#announce-text").value || "").trim(), true);
        await reloadAll();
        break;
      case "announce-clear":
        await publishAnnouncement("", false);
        await reloadAll();
        break;
      case "preset-opening":
      case "preset-event":
      case "preset-update":
      case "preset-sale":
      case "preset-restart":
      case "preset-discord":
        await publishAnnouncement(PRESETS[action], true);
        await reloadAll();
        break;
      case "save-server":
        await saveSettings({
          server: {
            name: $("#srv-name").value,
            online: Number($("#srv-online").value),
            max: Number($("#srv-max").value),
            onlineMode: $("#srv-mode").value,
          },
          discordMembers: Number($("#srv-discord").value),
          cfxCode: $("#srv-cfx").value.trim(),
          cfxJoin: `https://cfx.re/join/${$("#srv-cfx").value.trim() || "4zjlgq"}`,
        });
        break;
      case "refresh-live": {
        const live = await api("/api/admin/live-status", { method: "GET" });
        const info = $("#live-info");
        if (info) {
          info.textContent = `FiveM: ${live.server.online}/${live.server.max} (${live.server.ok ? "live" : "fout"}) · Discord: ${live.discord.members} (${live.discord.ok ? "live" : "fout"})`;
        }
        await reloadAll();
        toast("Live status vernieuwd");
        break;
      }
      case "online-plus":
        await saveSettings({ server: { online: (settings.server.online || 0) + 10 } });
        break;
      case "online-minus":
        await saveSettings({ server: { online: Math.max(0, (settings.server.online || 0) - 10) } });
        break;
      case "online-full":
        await saveSettings({ server: { online: settings.server.max || 256 } });
        break;
      case "online-zero":
        await saveSettings({ server: { online: 0 } });
        break;
      case "discord-plus":
        await saveSettings({ discordMembers: (settings.discordMembers || 0) + 100 });
        break;
      case "discord-minus":
        await saveSettings({ discordMembers: Math.max(0, (settings.discordMembers || 0) - 100) });
        break;
      case "save-links":
        await saveSettings({
          discordInvite: $("#link-discord").value,
          cfxJoin: $("#link-cfx").value,
          guildId: $("#link-guild").value,
        });
        break;
      case "save-payments": {
        const payments = {
          stripe: $("#pay-stripe")?.value === "on",
          tebex: $("#pay-tebex")?.value === "on",
        };
        await saveSettings({ payments });
        toast(
          payments.stripe || payments.tebex
            ? `Opgeslagen — Stripe: ${payments.stripe ? "On" : "Off"}, Tebex: ${payments.tebex ? "On" : "Off"}`
            : "Alles uit — checkout gaat naar Discord"
        );
        break;
      }
      case "add-category":
        await api("/api/admin/catalog/category", {
          method: "POST",
          body: JSON.stringify({
            name: $("#cat-name").value || "Nieuwe categorie",
            description: $("#cat-desc").value || "",
          }),
        });
        $("#cat-name").value = "";
        $("#cat-desc").value = "";
        await reloadAll();
        toast("Categorie toegevoegd");
        break;
      case "add-package": {
        const discordOn = $("#pkg-discord-enabled")?.value === "on";
        const discordRole = ($("#pkg-discord-role")?.value || "").trim();
        if (discordOn && !/^\d{17,20}$/.test(discordRole)) {
          toast("Zet Discord rol op Off, of vul een geldige Role ID in");
          break;
        }
        const pkgIdRaw = ($("#pkg-id")?.value || "").trim();
        const coinsRaw = ($("#pkg-coins")?.value || "").trim();
        const res = await api("/api/admin/catalog/package", {
          method: "POST",
          body: JSON.stringify({
            categoryId: $("#pkg-cat").value,
            pkg: {
              id: pkgIdRaw || undefined,
              name: $("#pkg-name").value,
              description: $("#pkg-desc").value,
              totalPrice: Number($("#pkg-price").value),
              discount: Number($("#pkg-discount").value),
              image: $("#pkg-image").value,
              tebexwrapperCoins: coinsRaw === "" ? undefined : Number(coinsRaw),
              ingameType: $("#pkg-ingame-type")?.value || "item",
              syncIngame: $("#pkg-sync-ingame")?.value !== "off",
              discordRoleEnabled: discordOn,
              discordRoleId: discordOn ? discordRole : "",
            },
          }),
        });
        const savedId = res.package?.id || pkgIdRaw;
        if (savedId) {
          await api(`/api/admin/role-grants/${savedId}`, {
            method: "PUT",
            body: JSON.stringify({
              enabled: discordOn,
              roleIds: discordOn ? discordRole : "",
              label: $("#pkg-name").value || "",
            }),
          });
        }
        await reloadAll();
        const synced = res.storeSync?.ok || res.redeemSync?.ok;
        toast(synced ? "Pakket opgeslagen + gesync’t naar tebexwrapper" : "Pakket opgeslagen");
        break;
      }
      case "lb-add": {
        const board = $("#lb-board").value;
        const next = { ...leaderboards };
        next[board] = [...(next[board] || []), { name: $("#lb-name").value, value: Number($("#lb-value").value) }];
        next[board].sort((a, b) => b.value - a.value);
        await api("/api/admin/leaderboards", { method: "PUT", body: JSON.stringify({ leaderboards: next }) });
        $("#lb-name").value = "";
        $("#lb-value").value = "";
        await reloadAll();
        toast("Speler toegevoegd");
        break;
      }
      case "lb-sort": {
        const board = $("#lb-board").value;
        const next = { ...leaderboards };
        next[board] = [...(next[board] || [])].sort((a, b) => b.value - a.value);
        await api("/api/admin/leaderboards", { method: "PUT", body: JSON.stringify({ leaderboards: next }) });
        await reloadAll();
        break;
      }
      case "lb-clear": {
        const board = $("#lb-board").value;
        if (!confirm(`Board "${board}" legen?`)) return;
        const next = { ...leaderboards, [board]: [] };
        await api("/api/admin/leaderboards", { method: "PUT", body: JSON.stringify({ leaderboards: next }) });
        await reloadAll();
        break;
      }
      case "pay-add":
        await api("/api/admin/payments", {
          method: "POST",
          body: JSON.stringify({
            name: $("#pay-name").value,
            packages: $("#pay-pkg").value.split(",").map((s) => s.trim()).filter(Boolean),
          }),
        });
        $("#pay-name").value = "";
        $("#pay-pkg").value = "";
        await reloadAll();
        toast("Betaling toegevoegd");
        break;
      case "reload-all":
        await reloadAll();
        toast("Herladen");
        break;
      default:
        break;
    }
  } catch (err) {
    toast(err.message || "Fout");
  }
}

async function boot() {
  try {
    const me = await api("/api/admin/me");
    const status = $("#gate-status");
    if (!me.oauthConfigured && me.devBypass) {
      status.textContent = "DEV_ADMIN_BYPASS staat aan (geen Discord OAuth).";
    } else if (!me.oauthConfigured) {
      status.textContent = "Zet DISCORD_CLIENT_ID / SECRET / GUILD_ID in .env";
    } else if (!me.guildConfigured) {
      status.textContent = "Zet DISCORD_GUILD_ID in .env voor role-check.";
    }

    if (!me.loggedIn) return;
    if (!me.isAdmin) {
      status.textContent = "Ingelogd, maar je hebt niet de admin-role.";
      return;
    }

    $("#gate").classList.add("hidden");
    $("#app").classList.remove("hidden");
    $("#admin-name").textContent = me.user.globalName || me.user.username;
    await reloadAll();
  } catch (err) {
    $("#gate-status").textContent = err.message;
  }
}

document.addEventListener("click", async (e) => {
  const nav = e.target.closest(".nav-btn");
  if (nav) return setTab(nav.dataset.tab);

  const selectCat = e.target.closest("[data-select-cat]");
  if (selectCat) {
    selectedCategoryId = selectCat.dataset.selectCat;
    renderShop();
    return;
  }

  const toggleVis = e.target.closest("[data-toggle-visible]");
  if (toggleVis) {
    const id = toggleVis.dataset.toggleVisible;
    const pkg = (catalog?.categories || [])
      .flatMap((c) => c.packages || [])
      .find((p) => String(p.id) === String(id));
    const next = !(pkg?.visible !== false);
    try {
      const res = await api(`/api/admin/catalog/visibility/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({ visible: next }),
      });
      if (pkg) pkg.visible = Boolean(res.visible);
      renderShop();
      toast(next ? "Zichtbaar op website + ingame" : "Verborgen op website + ingame");
    } catch (err) {
      toast(err.message || "Zichtbaarheid opslaan mislukt");
    }
    return;
  }

  const goto = e.target.closest("[data-goto]");
  if (goto) return setTab(goto.dataset.goto);

  const action = e.target.closest("[data-action]");
  if (action) return handleAction(action.dataset.action);

  const delCat = e.target.closest("[data-del-cat]");
  if (delCat) {
    if (!confirm("Categorie verwijderen?")) return;
    await api(`/api/admin/catalog/category/${delCat.dataset.delCat}`, { method: "DELETE" });
    await reloadAll();
    return toast("Categorie verwijderd");
  }

  const delPkg = e.target.closest("[data-del-pkg]");
  if (delPkg) {
    const [catId, pkgId] = delPkg.dataset.delPkg.split(":");
    await api(`/api/admin/catalog/package/${catId}/${pkgId}`, { method: "DELETE" });
    await reloadAll();
    return toast("Pakket verwijderd");
  }

  const editPkg = e.target.closest("[data-edit-pkg]");
  if (editPkg) {
    const [catId, pkgId] = editPkg.dataset.editPkg.split(":");
    const cat = (catalog?.categories || []).find((c) => String(c.id) === String(catId));
    const pkg = (cat?.packages || []).find((p) => String(p.id) === String(pkgId));
    if (!pkg) return toast("Pakket niet gevonden");
    $("#pkg-cat").value = String(catId);
    $("#pkg-name").value = pkg.name || "";
    $("#pkg-id").value = String(pkg.id || "");
    $("#pkg-price").value = Number(pkg.totalPrice || 0);
    $("#pkg-discount").value = Number(pkg.discount || 0);
    if ($("#pkg-coins")) {
      $("#pkg-coins").value =
        pkg.tebexwrapperCoins != null ? Number(pkg.tebexwrapperCoins) : pkg.ingameCoins != null ? Number(pkg.ingameCoins) : "";
    }
    if ($("#pkg-ingame-type")) $("#pkg-ingame-type").value = pkg.ingameType || pkg.type || "item";
    if ($("#pkg-sync-ingame")) {
      $("#pkg-sync-ingame").value = pkg.syncIngame === false && pkg.source !== "ingame" ? "off" : "on";
    }
    $("#pkg-desc").value = pkg.description || "";
    $("#pkg-image").value = pkg.image || pkg.remoteImage || "/assets/img/logo-t.png";
    const grant = rolePackages.find((p) => String(p.id) === String(pkg.id));
    const discordOn = Boolean(grant?.enabled && grant?.roleIds?.length);
    $("#pkg-discord-enabled").value = discordOn ? "on" : "off";
    $("#pkg-discord-role").value = discordOn ? (grant.roleIds || []).join(", ") : "";
    syncDiscordRoleField();
    setTab("shop");
    $("#pkg-name")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return toast("Pakket in het formulier geladen");
  }

  const delLb = e.target.closest("[data-del-lb]");
  if (delLb) {
    const [board, idx] = delLb.dataset.delLb.split(":");
    const next = { ...leaderboards };
    next[board] = [...(next[board] || [])];
    next[board].splice(Number(idx), 1);
    await api("/api/admin/leaderboards", { method: "PUT", body: JSON.stringify({ leaderboards: next }) });
    await reloadAll();
    return;
  }

  const delPay = e.target.closest("[data-del-pay]");
  if (delPay) {
    await api(`/api/admin/payments/${delPay.dataset.delPay}`, { method: "DELETE" });
    await reloadAll();
    return;
  }

  const saveRole = e.target.closest("[data-save-role]");
  if (saveRole) {
    const id = saveRole.dataset.saveRole;
    const enabled = document.querySelector(`[data-role-enabled="${id}"]`)?.checked;
    const roleIds = document.querySelector(`[data-role-ids="${id}"]`)?.value || "";
    const pkg = rolePackages.find((p) => String(p.id) === String(id));
    await api(`/api/admin/role-grants/${id}`, {
      method: "PUT",
      body: JSON.stringify({ enabled: Boolean(enabled), roleIds, label: pkg?.name || "" }),
    });
    await loadRoleGrants();
    return toast(enabled ? "Rol-koppeling opgeslagen" : "Rol-koppeling uitgezet");
  }

  const reuse = e.target.closest("[data-reuse-announce]");
  if (reuse) {
    const items = settings?.announcementHistory || [];
    const item = items[Number(reuse.dataset.reuseAnnounce)];
    if (item?.text) {
      $("#announce-text").value = item.text;
      updateAnnouncePreview();
      setTab("mededelingen");
    }
  }
});

$("#announce-text")?.addEventListener("input", updateAnnouncePreview);
$("#announce-on")?.addEventListener("change", updateAnnouncePreview);

function syncDiscordRoleField() {
  const on = $("#pkg-discord-enabled")?.value === "on";
  const input = $("#pkg-discord-role");
  if (!input) return;
  input.disabled = !on;
  if (!on) input.placeholder = "Zet Discord rol op On om een Role ID in te vullen";
  else {
    input.placeholder = "Discord Role ID";
    input.focus();
  }
}
$("#pkg-discord-enabled")?.addEventListener("change", syncDiscordRoleField);
syncDiscordRoleField();

// Betaalmethodes: direct opslaan bij wijzigen (niet alleen via knop)
async function autosavePayments() {
  try {
    const payments = {
      stripe: $("#pay-stripe")?.value === "on",
      tebex: $("#pay-tebex")?.value === "on",
    };
    await saveSettings({ payments });
    toast(
      payments.stripe || payments.tebex
        ? `Stripe ${payments.stripe ? "On" : "Off"} · Tebex ${payments.tebex ? "On" : "Off"}`
        : "Alles uit → Discord-checkout"
    );
  } catch (err) {
    toast(err.message || "Opslaan mislukt");
  }
}
$("#pay-stripe")?.addEventListener("change", autosavePayments);
$("#pay-tebex")?.addEventListener("change", autosavePayments);

$("#logout")?.addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST", body: "{}" });
  location.href = "/admin";
});

boot();
