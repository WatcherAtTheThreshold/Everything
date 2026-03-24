# Everything Console — Claude Code Guide

## What This Is

A local-first productivity dashboard for weekly planning, project tracking, and quick capture. Single-page app with two-pane layout, drag-and-drop panels, smart text parsing, and urgency alerts. All data stored in browser IndexedDB — no backend, no sync. Vanilla JS/HTML/CSS, no build step, hosted on GitHub Pages.

---

## Tech Stack

- Vanilla JavaScript (ES6+, single monolithic `app.js`)
- HTML/CSS (single page, CSS custom properties, BEM-lite class naming)
- IndexedDB for persistent storage (`everything_console_db`)
- localStorage for UI preferences (panel order, collapsed state)
- No framework, no build step, no external dependencies
- GitHub Pages hosting
- Comfort theme: migraine-friendly warm palette

---

## File Structure

```
Everything/
  index.html              — main single-page app
  app.js                  — all app logic (1925 lines)
  style.css               — primary styles (1284 lines)
  theme-comfort.css       — warm migraine-friendly theme
  theme-day.css           — bright high-contrast theme
  images/
    mist-overlay.png      — atmospheric background texture
  app/                    — embedded markdown editor module (Toast UI)
    app.js                — editor init
    io.js                 — import/export markdown
    nav.js                — section navigation
    storage.js            — draft storage
    style.css             — editor styles
  docs/                   — dev notes, session reviews, bug tracking
  JSON-backup/            — sample data snapshots
```

---

## Architecture

### Global State
```
ALL = []                    — all items from IndexedDB
FILTER_TEXT = ""            — current search text
ACTIVE_TAGS = new Set()     — active tag filters (AND logic)
COLLAPSED_PANELS = new Set() — collapsed panel IDs
EXPANDED_DAYS = new Set()   — expanded days in week view
EXPANDED_PROJECTS = new Set() — expanded project cards
EDITOR_ITEM = null          — item currently being edited in modal
```

### Render Cycle
1. User action (type, click, drag)
2. Event handler updates state + calls `await dbPut(item)` and `await refresh()`
3. `refresh()` reloads `ALL` from IndexedDB
4. `render()` calls specialized renderers: `renderTopbar()`, `renderWeekView()`, `renderNotes()`, etc.
5. Full re-render on every state change (no virtual DOM)

### Data Model (IndexedDB)
```
Item {
  id: "id_<random>_<random>"
  type: "task" | "note" | "project"
  title: String              — auto-derived from first line
  body: String               — full text with tags and dates
  tags: [String]             — extracted from #hashtags in body
  createdAt: ISO8601
  updatedAt: ISO8601
  dueAt: ISO8601 | null      — from due:DD-MM-YYYY or due:YYYY-MM-DD
  scheduledDay: String | null — "monday", "tuesday", etc.
  scheduledDate: String | null — "YYYY-MM-DD" for specific dates
  done: Boolean
  isNextAction: Boolean       — star toggle, one per project
}
```

### Storage
| Store | Purpose |
|-------|---------|
| IndexedDB `everything_console_db` | All items (keyPath: `id`, indices: `type`, `updatedAt`, `createdAt`, `scheduledDay`) |
| localStorage `collapsed_panels` | Which panels are collapsed |
| localStorage `panel_order_left` / `panel_order_right` | Custom panel ordering |
| localStorage `expanded_projects` | Which projects are expanded |

---

## Two-Pane Layout

### Left Pane (Working Space)
- **CAPTURE** — quick-entry textarea with smart parsing
- **THIS WEEK** — day-by-day collapsible view (Mon–Sun, today expanded by default)
- **NOTES** — atemporal ideas, sorted newest first
- **ARCHIVE** — completed items

### Right Pane (Awareness/Meta)
- **SEARCH** — text filter + tag chip toggles (AND logic)
- **ALERTS** — computed urgency: overdue (bad), today (warn), this week (ok), this month (hot), stale projects
- **PROJECTS** — expandable cards with related items, next-action toggle
- **RECENT LOG** — chronological entry history
- **CALENDAR** — year/month/week drill-down navigator
- **TOOLS** — export JSON, export .md, import, seed demo data, wipe

### Top Bar
- LOCAL (live clock), SYSTEM state (STABLE/DRIFT/CRITICAL based on alert count), THIS WEEK count, ALERTS count

---

## Smart Parsing (Capture Input)

| Syntax | Effect |
|--------|--------|
| `monday: do the thing` | Schedules task to Monday |
| `#tag` anywhere in body | Extracts tag, enables filtering |
| `due:17-01-2026` or `due:2026-01-17` | Sets due date |
| `/project`, `/task`, `/note` | Explicitly sets item type |

---

## Key Algorithms

- **`getDateUrgency()`** — computes alert level from due date vs today (overdue, today, week, month, future)
- **`computeAlerts()`** — ranks mixed urgency sources (due dates + stale projects untouched 21+ days)
- **`getItemsForDay()`** — multi-criteria query (by day name OR by date string)
- **`matchesFilter()`** — composable filter: text substring AND all active tags must match
- **`getAllTags()`** — live tag aggregation from all non-done items

---

## Drag-and-Drop

- Panels draggable by header (`panel__drag-handle`)
- Drop detects above/below midpoint for insertion position
- Cross-pane moves supported (left ↔ right)
- Right-pane panels get `panel--compact` class automatically
- Order persisted to localStorage

---

## Coding Conventions

- `$()` — querySelector shorthand
- `nowISO()` — current ISO timestamp
- `fmt(iso)` — format date for display
- `render*()` — specialized render functions
- `handle*()` — drag/drop event handlers
- BEM-lite CSS: `.panel__head`, `.day__header`, `.item__title`, `.urgency-pill--overdue`
- State classes: `.panel--collapsed`, `.panel--compact`, `.day--today`, `.day--expanded`, `.item--done`, `.item--next`

---

## Key Constraints

- `app.js` is monolithic (1925 lines) — all logic in one file, no modules
- Full DOM re-render on every state change — avoid adding expensive computations inside render functions
- IndexedDB is async — all data operations use `await`; never read stale `ALL` array without refreshing
- Smart parsing is regex-based — changes to parsing must preserve existing `due:` and `day:` formats
- Panel order is separate from panel content — reordering doesn't affect data, only DOM position
- Urgency computation handles UTC offset edge cases — be careful with date boundary logic
- The `app/` subfolder is a separate embedded markdown editor (Toast UI) — not part of the main console app
