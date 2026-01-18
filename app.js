/* Everything Console v2 — Two-pane with week view
   - Notes + Projects + Scheduled items in IndexedDB
   - Week view with collapsible days
   - Auto-schedule with day prefixes (monday:, tue:, etc.)
   - Alerts computed, Recent log chronological
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
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${month}/${day}/${year} ${hours}:${minutes}`;
  } catch { return iso; }
};

function extractTags(text) {
  const matches = text.match(/#[a-z0-9\-_]+/gi) || [];
  return [...new Set(matches.map(t => t.toLowerCase()))];
}

function parseDue(text) {
  // Try dd-mm-yyyy first (European/display style)
  let m = text.match(/due:(\d{2})-(\d{2})-(\d{4})/i);
  if (m) {
    const [_, day, month, year] = m;
    const d = new Date(`${year}-${month}-${day}T09:00:00`);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  
  // Fall back to yyyy-mm-dd (ISO style)
  m = text.match(/due:(\d{4})-(\d{2})-(\d{2})/i);
  if (!m) return null;
  const d = new Date(m[1] + "T09:00:00");
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function shortBody(text, max = 180) {
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
  el.style.borderColor = cls === "bad" ? "rgba(184,92,92,.45)"
    : cls === "warn" ? "rgba(166,124,82,.45)"
    : "rgba(90,143,111,.40)";
  el.style.background = cls === "bad" ? "rgba(184,92,92,.10)"
    : cls === "warn" ? "rgba(166,124,82,.10)"
    : "rgba(90,143,111,.08)";
}

function escapeHtml(s) {
  return (s ?? "").toString()
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function escapeMd(s) {
  return (s || "").replace(/([#_*~`])/g, "\\$1");
}

// ---------- Filter utilities ----------
function getAllTags() {
  const tagSet = new Set();
  for (const item of ALL) {
    if (item.tags) {
      for (const tag of item.tags) {
        tagSet.add(tag);
      }
    }
  }
  return Array.from(tagSet).sort();
}

function matchesFilter(item) {
  // If no filter, show everything
  if (FILTER_TEXT === "" && ACTIVE_TAGS.size === 0) return true;
  
  const searchText = FILTER_TEXT.toLowerCase();
  const itemText = `${item.type} ${item.title} ${item.body} ${(item.tags || []).join(" ")}`.toLowerCase();
  
  // Check text filter
  const matchesText = searchText === "" || itemText.includes(searchText);
  
  // Check tag filters - item must have ALL active tags
  let matchesTags = true;
  if (ACTIVE_TAGS.size > 0) {
    const itemTags = new Set(item.tags || []);
    matchesTags = Array.from(ACTIVE_TAGS).every(tag => itemTags.has(tag));
  }
  
  return matchesText && matchesTags;
}

function toggleTagFilter(tag) {
  if (ACTIVE_TAGS.has(tag)) {
    ACTIVE_TAGS.delete(tag);
  } else {
    ACTIVE_TAGS.add(tag);
  }
  render();
}

function clearFilter() {
  FILTER_TEXT = "";
  ACTIVE_TAGS.clear();
  $("#filterInput").value = "";
  render();
}

// ---------- Week utilities ----------
function getWeekBounds(date = new Date()) {
  // Get current week (Monday-Sunday)
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  
  return { monday, sunday };
}

function getDayOfWeek(date) {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return days[new Date(date).getDay()];
}

function getTodayDayName() {
  return getDayOfWeek(new Date());
}

function parseDay(text) {
  // Check for day prefix: "monday: task" or "mon: task"
  const dayMap = {
    'mon': 'monday', 'monday': 'monday',
    'tue': 'tuesday', 'tues': 'tuesday', 'tuesday': 'tuesday',
    'wed': 'wednesday', 'wednesday': 'wednesday',
    'thu': 'thursday', 'thur': 'thursday', 'thurs': 'thursday', 'thursday': 'thursday',
    'fri': 'friday', 'friday': 'friday',
    'sat': 'saturday', 'saturday': 'saturday',
    'sun': 'sunday', 'sunday': 'sunday'
  };
  
  for (const [abbr, full] of Object.entries(dayMap)) {
    const regex = new RegExp(`^${abbr}:\\s*`, 'i');
    if (regex.test(text)) {
      return { day: full, text: text.replace(regex, '') };
    }
  }
  
  return null;
}

function getWeekDays() {
  const { monday } = getWeekBounds();
  const days = [];
  const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  
  for (let i = 0; i < 7; i++) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    days.push({
      name: dayNames[i],
      date: date,
      dateStr: date.toISOString().split('T')[0],
      display: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    });
  }
  
  return days;
}

function formatWeekRange() {
  const { monday, sunday } = getWeekBounds();
  const monStr = monday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const sunStr = sunday.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${monStr} – ${sunStr}`;
}

// ---------- IndexedDB ----------
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
        os.createIndex("scheduledDay", "scheduledDay", { unique: false });
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
let EXPANDED_DAYS = new Set([getTodayDayName()]); // Today expanded by default
let FILTER_TEXT = "";
let ACTIVE_TAGS = new Set(); // Active tag filters
let COLLAPSED_PANELS = new Set(JSON.parse(localStorage.getItem('collapsed_panels') || '[]'));

// ---------- Create / Edit ----------
function makeId() {
  return "id_" + crypto.getRandomValues(new Uint32Array(2)).join("_");
}

async function addItem(text) {
  const raw = (text || "").trim();
  if (!raw) return;

  const createdAt = nowISO();
  let type = "note"; // default
  let title = "";
  let body = raw;
  let scheduledDay = null; // for week scheduling
  
  // Check for day prefix
  const dayParse = parseDay(raw);
  if (dayParse) {
    scheduledDay = dayParse.day;
    body = dayParse.text;
    type = "task"; // scheduled items are tasks
  }

  // Check for command prefixes
  if (body.toLowerCase().startsWith("/project")) {
    type = "project";
    body = body.replace(/^\/project\s*/i, "").trim();
  } else if (body.toLowerCase().startsWith("/task")) {
    type = "task";
    body = body.replace(/^\/task\s*/i, "").trim();
  } else if (body.toLowerCase().startsWith("/note")) {
    type = "note";
    body = body.replace(/^\/note\s*/i, "").trim();
  }

  const tags = extractTags(body);
  const dueAt = parseDue(body);

  // Title heuristic - use first line if reasonable length, otherwise truncate
  const lines = body.split("\n");
  const first = lines[0].trim();
  if (first.length > 0 && first.length <= 80) {
    title = first;
  } else if (first.length > 80) {
    title = first.slice(0, 77) + "…";
  } else {
    title = "(untitled)";
  }

  const item = {
    id: makeId(),
    type,
    title,
    body,
    tags,
    createdAt,
    updatedAt: createdAt,
    dueAt,
    scheduledDay, // null for notes, or day name for scheduled
    done: false,
  };

  await dbPut(item);
  await refresh();
}

