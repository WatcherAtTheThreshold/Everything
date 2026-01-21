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
  const [_, year, month, day] = m;
  const d = new Date(`${year}-${month}-${day}T09:00:00`);
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

// Helper to format dates as YYYY-MM-DD in local time (avoid UTC shift)
function toLocalDateStr(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
      dateStr: toLocalDateStr(date), // FIX: Use local formatter instead of toISOString
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

// ---------- Month utilities ----------
function getMonthsForYear(year = new Date().getFullYear()) {
  const months = [];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  for (let i = 0; i < 12; i++) {
    months.push({
      index: i,
      name: monthNames[i],
      year: year,
      isCurrent: i === currentMonth && year === currentYear
    });
  }
  return months;
}

function getWeeksInMonth(year, month) {
  // Get all weeks that have days in this month
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const weeks = [];
  let currentDate = new Date(firstDay);

  // Move to Monday of first week
  const dayOfWeek = currentDate.getDay();
  const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  currentDate.setDate(currentDate.getDate() + daysToMonday);

  let weekIndex = 0;
  while (currentDate <= lastDay || (currentDate.getMonth() === month && currentDate <= lastDay)) {
    const weekStart = new Date(currentDate);
    const weekEnd = new Date(currentDate);
    weekEnd.setDate(weekEnd.getDate() + 6);

    weeks.push({
      index: weekIndex,
      start: weekStart,
      end: weekEnd,
      display: `${weekStart.getDate()} – ${weekEnd.getDate()}`
    });

    currentDate.setDate(currentDate.getDate() + 7);
    weekIndex++;

    // Stop if we've gone past the month
    if (currentDate.getMonth() > month || currentDate.getFullYear() > year) break;
  }

  return weeks;
}

function getDaysInWeek(weekStart) {
  const days = [];
  const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + i);
    days.push({
      name: dayNames[i],
      date: date,
      dateStr: toLocalDateStr(date), // FIX: Use local formatter instead of toISOString
      display: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    });
  }

  return days;
}

