The three relevent files that we will be modifying in this repo are index.html, app.js, and style.css

Please review the existing code from the three files and modify to implement the plan in this .md file.

<br>
### 1\. \.md File Export \(High Priority – Quick Win\)

This is probably the easiest and most valuable next feature, since it turns your local data into something portable, shareable, and future-proof (e.g., import into Obsidian, Logseq, or git repo).

**Suggested Approach**:

* Add a new button in TOOLS: "Export to Markdown"
* Generate one big .md file (or optionally split by type/week)
* Structure it hierarchically for readability, e.g.:

```markdown
# Everything Console Export – 2026-01-17

## Metadata
Exported: 2026-01-17T00:53:00Z  
Items total: 42  

## Projects
### Coherence #coherence #game
Last updated: 2026-01-17  
Body:
Coherence #coherence #game due:1-23-2026

Related notes:
- Distortion spread tuning - Growth is too aggresive... (#coherence #mechanic)

### Fairweather Prints - Online sales
...

## This Week (Jan 13–19, 2026)
### Monday
- [ ] Groceries

### Thursday
- [ ] Coherence Prototype

## All Notes (reverse chrono)
- 2026-01-17: Algarithmic Maze Generation for Games... (#coherence #design #feature)

## Archived / Done Items
...
```

**Implementation Sketch** (add to `app.js`):

```js
async function exportMarkdown() {
  await refresh(); // ensure ALL is current
  let md = `# Everything Console Export – ${new Date().toLocaleDateString()}\n\n`;

  // Projects first
  md += "## Projects\n";
  const projects = ALL.filter(i => i.type === "project").sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const p of projects) {
    md += `### ${escapeMd(p.title)} ${p.tags?.join(" ") || ""}\n`;
    md += `Last updated: ${fmt(p.updatedAt)}\n`;
    md += `${escapeMd(p.body)}\n\n`;
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

  // Notes, recent log, etc.

  downloadJSON(md, "everything-export.md", "text/markdown");
}