async function openEditor(id) {
  const item = ALL.find(i => i.id === id);
  if (!item) return;

  const action = prompt(
    `EDIT: ${item.type.toUpperCase()}\n\n1) OK = edit body\n2) Type "done" to toggle done\n3) Type "delete" to remove\n\nCurrent body:`,
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

  // Update body/tags/due
  item.body = action;
  
  // Re-parse command prefixes if present
  if (item.body.toLowerCase().startsWith("/project")) {
    item.type = "project";
    item.body = item.body.replace(/^\/project\s*/i, "").trim();
  } else if (item.body.toLowerCase().startsWith("/task")) {
    item.type = "task";
    item.body = item.body.replace(/^\/task\s*/i, "").trim();
  } else if (item.body.toLowerCase().startsWith("/note")) {
    item.type = "note";
    item.body = item.body.replace(/^\/note\s*/i, "").trim();
  }
  
  item.tags = extractTags(item.body);
  item.dueAt = parseDue(item.body);
  item.updatedAt = nowISO();

  // Re-parse day if changed
  const dayParse = parseDay(item.body);
  if (dayParse) {
    item.scheduledDay = dayParse.day;
    item.body = dayParse.text;
  }

  // Update title
  const first = (item.body.split("\n")[0] || "").trim();
  if (first.length > 0 && first.length <= 80) {
    item.title = first;
  } else if (first.length > 80) {
    item.title = first.slice(0, 77) + "…";
  }

  await dbPut(item);
  await refresh();
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

    // Stale projects
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

  const rank = (a) => (a.alertLabel?.includes("OVERDUE") ? 0 : a.alertLabel?.includes("DUE") ? 1 : 2);
  alerts.sort((a,b) => rank(a) - rank(b));
  return alerts;
}

// ---------- Rendering ----------
function render() {
  renderTopbar();
  renderTagChips();
  renderWeekView();
  renderNotes();
  renderAlerts();
  renderProjects();
  renderRecentLog();
}

function renderTagChips() {
  const allTags = getAllTags();
  const container = $("#tagChips");
  
  if (allTags.length === 0) {
    container.innerHTML = "";
    return;
  }
  
  container.innerHTML = "";
  for (const tag of allTags) {
    const chip = document.createElement("button");
    chip.className = `tag-chip ${ACTIVE_TAGS.has(tag) ? 'tag-chip--active' : ''}`;
    chip.textContent = tag;
    chip.addEventListener("click", () => toggleTagFilter(tag));
    container.appendChild(chip);
  }
}

function renderTopbar() {
  const alerts = computeAlerts(ALL);
  $("#alertCount").textContent = String(alerts.length);
  
  const st = systemStateFrom(alerts.length);
  setPill($("#systemState"), st.label, st.cls);
  
  // Week count: items scheduled this week
  const weekItems = ALL.filter(it => it.scheduledDay && !it.done);
  $("#weekCount").textContent = String(weekItems.length);
  
  $("#weekRange").textContent = formatWeekRange();
}

function renderWeekView() {
  const weekDays = getWeekDays();
  const today = getTodayDayName();
  const container = $("#weekView");
  container.innerHTML = "";
  
  const hasFilter = FILTER_TEXT !== "" || ACTIVE_TAGS.size > 0;

  for (const day of weekDays) {
    // Get ALL items for this day (don't filter yet)
    const allDayItems = ALL.filter(it => 
      it.scheduledDay === day.name && !it.done
    ).sort((a,b) => (a.createdAt||"").localeCompare(b.createdAt||""));
    
    // Then filter for display
    const dayItems = allDayItems.filter(matchesFilter);

    const isToday = day.name === today;
    const isExpanded = EXPANDED_DAYS.has(day.name);

    const dayEl = document.createElement("div");
    dayEl.className = `day ${isToday ? 'day--today' : ''} ${isExpanded ? 'day--expanded' : ''}`;

    const header = document.createElement("div");
    header.className = "day__header";
    header.innerHTML = `
      <div class="day__left">
        <span class="day__toggle">${isExpanded ? '▼' : '▶'}</span>
        <span class="day__name">${day.name}</span>
        <span class="day__date">${day.display}</span>
      </div>
      <span class="day__count">${dayItems.length}</span>
    `;
    
    header.addEventListener("click", () => toggleDay(day.name));
    dayEl.appendChild(header);

    const itemsContainer = document.createElement("div");
    itemsContainer.className = "day__items";
    
    if (dayItems.length === 0 && !hasFilter) {
      // No items at all on this day
      itemsContainer.innerHTML = '<div class="day__empty">No tasks scheduled</div>';
    } else if (dayItems.length === 0 && hasFilter) {
      // Items exist but none match filter
      itemsContainer.innerHTML = '<div class="day__empty">No matches for current filter</div>';
    } else {
      for (const item of dayItems) {
        const card = renderItemCard(item, { compact: true });
        if (hasFilter) {
          card.classList.add('item--match');
        }
        itemsContainer.appendChild(card);
      }
    }
    
    dayEl.appendChild(itemsContainer);
    container.appendChild(dayEl);
  }
}

function toggleDay(dayName) {
  if (EXPANDED_DAYS.has(dayName)) {
    EXPANDED_DAYS.delete(dayName);
  } else {
    EXPANDED_DAYS.add(dayName);
  }
  renderWeekView();
}

function renderNotes() {
  // Atemporal notes (not scheduled to a day)
  const notes = ALL.filter(it => 
    it.type === "note" && !it.scheduledDay && matchesFilter(it)
  ).sort((a,b) => (b.updatedAt||"").localeCompare(a.updatedAt||""));

  const container = $("#notesList");
  if (notes.length === 0) {
    const msg = (FILTER_TEXT || ACTIVE_TAGS.size > 0) 
      ? "No notes match filter." 
      : "No notes yet. Start capturing ideas above.";
    container.innerHTML = `<div class="empty">${msg}</div>`;
    return;
  }

  container.innerHTML = "";
  for (const note of notes.slice(0, 20)) {
    container.appendChild(renderItemCard(note));
  }
}

function renderAlerts() {
  const alerts = computeAlerts(ALL).filter(matchesFilter);
  const container = $("#alerts");
  
  if (alerts.length === 0) {
    const msg = (FILTER_TEXT || ACTIVE_TAGS.size > 0) 
      ? "No alerts match filter." 
      : "No alerts. System stable.";
    container.innerHTML = `<div class="empty">${msg}</div>`;
    return;
  }

  container.innerHTML = "";
  for (const alert of alerts.slice(0, 6)) {
    container.appendChild(renderItemCard(alert, { 
      compact: true, 
      isAlert: true 
    }));
  }
}

function renderProjects() {
  const projects = ALL.filter(it => it.type === "project" && matchesFilter(it))
    .sort((a,b) => (b.updatedAt||"").localeCompare(a.updatedAt||""));

  const container = $("#projects");
  if (projects.length === 0) {
    const msg = (FILTER_TEXT || ACTIVE_TAGS.size > 0) 
      ? "No projects match filter." 
      : "No projects. Use /project to create one.";
    container.innerHTML = `<div class="empty">${msg}</div>`;
    return;
  }

  container.innerHTML = "";
  for (const proj of projects.slice(0, 10)) {
    container.appendChild(renderItemCard(proj, { compact: true }));
  }
}

function renderRecentLog() {
  // All items sorted chronologically (most recent first)
  // This is the "dev log" view
  const recent = ALL.filter(matchesFilter)
    .sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||""));

  const container = $("#recentLog");
  if (recent.length === 0) {
    const msg = (FILTER_TEXT || ACTIVE_TAGS.size > 0) 
      ? "No entries match filter." 
      : "No entries yet.";
    container.innerHTML = `<div class="empty">${msg}</div>`;
    return;
  }

  container.innerHTML = "";
  for (const item of recent.slice(0, 8)) {
    container.appendChild(renderItemCard(item, { 
      compact: true,
      showDate: true 
    }));
  }
}