function getDateKey(date) {
  // Returns YYYY-MM-DD format for storing items by specific date
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDayNameFromDate(dateStr) {
  // Convert YYYY-MM-DD to day name if it falls in current week
  const { monday, sunday } = getWeekBounds();
  const date = new Date(dateStr);

  if (date >= monday && date <= sunday) {
    return getDayOfWeek(date);
  }
  return null;
}

function getDateFromDayName(dayName) {
  // Convert day name to YYYY-MM-DD for current week
  const weekDays = getWeekDays();
  const day = weekDays.find(d => d.name === dayName);
  return day ? day.dateStr : null;
}

function getItemsForDay(dayName, dateStr, includeDone = false) {
  // Get all items for a specific day, checking both scheduledDay and scheduledDate
  return ALL.filter(item => {
    // Optionally filter out done items
    if (!includeDone && item.done) return false;
    // Match by day name OR by specific date
    return item.scheduledDay === dayName || item.scheduledDate === dateStr;
  });
}

function getRelatedItems(project, includeDone = false) {
  // Get all items (notes/tasks) that share tags with this project
  if (!project.tags || project.tags.length === 0) return [];

  return ALL.filter(item => {
    // Don't include the project itself
    if (item.id === project.id) return false;
    // Only include notes and tasks (not other projects)
    if (item.type === 'project') return false;
    // Filter done items unless requested
    if (!includeDone && item.done) return false;
    // Check if item has any matching tags
    if (!item.tags || item.tags.length === 0) return false;
    return item.tags.some(tag => project.tags.includes(tag));
  }).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

function getProjectStats(project) {
  // Get activity stats for a project
  const allRelated = getRelatedItems(project, true); // Include done items
  const activeItems = allRelated.filter(i => !i.done);
  const doneItems = allRelated.filter(i => i.done);

  // Find last update across project and related items
  let lastUpdate = project.updatedAt;
  for (const item of allRelated) {
    if (item.updatedAt > lastUpdate) lastUpdate = item.updatedAt;
  }

  // Calculate relative time
  const now = new Date();
  const updated = new Date(lastUpdate);
  const diffMs = now - updated;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let lastUpdateText;
  if (diffDays === 0) {
    lastUpdateText = 'today';
  } else if (diffDays === 1) {
    lastUpdateText = 'yesterday';
  } else if (diffDays < 7) {
    lastUpdateText = `${diffDays} days ago`;
  } else if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    lastUpdateText = `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  } else {
    const months = Math.floor(diffDays / 30);
    lastUpdateText = `${months} month${months > 1 ? 's' : ''} ago`;
  }

  return {
    active: activeItems.length,
    done: doneItems.length,
    lastUpdate: lastUpdateText
  };
}

function getDateUrgency(dateStr) {
  // Calculate urgency level based on how far away the date is
  if (!dateStr) return null;

  const now = new Date();
  now.setHours(0, 0, 0, 0); // Start of today

  let targetDate;

  // DETECT FORMAT:
  // If it has a "T" (e.g. 2026-01-18T09:00:00.000Z), it's from due: (ISO)
  // If not (e.g. 2026-01-18), it's from the Calendar/Schedule (YYYY-MM-DD)
  if (dateStr.includes("T")) {
    targetDate = new Date(dateStr);
  } else {
    // Manually construct local date to avoid UTC shift
    const [y, m, d] = dateStr.split('-').map(Number);
    targetDate = new Date(y, m - 1, d);
  }

  // Normalize to midnight local time
  targetDate.setHours(0, 0, 0, 0);

  const diffMs = targetDate - now;
  // Rounding helps smooth over Daylight Savings shifts
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { level: 'overdue', color: 'bad', label: 'OVERDUE', days: Math.abs(diffDays) };
  } else if (diffDays === 0) {
    return { level: 'today', color: 'warn', label: 'TODAY', days: 0 };
  } else if (diffDays <= 7) {
    return { level: 'week', color: 'ok', label: `${diffDays}d`, days: diffDays };
  } else if (diffDays <= 30) {
    return { level: 'month', color: 'hot', label: `${diffDays}d`, days: diffDays };
  } else {
    return { level: 'future', color: 'muted', label: `${diffDays}d`, days: diffDays };
  }
}

function getDatedItems() {
  // Get all items with due dates or scheduled dates
  return ALL.filter(item => {
    if (item.done) return false;
    return item.dueAt || item.scheduledDate;
  }).map(item => {
    // Determine the effective date (prefer dueAt, fallback to scheduledDate)
    const effectiveDate = item.dueAt || item.scheduledDate;
    const urgency = getDateUrgency(effectiveDate);
    return { ...item, effectiveDate, urgency };
  }).filter(item => item.urgency !== null)
    .sort((a, b) => {
      // Sort by urgency: overdue first, then by days remaining
      if (a.urgency.level === 'overdue' && b.urgency.level !== 'overdue') return -1;
      if (b.urgency.level === 'overdue' && a.urgency.level !== 'overdue') return 1;
      return a.urgency.days - b.urgency.days;
    });
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
let SELECTED_MONTH = null; // null or { year, month } for expanded month
let SELECTED_WEEK = null; // null or week index within selected month
let EXPANDED_PROJECTS = new Set(JSON.parse(localStorage.getItem('expanded_projects') || '[]')); // Track expanded project IDs

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
  let scheduledDate = null; // for specific date scheduling

  // Check for day prefix
  const dayParse = parseDay(raw);
  if (dayParse) {
    scheduledDay = dayParse.day;
    body = dayParse.text;
    type = "task"; // scheduled items are tasks
    // Also set scheduledDate if this day is in current week
    scheduledDate = getDateFromDayName(dayParse.day);
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
    scheduledDate, // YYYY-MM-DD for specific date scheduling
    done: false,
  };

  await dbPut(item);
  await refresh();
}

let EDITOR_ITEM = null; // Currently editing item

function openEditor(id) {
  const item = ALL.find(i => i.id === id);
  if (!item) return;

  EDITOR_ITEM = item;

  const modal = $("#editorModal");
  const input = $("#editorInput");
  const typeLabel = $("#editorType");

  // Set type label
  typeLabel.textContent = item.type.toUpperCase();

  // Set input value and show modal
  input.value = item.body || "";
  modal.hidden = false;

  // Focus and select text
  input.focus();
  input.select();
}

function closeEditor() {
  const modal = $("#editorModal");
  modal.hidden = true;
  EDITOR_ITEM = null;
}

async function saveEditor() {
  if (!EDITOR_ITEM) return;

  const input = $("#editorInput");
  let newBody = input.value;

  // Re-parse command prefixes if present
  if (newBody.toLowerCase().startsWith("/project")) {
    EDITOR_ITEM.type = "project";
    newBody = newBody.replace(/^\/project\s*/i, "").trim();
  } else if (newBody.toLowerCase().startsWith("/task")) {
    EDITOR_ITEM.type = "task";
    newBody = newBody.replace(/^\/task\s*/i, "").trim();
  } else if (newBody.toLowerCase().startsWith("/note")) {
    EDITOR_ITEM.type = "note";
    newBody = newBody.replace(/^\/note\s*/i, "").trim();
  }

  EDITOR_ITEM.body = newBody;
  EDITOR_ITEM.tags = extractTags(newBody);
  EDITOR_ITEM.dueAt = parseDue(newBody);
  EDITOR_ITEM.updatedAt = nowISO();

  // Re-parse day if changed
  const dayParse = parseDay(newBody);
  if (dayParse) {
    EDITOR_ITEM.scheduledDay = dayParse.day;
    EDITOR_ITEM.scheduledDate = getDateFromDayName(dayParse.day);
    EDITOR_ITEM.body = dayParse.text;
  }

  // Update title
  const first = (EDITOR_ITEM.body.split("\n")[0] || "").trim();
  if (first.length > 0 && first.length <= 80) {
    EDITOR_ITEM.title = first;
  } else if (first.length > 80) {
    EDITOR_ITEM.title = first.slice(0, 77) + "…";
  }

  await dbPut(EDITOR_ITEM);
  closeEditor();
  await refresh();
}

async function toggleEditorDone() {
  if (!EDITOR_ITEM) return;

  EDITOR_ITEM.done = !EDITOR_ITEM.done;
  EDITOR_ITEM.updatedAt = nowISO();

  await dbPut(EDITOR_ITEM);
  closeEditor();
  await refresh();
}

async function deleteEditorItem() {
  if (!EDITOR_ITEM) return;

  if (confirm("Delete this item?")) {
    await dbDelete(EDITOR_ITEM.id);
    closeEditor();
    await refresh();
  }
}

// ---------- Alerts ----------
function computeAlerts(items) {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const STALE_DAYS = 21;

  const alerts = [];

  // Add all dated items with urgency indicators
  const datedItems = getDatedItems();
  for (const item of datedItems) {
    alerts.push({
      ...item,
      alertLabel: item.urgency.label,
      urgencyLevel: item.urgency.level,
      urgencyColor: item.urgency.color,
      isDatedAlert: true
    });
  }

  // Stale projects (that aren't already in dated alerts)
  for (const it of items) {
    if (it.done) continue;

    // Skip if already added as dated alert
    if (alerts.some(a => a.id === it.id)) continue;

    const updated = new Date(it.updatedAt || it.createdAt || nowISO()).getTime();
    const isProjectish = it.type === "project" || (it.tags || []).includes("#project");
    if (isProjectish) {
      const ageDays = Math.floor((now - updated) / DAY);
      if (ageDays >= STALE_DAYS) {
        alerts.push({
          ...it,
          alertLabel: `STALE • ${ageDays}d`,
          title: it.title || "Stale project",
          urgencyColor: 'muted'
        });
      }
    }
  }

  // Sort by urgency: overdue > today > week > month > future > stale
  const rankUrgency = (a) => {
    if (a.urgencyLevel === 'overdue') return 0;
    if (a.urgencyLevel === 'today') return 1;
    if (a.urgencyLevel === 'week') return 2;
    if (a.urgencyLevel === 'month') return 3;
    if (a.urgencyLevel === 'future') return 4;
    return 5; // stale projects
  };
  alerts.sort((a, b) => {
    const rankDiff = rankUrgency(a) - rankUrgency(b);
    if (rankDiff !== 0) return rankDiff;
    // Within same urgency, sort by days
    if (a.urgency && b.urgency) return a.urgency.days - b.urgency.days;
    return 0;
  });
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
  renderMonthPanel();
  renderArchive();
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
    // Get ALL items for this day - both scheduledDay and scheduledDate, including done items
    const allDayItems = getItemsForDay(day.name, day.dateStr, true)
      .sort((a,b) => {
        // Sort done items to the bottom
        if (a.done !== b.done) return a.done ? 1 : -1;
        return (a.createdAt||"").localeCompare(b.createdAt||"");
      });

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
        const card = renderItemCard(item, { compact: true, isDone: item.done });
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
    container.appendChild(renderProjectCard(proj));
  }
}

function renderProjectCard(project) {
  const isExpanded = EXPANDED_PROJECTS.has(project.id);
  const relatedItems = getRelatedItems(project);
  const stats = getProjectStats(project);

  const wrapper = document.createElement("div");
  wrapper.className = "project-wrapper";

  // Project header card
  const projectCard = document.createElement("div");
  projectCard.className = `item item--project ${isExpanded ? 'item--expanded' : ''}`;

  const tags = project.tags || [];
  const title = project.title || "(untitled)";

  // Show full body when expanded, truncated when collapsed
  const bodyHtml = isExpanded && project.body
    ? `<div class="item__body item__body--full">${escapeHtml(project.body)}</div>`
    : '';

  // Activity summary when expanded
  const summaryHtml = isExpanded
    ? `<div class="project-summary">${stats.active} active • ${stats.done} done • Last update: ${stats.lastUpdate}</div>`
    : '';

  projectCard.innerHTML = `
    <div class="item__top">
      <div class="item__title">
        <span class="project-toggle">${isExpanded ? '▼' : '▶'}</span>
        ${escapeHtml(title)}
        ${tags.length ? `<span class="project-tag-count">${tags.length} tag${tags.length > 1 ? 's' : ''}</span>` : ''}
      </div>
      <div class="item__meta">PROJECT</div>
    </div>
    ${bodyHtml}
    ${summaryHtml}
    ${tags.length ? `<div class="tags">${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>` : ``}
  `;

  // Click on project header to toggle expand/collapse
  projectCard.addEventListener("click", (e) => {
    // Don't toggle if clicking on a tag
    if (e.target.closest('.tag')) return;

    toggleProject(project.id);
  });

  // Right-click to edit
  projectCard.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openEditor(project.id);
  });

  wrapper.appendChild(projectCard);

  // Related items (shown when expanded)
  if (isExpanded && relatedItems.length > 0) {
    const relatedContainer = document.createElement("div");
    relatedContainer.className = "project-related";

    const relatedHeader = document.createElement("div");
    relatedHeader.className = "project-related-header";
    relatedHeader.textContent = `Active Items (${relatedItems.length})`;
    relatedContainer.appendChild(relatedHeader);

    for (const item of relatedItems.slice(0, 10)) {
      const relatedCard = renderProjectItem(item, project.id);
      relatedContainer.appendChild(relatedCard);
    }

    if (relatedItems.length > 10) {
      const moreMsg = document.createElement("div");
      moreMsg.className = "project-related-more";
      moreMsg.textContent = `+${relatedItems.length - 10} more items`;
      relatedContainer.appendChild(moreMsg);
    }

    wrapper.appendChild(relatedContainer);
  } else if (isExpanded && relatedItems.length === 0) {
    const emptyMsg = document.createElement("div");
    emptyMsg.className = "project-related-empty";
    emptyMsg.textContent = "No related items yet. Add notes/tasks with matching tags.";
    wrapper.appendChild(emptyMsg);
  }

  return wrapper;
}

function renderProjectItem(item, projectId) {
  // Render an item within a project context, with "next action" toggle
  const el = document.createElement("div");
  const isNext = item.isNextAction === true;

  el.className = `item project-related-item ${isNext ? 'item--next' : ''}`;

  const title = item.title || "(untitled)";
  const d = new Date(item.createdAt);
  const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  el.innerHTML = `
    <div class="item__top">
      <div class="item__title">
        <button class="next-action-btn ${isNext ? 'next-action-btn--active' : ''}" title="${isNext ? 'Remove next action' : 'Mark as next action'}">
          ${isNext ? '★' : '☆'}
        </button>
        ${escapeHtml(title)}
        ${isNext ? '<span class="next-badge">NEXT</span>' : ''}
      </div>
      <div class="item__meta">${dateStr}</div>
    </div>
  `;

  // Toggle next action on star click
  el.querySelector('.next-action-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    await toggleNextAction(item.id, projectId);
  });

  // Click to edit
  el.addEventListener("click", (e) => {
    if (!e.target.closest('.next-action-btn')) {
      openEditor(item.id);
    }
  });

  return el;
}

async function toggleNextAction(itemId, projectId) {
  const item = ALL.find(i => i.id === itemId);
  if (!item) return;

  // If this item is already next, just toggle it off
  if (item.isNextAction) {
    item.isNextAction = false;
  } else {
    // Clear any existing "next" items for this project's related items
    const project = ALL.find(i => i.id === projectId);
    if (project) {
      const related = getRelatedItems(project, true);
      for (const r of related) {
        if (r.isNextAction) {
          r.isNextAction = false;
          await dbPut(r);
        }
      }
    }
    // Mark this one as next
    item.isNextAction = true;
  }

  item.updatedAt = nowISO();
  await dbPut(item);
  await refresh();
}

function toggleProject(projectId) {
  if (EXPANDED_PROJECTS.has(projectId)) {
    EXPANDED_PROJECTS.delete(projectId);
  } else {
    EXPANDED_PROJECTS.add(projectId);
  }

  // Save to localStorage
  localStorage.setItem('expanded_projects', JSON.stringify([...EXPANDED_PROJECTS]));

  renderProjects();
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

function renderArchive() {
  // Completed/done items sorted by completion date (most recent first)
  const archived = ALL.filter(it => it.done && matchesFilter(it))
    .sort((a,b) => (b.updatedAt||"").localeCompare(a.updatedAt||""));

  const container = $("#archiveList");
  if (archived.length === 0) {
    const msg = (FILTER_TEXT || ACTIVE_TAGS.size > 0)
      ? "No archived items match filter."
      : "No completed items yet.";
    container.innerHTML = `<div class="empty">${msg}</div>`;
    return;
  }

  container.innerHTML = "";
  for (const item of archived.slice(0, 20)) {
    container.appendChild(renderItemCard(item, {
      compact: true,
      showDate: true,
      isDone: true
    }));
  }
}

function renderItemCard(item, opts = {}) {
  const el = document.createElement("div");
  el.className = `item ${opts.isDone ? 'item--done' : ''}`;

  let metaRight = "";
  let urgencyPill = "";

  if (opts.isAlert) {
    metaRight = item.alertLabel || "ALERT";
    // Add urgency pill if this is a dated alert
    if (item.isDatedAlert && item.urgencyLevel) {
      urgencyPill = `<span class="urgency-pill urgency-pill--${item.urgencyLevel}">${escapeHtml(item.alertLabel)}</span>`;
      metaRight = ""; // Don't duplicate in meta
    }
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
      <div class="item__title">
        ${opts.isDone ? '<span class="done-check">✓</span>' : ''}
        ${escapeHtml(title)}
        ${urgencyPill}
      </div>
      ${metaRight ? `<div class="item__meta">${escapeHtml(metaRight)}</div>` : ''}
    </div>
    ${body && !opts.compact ? `<div class="item__body">${escapeHtml(shortBody(body))}</div>` : ``}
    ${tags.length && !opts.compact ? `<div class="tags">${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>` : ``}
  `;

  el.addEventListener("click", () => openEditor(item.id));
  return el;
}

function renderMonthPanel() {
  const container = $("#monthPanel");
  if (!container) return;

  container.innerHTML = "";

  // If a week is selected, show days in that week
  if (SELECTED_MONTH && SELECTED_WEEK !== null) {
    const weeks = getWeeksInMonth(SELECTED_MONTH.year, SELECTED_MONTH.index);
    const week = weeks[SELECTED_WEEK];
    if (week) {
      const days = getDaysInWeek(week.start);

      const backBtn = document.createElement("button");
      backBtn.className = "month-back-btn";
      backBtn.textContent = "← Back to weeks";
      backBtn.addEventListener("click", () => {
        SELECTED_WEEK = null;
        render();
      });
      container.appendChild(backBtn);

      const weekTitle = document.createElement("div");
      weekTitle.className = "month-week-title";
      weekTitle.textContent = `Week of ${week.display}`;
      container.appendChild(weekTitle);

      const daysGrid = document.createElement("div");
      daysGrid.className = "month-days-grid";

      for (const day of days) {
        const dayBox = document.createElement("div");
        dayBox.className = "month-day-box";

        // Use getItemsForDay to include both scheduledDate and scheduledDay items, including done
        const items = getItemsForDay(day.name, day.dateStr, true);
        const doneCount = items.filter(i => i.done).length;
        const activeCount = items.filter(i => !i.done).length;

        dayBox.innerHTML = `
          <div class="month-day-name">${day.name.slice(0, 3)}</div>
          <div class="month-day-date">${day.display}</div>
          <div class="month-day-count">${activeCount}${doneCount > 0 ? ` / ${doneCount}✓` : ''}</div>
        `;

        dayBox.addEventListener("click", () => {
          const text = prompt(`Add item for ${day.display}:`);
          if (text && text.trim()) {
            addItemToDate(text.trim(), day.dateStr);
          }
        });

        daysGrid.appendChild(dayBox);
      }

      container.appendChild(daysGrid);
    }
    return;
  }

  // If a month is selected, show weeks in that month
  if (SELECTED_MONTH) {
    const backBtn = document.createElement("button");
    backBtn.className = "month-back-btn";
    backBtn.textContent = "← Back to months";
    backBtn.addEventListener("click", () => {
      SELECTED_MONTH = null;
      render();
    });
    container.appendChild(backBtn);

    const monthTitle = document.createElement("div");
    monthTitle.className = "month-title";
    monthTitle.textContent = `${SELECTED_MONTH.name} ${SELECTED_MONTH.year}`;
    container.appendChild(monthTitle);

    const weeks = getWeeksInMonth(SELECTED_MONTH.year, SELECTED_MONTH.index);
    const weeksGrid = document.createElement("div");
    weeksGrid.className = "month-weeks-grid";

    for (const week of weeks) {
      const weekBox = document.createElement("div");
      weekBox.className = "month-week-box";

      // Count items in this week
      const weekStart = getDateKey(week.start);
      const weekEnd = getDateKey(week.end);
      const allItemsInWeek = ALL.filter(i => {
        if (!i.scheduledDate) return false;
        return i.scheduledDate >= weekStart && i.scheduledDate <= weekEnd;
      });
      const activeCount = allItemsInWeek.filter(i => !i.done).length;
      const doneCount = allItemsInWeek.filter(i => i.done).length;

      weekBox.innerHTML = `
        <div class="month-week-label">Week ${week.index + 1}</div>
        <div class="month-week-range">${week.display}</div>
        <div class="month-week-count">${activeCount}${doneCount > 0 ? ` / ${doneCount}✓` : ''}</div>
      `;

      weekBox.addEventListener("click", () => {
        SELECTED_WEEK = week.index;
        render();
      });

      weeksGrid.appendChild(weekBox);
    }

    container.appendChild(weeksGrid);
    return;
  }

  // Default view: show 12 months
  const currentYear = new Date().getFullYear();
  const months = getMonthsForYear(currentYear);

  const monthsGrid = document.createElement("div");
  monthsGrid.className = "month-grid";

  for (const month of months) {
    const monthBox = document.createElement("div");
    monthBox.className = `month-box ${month.isCurrent ? 'month-box--current' : ''}`;

    // Count items in this month
    const monthStart = `${month.year}-${String(month.index + 1).padStart(2, '0')}-01`;
    const monthEnd = `${month.year}-${String(month.index + 1).padStart(2, '0')}-31`;
    const allItemsInMonth = ALL.filter(i => {
      if (!i.scheduledDate) return false;
      return i.scheduledDate >= monthStart && i.scheduledDate <= monthEnd;
    });
    const activeCount = allItemsInMonth.filter(i => !i.done).length;
    const doneCount = allItemsInMonth.filter(i => i.done).length;

    monthBox.innerHTML = `
      <div class="month-name">${month.name}</div>
      <div class="month-count">${activeCount}${doneCount > 0 ? ` / ${doneCount}✓` : ''}</div>
    `;

    monthBox.addEventListener("click", () => {
      SELECTED_MONTH = month;
      render();
    });

    monthsGrid.appendChild(monthBox);
  }

  container.appendChild(monthsGrid);
}

async function addItemToDate(text, dateStr) {
  const raw = text.trim();
  if (!raw) return;

  const createdAt = nowISO();
  let type = "task";
  let title = "";
  let body = raw;

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

  const lines = body.split("\n");
  const first = lines[0].trim();
  if (first.length > 0 && first.length <= 80) {
    title = first;
  } else if (first.length > 80) {
    title = first.slice(0, 77) + "…";
  } else {
    title = "(untitled)";
  }

  // If this date falls in current week, also set scheduledDay
  const scheduledDay = getDayNameFromDate(dateStr);

  const item = {
    id: makeId(),
    type,
    title,
    body,
    tags,
    createdAt,
    updatedAt: createdAt,
    dueAt,
    scheduledDay, // Set if date is in current week
    scheduledDate: dateStr, // Schedule to specific date
    done: false,
  };

  await dbPut(item);
  await refresh();
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

  // Editor modal buttons
  $("#editorSave").addEventListener("click", saveEditor);
  $("#editorDone").addEventListener("click", toggleEditorDone);
  $("#editorDelete").addEventListener("click", deleteEditorItem);
  $("#editorCancel").addEventListener("click", closeEditor);

  // Close modal on overlay click
  $("#editorModal").addEventListener("click", (e) => {
    if (e.target.id === "editorModal") closeEditor();
  });

  // Close modal on Escape, save on Ctrl+Enter
  $("#editorInput").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeEditor();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveEditor();
    }
  });

  // Panel drag and drop
  initPanelDragDrop();
}