// Helper
function escapeMd(s) {
  return (s || "").replace(/([#_*~`])/g, "\\$1");
}
```

Add a button like the Export one: `<button id="btnExportMd" class="btn btn--sm">Export .md</button>`, wire it up in `wireUI()`.

This gives you a clean, human-readable archive you can commit to git or drop into another PKM tool.

### 2\. Click to Open/Expand Projects \(Pull in Tagged Notes\)

This would make projects feel more "alive" – like a BuJo collection/index.

**Ideas**:

* When clicking a project card in the PROJECTS panel, open a modal or expand inline showing:
    * Full body
    * Edit button
    * "Related" section: all notes/tasks with matching tags (e.g., any `#coherence` item)
    * Maybe a quick "Add note to this project" capture box

**Quick Implementation**:

* Modify `renderItemCard()` to detect project type and add a class `.item--project`
* On click: if project, instead of simple prompt, show a custom modal (create a `<dialog>` element dynamically)
* Query related: `ALL.filter(i => i.tags?.some(t => project.tags?.includes(t)))`

This turns projects into mini-hubs, which is huge for dev log / creative work tracking.

### 3\. Migration/Review

Classic BuJo: at month/week end, review and migrate unfinished tasks.

**Simple Version**:

* Add a "Review This Week" button above week view
* Shows list of unfinished scheduled tasks + stale notes/projects
* One-click actions: "Migrate to next week" (update scheduledDay to next occurrence), "Archive" (mark done or add tag #archived), "Delete"

**Advanced**:

* Monthly view toggle (generate next/prev month bounds)
* "Migrate" function that copies unfinished items to future days, appending "migrated from [date]"

### 4\. Walk It Out to a Year \(Longer\-Term Planning\)

This is more ambitious but fits perfectly for annual BuJo spreads.

**Options**:

* **Mini-calendar Panel**: Add a new right-pane section with a 12-month grid (tiny boxes, color-coded by task count or alerts)
* **Year View**: Toggle to replace week view with 52 weeks or monthly blocks
* **Future Scheduling**: When parsing, allow `next:thursday` or `in:2w` syntax, calculate dates, store as `dueAt` or `targetDate`
* **Quarterly/Monthly Migration**: Similar to weekly, but with bigger chunks

Start small: just a "Future" section that lists items with future `dueAt` or `scheduledDay` beyond this week.

### 5\. Toggle to colapse panels 

Toggle to open and close panels

1. 

    ## Step 1: Add Toggle Buttons to Panel Headers (HTML)

    In `index.html`, we need to add a collapse button to each panel header. Find each `.panel__head` and add a button.
    **Example - find the ALERTS panel:**

    ```
    <div class="panel__head">
      <div class="panel__title">ALERTS</div>
      <div class="panel__meta">computed</div>
    </div>
    
    ```

    **Change to:**

    ```
    <div class="panel__head">
      <div class="panel__title">ALERTS</div>
      <div class="panel__meta">
        <button class="panel__toggle" data-panel="alerts" title="Collapse">▼</button>
        <span>computed</span>
      </div>
    </div>
    
    ```

    Do this for **all panels** you want collapsible. Here are the ones I'd suggest:
    * **ALERTS** → `data-panel="alerts"`
    * **PROJECTS** → `data-panel="projects"`
    * **RECENT LOG** → `data-panel="recent"`
    * **NOTES** → `data-panel="notes"`
    * **THIS WEEK** → `data-panel="week"` (maybe?)
    * **TOOLS** → `data-panel="tools"`

    (CAPTURE probably shouldn't be collapsible since it's your main input)

    ***

    ## Step 2: Add CSS for Toggle Button & Collapsed State

    Add this to `style.css`:

    ```
    /* Panel collapse toggle */
    .panel__toggle {
      background: none;
      border: none;
      color: var(--muted);
      font-size: 12px;
      cursor: pointer;
      padding: 0;
      margin-right: 8px;
      transition: all 0.2s ease;
      line-height: 1;
    }
    
    .panel__toggle:hover {
      color: var(--text);
      transform: scale(1.1);
    }
    
    .panel--collapsed .panel__toggle {
      transform: rotate(-90deg);
    }
    
    .panel__body {
      transition: all 0.2s ease;
      max-height: 10000px;
      overflow: hidden;
    }
    
    .panel--collapsed .panel__body {
      max-height: 0;
      opacity: 0;
    }
    
    ```

    ***

    ## Step 3: Wrap Panel Contents in `.panel__body`

    We need to wrap the collapsible part of each panel. For example:
    **ALERTS panel - find this:**

    ```
    <section class="panel panel--compact">
      <div class="panel__head">
        <!-- header stuff -->
      </div>
      <div id="alerts" class="list list--compact"></div>
    </section>
    
    ```

    **Change to:**

    ```
    <section class="panel panel--compact" data-panel-id="alerts">
      <div class="panel__head">
        <!-- header with toggle button -->
      </div>
      <div class="panel__body">
        <div id="alerts" class="list list--compact"></div>
      </div>
    </section>
    
    ```

    Do this for each collapsible panel. The key is:
    * Add `data-panel-id="X"` to the `<section class="panel">`
    * Wrap the content (everything except `.panel__head`) in `<div class="panel__body">`

    ***

    ## Step 4: Add JavaScript Toggle Logic

    Add this to `app.js` in the `wireUI()` function:

    ```
    function wireUI() {
      // ... existing code ...
    
      // Panel collapse toggles
      document.querySelectorAll('.panel__toggle').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation(); // Don't trigger other clicks
          const panelId = btn.dataset.panel;
          const panel = document.querySelector(`[data-panel-id="${panelId}"]`);
          if (panel) {
            panel.classList.toggle('panel--collapsed');
          }
        });
      });
    
      // ... rest of existing code ...
    }
    
    ```

    ***

    ## Optional: Persist Collapsed State

    If you want panels to *stay* collapsed after refresh, add this:

    ```
    // At the top of app.js with other state
    let COLLAPSED_PANELS = new Set(JSON.parse(localStorage.getItem('collapsed_panels') || '[]'));
    
    // In wireUI(), update the toggle handler:
    document.querySelectorAll('.panel__toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
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
    
    // In boot(), after wireUI(), restore collapsed state:
    for (const panelId of COLLAPSED_PANELS) {
      const panel = document.querySelector(`[data-panel-id="${panelId}"]`);
      if (panel) panel.classList.add('panel--collapsed');
    }
    
    ```


### Prioritization Suggestion

1. **.md Export** – Do this first (1-2 hours, huge value for backups & portability)
2. **Project Expansion + Related Items** – Makes the app feel more connected (next 3-5 hours)
3. **Basic Migration Tools** – Ties into BuJo ritual (after above)
4. **Year View** – Polish phase, once core feels solid
5. Toggle on Panles - Toggle to open/close panels
<br>
    <br>
    ***

    ## 