function renderItemCard(item, opts = {}) {
  const el = document.createElement("div");
  el.className = "item";

  let metaRight = "";
  if (opts.isAlert) {
    metaRight = item.alertLabel || "ALERT";
  } else if (opts.showDate) {
    const d = new Date(item.createdAt);
    metaRight = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } else {
    metaRight = item.type.toUpperCase();
  }

  const title = item.title || "(untitled)";
  const body = opts.compact ? "" : (item.body || "");
  const tags = item.tags || [];

  el.innerHTML = `
    <div class="item__top">
      <div class="item__title">${escapeHtml(title)}</div>
      <div class="item__meta">${escapeHtml(metaRight)}</div>
    </div>
    ${body && !opts.compact ? `<div class="item__body">${escapeHtml(shortBody(body))}</div>` : ``}
    ${tags.length && !opts.compact ? `<div class="tags">${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>` : ``}
  `;

  el.addEventListener("click", () => openEditor(item.id));
  return el;
}

// ---------- Backup / Restore ----------
function downloadJSON(obj, filename = "everything-console-backup.json", mimeType = "application/json") {
  const content = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  const blob = new Blob([content], { type: mimeType });
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
    app: "everything-console-v2",
    version: 2,
    items: ALL,
  };
  downloadJSON(payload);
}