// ---------- Panel Drag & Drop ----------
let draggedPanel = null;

function initPanelDragDrop() {
  const panels = document.querySelectorAll('.panel[draggable="true"]');

  panels.forEach(panel => {
    // Only start drag from the header (drag handle)
    const handle = panel.querySelector('.panel__drag-handle');
    if (handle) {
      handle.addEventListener('mousedown', () => {
        panel.setAttribute('draggable', 'true');
      });

      // Prevent drag when clicking on buttons/inputs in header
      handle.querySelectorAll('button, input').forEach(el => {
        el.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          panel.setAttribute('draggable', 'false');
        });
      });
    }

    panel.addEventListener('dragstart', handleDragStart);
    panel.addEventListener('dragend', handleDragEnd);
    panel.addEventListener('dragover', handleDragOver);
    panel.addEventListener('dragenter', handleDragEnter);
    panel.addEventListener('dragleave', handleDragLeave);
    panel.addEventListener('drop', handleDrop);
  });

  // Allow dropping on panes themselves (for cross-pane moves and empty areas)
  document.querySelectorAll('.pane').forEach(pane => {
    pane.addEventListener('dragover', handlePaneDragOver);
    pane.addEventListener('dragleave', handlePaneDragLeave);
    pane.addEventListener('drop', handlePaneDrop);
  });
}

