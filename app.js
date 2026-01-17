/* Everything Console — scaffold
   - Notes + Projects stored in IndexedDB
   - Alerts are computed (due/stale)
   - Export/Import JSON for snapshots
*/

const DB_NAME = "everything_console_db";
const DB_VERSION = 1;
const STORE = "items";

// ---------- Utilities ----------
const $ = (sel) => document.querySelector(sel);
const nowISO = () => new Date().toISOString();
const fmt = (iso) => {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
};

function extractTags(text) {
  const matches = text.match(/#[a-z0-9\-_]+/gi) || [];
  return [...new Set(matches.map(t => t.toLowerCase()))];
}

function parseDue(text) {
  // due:YYYY-MM-DD (simple)
  const m = text.match(/due:(\d{2}-\d{2}-\d{4})/i);
  if (!m) return null;
  const d = new Date(m[1] + "T09:00:00"); // local-ish
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function shortBody(text, max = 220) {
  const s = (text || "").trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function systemStateFrom(alertCount) {
  if (alertCount >= 6) return { label: "CRITICAL", cls: "bad" };
  if (alertCount >= 1) return { label: "DRIFT", cls: "warn" };
  return { label: "STABLE", cls: "ok" };
}

function setPill(el, label, cls) {
  el.textContent = label;
  el.style.borderColor = cls === "bad" ? "rgba(255,142,142,.45)"
    : cls === "warn" ? "rgba(255,211,138,.45)"
    : "rgba(166,255,191,.40)";
  el.style.background = cls === "bad" ? "rgba(255,142,142,.10)"
    : cls === "warn" ? "rgba(255,211,138,.10)"
    : "rgba(166,255,191,.08)";
}

// ---------- IndexedDB minimal wrapper ----------
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("type", "type", { unique: false });
        os.createIndex("updatedAt", "updatedAt", { unique: false });
        os.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const os = tx.objectStore(STORE);
    const req = os.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE).put(item);
  });
}

async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE).delete(id);
  });
}

async function dbClear() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE).clear();
  });
}

// ---------- App state ----------
let ALL = [];
let FILTER = "";

// ---------- Rendering ----------
function render() {
  const filterText = FILTER.trim().toLowerCase();

  const filtered = ALL.filter(it => {
    if (!filterText) return true;
    const hay = `${it.type} ${it.title} ${it.body} ${(it.tags || []).join(" ")}`.toLowerCase();
    return hay.includes(filterText);
  });

  const notes = filtered.filter(i => i.type === "note").sort((a,b) => (b.updatedAt||"").localeCompare(a.updatedAt||""));
  const projects = filtered.filter(i => i.type === "project").sort((a,b) => (b.updatedAt||"").localeCompare(a.updatedAt||""));

  $("#inboxCount").textContent = String(notes.length);

  // Alerts (computed)
  const alerts = computeAlerts(ALL);
  $("#alertCount").textContent = String(alerts.length);
  const st = systemStateFrom(alerts.length);
  setPill($("#systemState"), st.label, st.cls);

  $("#alerts").innerHTML = alerts.length ? "" : `<div class="micro">No alerts. System stable.</div>`;
  for (const a of alerts.slice(0, 8)) {
    $("#alerts").appendChild(renderItemCard(a, { isAlert:true }));
  }

  // Radar: last touched across all types
  const radar = [...ALL].sort((a,b)=> (b.updatedAt||"").localeCompare(a.updatedAt||"")).slice(0, 6);
  $("#radar").innerHTML = radar.length ? "" : `<div class="micro">Nothing yet. Add a note above.</div>`;
  for (const it of radar) $("#radar").appendChild(renderItemCard(it));

  // Projects/Notes lists
  $("#projects").innerHTML = projects.length ? "" : `<div class="micro">No projects. Try <code>/project</code> in capture.</div>`;
  for (const it of projects.slice(0, 20)) $("#projects").appendChild(renderItemCard(it));

  $("#notes").innerHTML = notes.length ? "" : `<div class="micro">No notes.</div>`;
  for (const it of notes.slice(0, 30)) $("#notes").appendChild(renderItemCard(it));
}