async function exportMarkdown() {
  await refresh(); // ensure ALL is current
  let md = `# Everything Console Export – ${new Date().toLocaleDateString()}\n\n`;

  // Metadata
  md += "## Metadata\n";
  md += `Exported: ${new Date().toISOString()}\n`;
  md += `Items total: ${ALL.length}\n\n`;

  // Projects first
  md += "## Projects\n";
  const projects = ALL.filter(i => i.type === "project").sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  if (projects.length === 0) {
    md += "*No projects yet*\n\n";
  } else {
    for (const p of projects) {
      md += `### ${escapeMd(p.title)} ${p.tags?.join(" ") || ""}\n`;
      md += `Last updated: ${fmt(p.updatedAt)}\n`;
      md += `${escapeMd(p.body)}\n\n`;
    }
  }

  // Then week view
  md += "## This Week\n";
  const weekDays = getWeekDays();
  for (const day of weekDays) {
    const items = ALL.filter(i => i.scheduledDay === day.name && !i.done);
    if (items.length) {
      md += `### ${day.name.charAt(0).toUpperCase() + day.name.slice(1)} (${day.display})\n`;
      for (const i of items) md += `- [ ] ${escapeMd(i.title || i.body.slice(0,60))}\n`;
      md += "\n";
    }
  }

  // Notes
  md += "## All Notes (reverse chrono)\n";
  const notes = ALL.filter(i => i.type === "note").sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  if (notes.length === 0) {
    md += "*No notes yet*\n\n";
  } else {
    for (const n of notes) {
      const date = new Date(n.createdAt).toLocaleDateString();
      md += `- ${date}: ${escapeMd(n.title)} ${n.tags?.join(" ") || ""}\n`;
    }
    md += "\n";
  }

  // Archived / Done Items
  md += "## Archived / Done Items\n";
  const done = ALL.filter(i => i.done).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  if (done.length === 0) {
    md += "*No completed items yet*\n\n";
  } else {
    for (const d of done) {
      md += `- [x] ${escapeMd(d.title || d.body.slice(0,60))} (${d.type})\n`;
    }
  }

  downloadJSON(md, "everything-export.md", "text/markdown");
}