function handlePaneDragOver(e) {
  e.preventDefault();
  if (!draggedPanel) return;

  this.classList.add('drag-active');

  // Find the panel we're hovering over within this pane
  const panels = [...this.querySelectorAll('.panel[data-panel-id]')];
  const mouseY = e.clientY;

  // Clear previous indicators
  panels.forEach(p => p.classList.remove('drag-over', 'drag-over-bottom'));

  // Find insertion point
  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i];
    if (panel === draggedPanel) continue;

    const rect = panel.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;

    if (mouseY < midpoint) {
      panel.classList.add('drag-over');
      return;
    } else if (mouseY < rect.bottom) {
      panel.classList.add('drag-over-bottom');
      return;
    }
  }

  // If we're past all panels, mark the last one as drop-below
  const lastPanel = panels[panels.length - 1];
  if (lastPanel && lastPanel !== draggedPanel) {
    lastPanel.classList.add('drag-over-bottom');
  }
}

function handlePaneDragLeave(e) {
  // Only remove if we're actually leaving the pane
  if (!this.contains(e.relatedTarget)) {
    this.classList.remove('drag-active');
    this.querySelectorAll('.panel').forEach(p => {
      p.classList.remove('drag-over', 'drag-over-bottom');
    });
  }
}

function handlePaneDrop(e) {
  e.preventDefault();
  if (!draggedPanel) return;

  const targetPane = this;
  targetPane.classList.remove('drag-active');

  // Find where to insert
  const panels = [...targetPane.querySelectorAll('.panel[data-panel-id]')];
  let insertBefore = null;
  let insertAfter = null;

  for (const panel of panels) {
    if (panel.classList.contains('drag-over')) {
      insertBefore = panel;
      break;
    }
    if (panel.classList.contains('drag-over-bottom')) {
      insertAfter = panel;
      break;
    }
  }

  // Clear indicators
  panels.forEach(p => p.classList.remove('drag-over', 'drag-over-bottom'));

  // Move the panel
  if (insertBefore) {
    targetPane.insertBefore(draggedPanel, insertBefore);
  } else if (insertAfter) {
    targetPane.insertBefore(draggedPanel, insertAfter.nextSibling);
  } else {
    // Append to end of pane
    targetPane.appendChild(draggedPanel);
  }

  // Update panel styling based on new pane
  updatePanelStyleForPane(draggedPanel, targetPane);

  // Save new order
  savePanelOrder();
}