function renderItemCard(item, opts = {}) {
  const el = document.createElement("div");
  el.className = "item";

  const metaRight = opts.isAlert
    ? (item.alertLabel || "ALERT")
    : `${item.type.toUpperCase()} • ${fmt(item.updatedAt || item.createdAt)}`;

  const title = item.title || "(untitled)";
  const body = item.body || "";
  const tags = item.tags || [];

  el.innerHTML = `
    <div class="item__top">
      <div class="item__title">${escapeHtml(title)}</div>
      <div class="item__meta">${escapeHtml(metaRight)}</div>
    </div>
    ${body ? `<div class="item__body">${escapeHtml(shortBody(body))}</div>` : ``}
    ${tags.length ? `<div class="tags">${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>` : ``}
  `;

  el.addEventListener("click", () => openEditor(item.id));
  return el;
}

function escapeHtml(s) {
  return (s ?? "").toString()
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// ---------- Alerts ----------
function computeAlerts(items) {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const STALE_DAYS = 21;

  const alerts = [];

  for (const it of items) {
    const updated = new Date(it.updatedAt || it.createdAt || nowISO()).getTime();

    // Due
    if (it.dueAt && !it.done) {
      const due = new Date(it.dueAt).getTime();
      if (!isNaN(due)) {
        if (due <= now) {
          alerts.push({
            ...it,
            alertLabel: "DUE / OVERDUE",
            title: it.title || it.body?.slice(0, 40) || "Due item",
          });
          continue;
        }
        if (due <= now + DAY) {
          alerts.push({ ...it, alertLabel: "DUE SOON" });
          continue;
        }
      }
    }

    // Stale (projects especially, but applies to anything tagged #project or type project)
    const isProjectish = it.type === "project" || (it.tags || []).includes("#project");
    if (isProjectish) {
      const ageDays = Math.floor((now - updated) / DAY);
      if (ageDays >= STALE_DAYS) {
        alerts.push({
          ...it,
          alertLabel: `STALE • ${ageDays}d`,
          title: it.title || "Stale project",
        });
      }
    }
  }

  // Sort: overdue first then stale
  const rank = (a) => (a.alertLabel?.includes("OVERDUE") ? 0 : a.alertLabel?.includes("DUE") ? 1 : 2);
  alerts.sort((a,b) => rank(a) - rank(b));
  return alerts;
}

// ---------- Create / Edit ----------
function makeId() {
  // simple unique id
  return "id_" + crypto.getRandomValues(new Uint32Array(2)).join("_");
}

async function addItem(type, text) {
  const raw = (text || "").trim();
  if (!raw) return;

  const tags = extractTags(raw);
  const dueAt = parseDue(raw);
  const createdAt = nowISO();

  // Title heuristic:
  // - If first line is short, treat it as title; else synthesize
  const lines = raw.split("\n");
  const first = lines[0].trim();
  let title = first.length <= 60 ? first : `${type.toUpperCase()} • ${first.slice(0, 40)}…`;

  // Commands can override title
  if (raw.toLowerCase().startsWith("/project")) {
    type = "project";
    title = first.replace(/^\/project\s*/i, "").trim() || "New Project";
  }
  if (raw.toLowerCase().startsWith("/task")) {
    type = "task";
    title = first.replace(/^\/task\s*/i, "").trim() || "New Task";
  }

  const item = {
    id: makeId(),
    type,
    title,
    body: raw,
    tags,
    createdAt,
    updatedAt: createdAt,
    dueAt,
    done: false,
    nextAction: type === "project" ? "" : undefined,
  };

  await dbPut(item);
  await refresh();
}

async function openEditor(id) {
  const item = ALL.find(i => i.id === id);
  if (!item) return;

  // Simple prompt-based editor for now (scaffold):
  // - edit body
  // - quick delete
  // Upgrade later to a side-panel modal.
  const action = prompt(
    `EDIT: ${item.type.toUpperCase()}\n\n1) OK = edit body\n2) Type "done" to toggle done (tasks)\n3) Type "delete" to remove\n\nCurrent body:`,
    item.body || ""
  );

  if (action === null) return;

  const cmd = action.trim().toLowerCase();
  if (cmd === "delete") {
    await dbDelete(item.id);
    await refresh();
    return;
  }
  if (cmd === "done") {
    item.done = !item.done;
    item.updatedAt = nowISO();
    await dbPut(item);
    await refresh();
    return;
  }

  // Update body/title/tags/due
  item.body = action;
  item.tags = extractTags(action);
  item.dueAt = parseDue(action);
  item.updatedAt = nowISO();

  // update title heuristic again
  const first = (action.split("\n")[0] || "").trim();
  if (first && first.length <= 80) item.title = first;

  await dbPut(item);
  await refresh();
}

// ---------- Backup / Restore ----------
function downloadJSON(obj, filename = "everything-console-backup.json") {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function exportAll() {
  const payload = {
    exportedAt: nowISO(),
    app: "everything-console",
    version: 1,
    items: ALL,
  };
  downloadJSON(payload);
}

async function importAll(file) {
  const text = await file.text();
  const json = JSON.parse(text);
  const items = Array.isArray(json.items) ? json.items : [];
  // Merge strategy: upsert by id
  for (const it of items) {
    if (!it.id) it.id = makeId();
    if (!it.createdAt) it.createdAt = nowISO();
    if (!it.updatedAt) it.updatedAt = it.createdAt;
    await dbPut(it);
  }
  await refresh();
}

// ---------- Seed ----------
async function seedDemo() {
  const demo = [
    {
      type:"project",
      title:"Cruxfade — polish pass",
      body:"Cruxfade — polish pass\n\nNext: slow battle pacing a touch, add damage float.\nTags: #cruxfade #ui #project",
      tags:["#cruxfade","#ui","#project"],
      nextAction:"slow pacing + damage float",
    },
    {
      type:"note",
      title:"Coherence vibe idea",
      body:"Coherence vibe idea\n\nMinimal grid + microtext + calm motion. Busy enough to be eye-entertaining.\n#design #dashboard",
      tags:["#design","#dashboard"],
    },
    {
      type:"task",
      title:"Print new bookmarks",
      body:"/task Print new bookmarks due:2026-01-20\n\nRemember to bring display stand.\n#fairweather #prints",
      tags:["#fairweather","#prints"],
      dueAt: new Date("2026-01-20T09:00:00").toISOString(),
      done:false
    }
  ];

  for (const d of demo) {
    const createdAt = nowISO();
    await dbPut({
      id: makeId(),
      type: d.type,
      title: d.title,
      body: d.body,
      tags: d.tags || [],
      createdAt,
      updatedAt: createdAt,
      dueAt: d.dueAt || null,
      done: d.done || false,
      nextAction: d.nextAction || "",
    });
  }
  await refresh();
}

// ---------- Refresh + boot ----------
async function refresh() {
  ALL = await dbGetAll();
  render();
}

function tickClock() {
  const d = new Date();
  $("#localTime").textContent = d.toLocaleTimeString(undefined, { hour12: false });
}

// ---------- Events ----------
function wireUI() {
  $("#btnSaveNote").addEventListener("click", async () => {
    await addItem("note", $("#captureInput").value);
    $("#captureInput").value = "";
  });

  $("#btnSaveProject").addEventListener("click", async () => {
    await addItem("project", "/project " + $("#captureInput").value);
    $("#captureInput").value = "";
  });

  $("#filterInput").addEventListener("input", (e) => {
    FILTER = e.target.value;
    render();
  });

  $("#btnExport").addEventListener("click", exportAll);

  $("#importFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await importAll(file);
    e.target.value = "";
  });

  $("#btnSeed").addEventListener("click", seedDemo);

  $("#btnWipe").addEventListener("click", async () => {
    const ok = confirm("Wipe local data for Everything Console on this browser? (Cannot be undone unless you exported.)");
    if (!ok) return;
    await dbClear();
    await refresh();
  });

  // Capture: Enter saves note; Shift+Enter newline.
  $("#captureInput").addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      await addItem("note", $("#captureInput").value);
      $("#captureInput").value = "";
    }
  });
}

async function boot() {
  wireUI();
  await refresh();
  tickClock();
  setInterval(tickClock, 250);

  // Focus capture on load for “console” feel
  setTimeout(() => $("#captureInput").focus(), 120);
}

boot().catch(err => {
  console.error(err);
  alert("Boot error. Check console for details.");
});