async function importAll(file) {
  const text = await file.text();
  const json = JSON.parse(text);
  const items = Array.isArray(json.items) ? json.items : [];
  
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
  const today = getTodayDayName();
  const tomorrow = {
    'monday': 'tuesday',
    'tuesday': 'wednesday',
    'wednesday': 'thursday',
    'thursday': 'friday',
    'friday': 'saturday',
    'saturday': 'sunday',
    'sunday': 'monday'
  }[today];

  const demo = [
    {
      type: "project",
      title: "Cruxfade — polish pass",
      body: "Cruxfade — polish pass\n\nNext: slow battle pacing a touch, add damage float.\nTags: #cruxfade #ui #project",
      tags: ["#cruxfade", "#ui", "#project"],
      scheduledDay: null,
    },
    {
      type: "note",
      title: "Coherence vibe idea",
      body: "Coherence vibe idea\n\nMinimal grid + microtext + calm motion. Busy enough to be eye-entertaining.\n#design #dashboard",
      tags: ["#design", "#dashboard"],
      scheduledDay: null,
    },
    {
      type: "task",
      title: "Review weekly goals",
      body: "Review weekly goals and update project timelines",
      tags: ["#planning"],
      scheduledDay: today,
    },
    {
      type: "task",
      title: "Print new bookmarks",
      body: "Remember to bring display stand.\n#fairweather #prints",
      tags: ["#fairweather", "#prints"],
      dueAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
      scheduledDay: tomorrow,
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
      scheduledDay: d.scheduledDay || null,
      done: false,
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
  // Capture: Enter saves
  $("#captureInput").addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      await addItem($("#captureInput").value);
      $("#captureInput").value = "";
    }
  });

  // Filter input
  $("#filterInput").addEventListener("input", (e) => {
    FILTER_TEXT = e.target.value.trim();
    render();
  });

  // Clear filter button
  $("#clearFilter").addEventListener("click", clearFilter);

  // Panel collapse toggles
  document.querySelectorAll('.panel__toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // Don't trigger other clicks
      const panelId = btn.dataset.panel;
      const panel = document.querySelector(`[data-panel-id="${panelId}"]`);
      if (panel) {
        panel.classList.toggle('panel--collapsed');

        // Save state
        if (panel.classList.contains('panel--collapsed')) {
          COLLAPSED_PANELS.add(panelId);
        } else {
          COLLAPSED_PANELS.delete(panelId);
        }
        localStorage.setItem('collapsed_panels', JSON.stringify([...COLLAPSED_PANELS]));
      }
    });
  });

  $("#btnExport").addEventListener("click", exportAll);

  $("#btnExportMd").addEventListener("click", exportMarkdown);

  $("#importFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await importAll(file);
    e.target.value = "";
  });

  $("#btnSeed").addEventListener("click", seedDemo);

  $("#btnWipe").addEventListener("click", async () => {
    const ok = confirm("Wipe all local data? (Cannot be undone unless you exported.)");
    if (!ok) return;
    await dbClear();
    await refresh();
  });
}

async function boot() {
  wireUI();
  await refresh();
  tickClock();
  setInterval(tickClock, 1000);

  // Restore collapsed state
  for (const panelId of COLLAPSED_PANELS) {
    const panel = document.querySelector(`[data-panel-id="${panelId}"]`);
    if (panel) panel.classList.add('panel--collapsed');
  }

  // Focus capture
  setTimeout(() => $("#captureInput").focus(), 120);
}

boot().catch(err => {
  console.error(err);
  alert("Boot error. Check console for details.");
});