function updatePanelStyleForPane(panel, pane) {
  // Add or remove compact class based on which pane it's in
  if (pane.classList.contains('pane--right')) {
    panel.classList.add('panel--compact');
  } else {
    panel.classList.remove('panel--compact');
  }
}

function handleDragStart(e) {
  draggedPanel = this;
  this.classList.add('dragging');

  // Set drag data
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', this.dataset.panelId);

  // Add active state to parent pane
  this.closest('.pane')?.classList.add('drag-active');
}

function handleDragEnd(e) {
  this.classList.remove('dragging');
  draggedPanel = null;

  // Remove all drag states
  document.querySelectorAll('.panel').forEach(p => {
    p.classList.remove('drag-over', 'drag-over-bottom');
  });
  document.querySelectorAll('.pane').forEach(p => {
    p.classList.remove('drag-active');
  });
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  if (!draggedPanel || draggedPanel === this) return;

  // Determine if dropping above or below based on mouse position
  const rect = this.getBoundingClientRect();
  const midpoint = rect.top + rect.height / 2;

  this.classList.remove('drag-over', 'drag-over-bottom');
  if (e.clientY < midpoint) {
    this.classList.add('drag-over');
  } else {
    this.classList.add('drag-over-bottom');
  }
}

function handleDragEnter(e) {
  e.preventDefault();
}

