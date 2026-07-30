const titles = {
  overview: "Overzicht",
  mededelingen: "Mededelingen",
  site: "Site & onderhoud",
  server: "Server status",
  shop: "Webshop",
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
let rolePackages = [];
let roleMeta = { botConfigured: false, guildId: null };
let leaderboards = null;
let payments = [];

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

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
}

function fillForms() {
  if (!settings) return;
  $("#maint-msg").value = settings.maintenanceMessage || "";
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

  const pill = $("#live-pill");
  if (settings.maintenance) {
    pill.textContent = "ONDERHOUD";
    pill.className = "status-pill warn";
    $("#ov-site").textContent = "In onderhoud";
  } else {
    pill.textContent = "OPENBAAR";
    pill.className = "status-pill ok";
    $("#ov-site").textContent = "Openbaar";
  }
  $("#ov-online").textContent = `${settings.server?.online ?? 0}/${settings.server?.max ?? 0}`;
  $("#ov-discord").textContent = String(settings.discordMembers ?? 0);

  const pkgCount = (catalog?.categories || []).reduce((n, c) => n + (c.packages?.length || 0), 0);
  $("#ov-packages").textContent = String(pkgCount);
}

function renderShop() {
  const list = $("#shop-list");
  const select = $("#pkg-cat");
  select.innerHTML = "";
  list.innerHTML = "";

  for (const cat of catalog?.categories || []) {
    const opt = document.createElement("option");
    opt.value = cat.id;
    opt.textContent = cat.name;
    select.appendChild(opt);

    const box = document.createElement("div");
    box.className = "list-card";
    box.innerHTML = `<header>
      <div><strong>${escapeHtml(cat.name)}</strong><div class="meta">${escapeHtml(cat.description || "")}</div></div>
      <button class="btn btn-danger btn-sm" data-del-cat="${cat.id}">Verwijder categorie</button>
    </header>`;
    for (const pkg of cat.packages || []) {
      const row = document.createElement("div");
      row.className = "list-item";
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(pkg.name)}</strong>
          <div class="meta">${escapeHtml(pkg.description || "")}</div>
        </div>
        <div style="display:flex;align-items:center;gap:.75rem">
          <span class="price">€${Number(pkg.totalPrice).toFixed(2)}</span>
          <button class="btn btn-danger btn-sm" data-del-pkg="${cat.id}:${pkg.id}">Verwijder</button>
        </div>`;
      box.appendChild(row);
    }
    list.appendChild(box);
  }
}

function renderRoles() {
  const list = $("#roles-list");
  const status = $("#roles-status");
  if (!list) return;
  list.innerHTML = "";
  if (status) {
    status.textContent = `Bot: ${roleMeta.botConfigured ? "OK" : "ontbreekt (DISCORD_BOT_TOKEN)"} · Guild: ${roleMeta.guildId || "onbekend"} · ${rolePackages.length} pakketten`;
  }

  if (!rolePackages.length) {
    list.innerHTML = `<div class="card"><p class="muted">Geen pakketten in catalogus. Open eerst de webshop of herlaad zodat Tebex-pakketten geladen zijn.</p></div>`;
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
          <label class="switch">
            <input type="checkbox" data-role-enabled="${pkg.id}" ${pkg.enabled ? "checked" : ""} />
            <span>Aan</span>
          </label>
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
  roleMeta = {
    botConfigured: Boolean(res.botConfigured),
    guildId: res.guildId || null,
  };
  renderRoles();
  return res;
}

function renderLeaderboards() {
  const list = $("#lb-list");
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
  toast(enabled ? "Mededeling live op de website" : "Mededeling uitgezet");
}

async function reloadAll() {
  const [s, c, l, p] = await Promise.all([
    api("/api/admin/settings"),
    api("/api/admin/catalog"),
    api("/api/admin/leaderboards"),
    api("/api/admin/payments"),
  ]);
  settings = s.settings;
  catalog = c.catalog;
  leaderboards = l.leaderboards;
  payments = p.payments || [];
  fillForms();
  renderShop();
  renderLeaderboards();
  renderPayments();
  try {
    await loadRoleGrants();
  } catch {
    /* optional */
  }
}

async function saveSettings(patch) {
  const body = { ...settings, ...patch };
  if (patch.server) body.server = { ...settings.server, ...patch.server };
  const res = await api("/api/admin/settings", { method: "PUT", body: JSON.stringify(body) });
  settings = res.settings;
  fillForms();
  toast("Opgeslagen");
}

async function handleAction(action) {
  try {
    switch (action) {
      case "maintenance-on":
        await api("/api/admin/maintenance", {
          method: "POST",
          body: JSON.stringify({ enabled: true, message: $("#maint-msg").value }),
        });
        await reloadAll();
        toast("Onderhoudmodus AAN");
        break;
      case "publish":
        await api("/api/admin/publish", { method: "POST", body: "{}" });
        await reloadAll();
        toast("Website openbaar");
        break;
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
      case "add-package":
        await api("/api/admin/catalog/package", {
          method: "POST",
          body: JSON.stringify({
            categoryId: $("#pkg-cat").value,
            pkg: {
              name: $("#pkg-name").value,
              description: $("#pkg-desc").value,
              totalPrice: Number($("#pkg-price").value),
              discount: Number($("#pkg-discount").value),
              image: $("#pkg-image").value,
            },
          }),
        });
        await reloadAll();
        toast("Pakket opgeslagen");
        break;
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
      case "roles-reload":
        await loadRoleGrants();
        toast("Rollen vernieuwd");
        break;
      case "roles-sync": {
        const res = await api("/api/admin/role-grants");
        const sync = res.wrapperSync;
        toast(sync?.ok ? `Gesynchroniseerd (${sync.count} pakketten)` : `Sync mislukt: ${sync?.reason || "?"}`);
        break;
      }
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
      status.textContent = "Zet DISCORD_CLIENT_ID / SECRET / GUILD_ID in Vercel Environment Variables.";
    } else if (!me.guildConfigured) {
      status.textContent = "Zet DISCORD_GUILD_ID in Vercel Environment Variables.";
    }

    if (!me.loggedIn) {
      status.textContent =
        (status.textContent ? status.textContent + " " : "") +
        "Log in met Discord om het admin panel te openen.";
      return;
    }
    if (!me.isAdmin) {
      status.innerHTML = `Ingelogd als <strong>${me.user?.globalName || me.user?.username || "?"}</strong>, maar je hebt niet de admin-role.<br/>Nodig: role <code>${me.adminRoleId}</code> · guild <code>${me.guildId || "?"}</code> · roles gevonden: ${me.roleCount ?? 0}`;
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
      body: JSON.stringify({
        enabled: Boolean(enabled),
        roleIds,
        label: pkg?.name || "",
      }),
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

$("#logout")?.addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST", body: "{}" });
  location.href = "/admin";
});

boot();
