This is a "Timezone vs. Local Time" bug.
The "Sunday" issue and the confusing Alerts behavior are happening because the app mixes two different time concepts:

1. **ISO Strings** (which `due:` uses) are often read as **UTC**.
2. **"YYYY-MM-DD"** (which the Calendar/Week view uses) is parsed by JavaScript as **UTC midnight**, which translates to the **previous day** in the Western Hemisphere (e.g., EST, CST, PST).

This causes items to be "off by one day" in calculations, making "Tomorrow" look like "Today" or "Today" look "Overdue."
Here is the fix. I have corrected the time math to strictly use **Local Midnight** for everything.

### 1\. Update `app.js`

Open `app.js` and replace the specific functions below.

#### A. Add this Helper Function

Add this to the top of your `app.js` (near `DB_NAME`, etc) so we can format dates consistently without timezone shifts.
JavaScript

```
// Add this helper near the top of app.js
function toLocalDateStr(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
```

#### B. Fix `getDateUrgency` (The core bug)

This function was treating `2026-01-20` as UTC. We need to force it to be Local Time so your math is correct.
JavaScript

```
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
```

#### C. Fix `getWeekDays` and `getDaysInWeek`

These were generating the wrong date string (sometimes yesterday's date) because of `toISOString()`.
JavaScript

```
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
      // FIX: Use local formatter instead of toISOString
      dateStr: toLocalDateStr(date),
      display: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    });
  }
  
  return days;
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
      // FIX: Use local formatter instead of toISOString
      dateStr: toLocalDateStr(date),
      display: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    });
  }

  return days;
}
```

### 2\. Why items were missing from Alerts

You mentioned `/task` and `/project` weren't showing up.

* **The Logic:** The "Alerts" panel is currently designed to **only** show items that have a specific Date (`monday:`, `due:`, or Calendar drops) OR Projects that haven't been touched in 21 days ("Stale").
* **The Result:** A plain `/task Buy Milk` (with no date) is effectively "hidden" in this view. It lives in the database but doesn't have a visual home in the 3 columns (unless you search for it or look at "Recent Log").

**Recommendation:** If you want unscheduled tasks to appear somewhere, you might want to rename the "Notes" panel to "Active" and include tasks there.
Then have notes stack under or inside individual projects. Each project collapses and expands with all tag related /notes. 

<br>
<br>
<br>
<br>
<br>
<br>
<br>
<br>
<br>
<br>
<br>