function handleDragLeave(e) {
  this.classList.remove('drag-over', 'drag-over-bottom');
}

function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();

  if (!draggedPanel || draggedPanel === this) return;

  const targetPane = this.closest('.pane');

  // Determine position and insert
  const rect = this.getBoundingClientRect();
  const midpoint = rect.top + rect.height / 2;

  if (e.clientY < midpoint) {
    // Insert before
    this.parentNode.insertBefore(draggedPanel, this);
  } else {
    // Insert after
    this.parentNode.insertBefore(draggedPanel, this.nextSibling);
  }

  // Update panel styling based on new pane
  updatePanelStyleForPane(draggedPanel, targetPane);

  // Clean up classes
  this.classList.remove('drag-over', 'drag-over-bottom');

  // Save new order
  savePanelOrder();
}

function savePanelOrder() {
  const leftOrder = [...document.querySelectorAll('.pane--left .panel[data-panel-id]')]
    .map(p => p.dataset.panelId);
  const rightOrder = [...document.querySelectorAll('.pane--right .panel[data-panel-id]')]
    .map(p => p.dataset.panelId);

  localStorage.setItem('panel_order_left', JSON.stringify(leftOrder));
  localStorage.setItem('panel_order_right', JSON.stringify(rightOrder));
}

function restorePanelOrder() {
  const leftOrder = JSON.parse(localStorage.getItem('panel_order_left') || '[]');
  const rightOrder = JSON.parse(localStorage.getItem('panel_order_right') || '[]');

  const leftPane = document.querySelector('.pane--left');
  const rightPane = document.querySelector('.pane--right');

  // Restore left pane panels (may come from either pane originally)
  if (leftOrder.length > 0) {
    leftOrder.forEach(id => {
      const panel = document.querySelector(`[data-panel-id="${id}"]`);
      if (panel) {
        leftPane.appendChild(panel);
        updatePanelStyleForPane(panel, leftPane);
      }
    });
  }

  // Restore right pane panels (may come from either pane originally)
  if (rightOrder.length > 0) {
    rightOrder.forEach(id => {
      const panel = document.querySelector(`[data-panel-id="${id}"]`);
      if (panel) {
        rightPane.appendChild(panel);
        updatePanelStyleForPane(panel, rightPane);
      }
    });
  }
}

async function boot() {
  // Restore panel order before wiring UI
  restorePanelOrder();

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
