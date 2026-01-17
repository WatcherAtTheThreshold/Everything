**1\. Markdown Rendering** Currently, you are escaping HTML, but the body text is plain. Since this is a dev log, adding a lightweight Markdown parser (or just bold/code highlighting) would make your logs much more readable.

* *Idea:* Allow backticks \`code\` in the notes to highlight tech stacks like `#beep` or `#mechanic`.

**2\. Task "Rollover"** In a physical Bullet Journal, you have to manually rewrite tasks to move them to the next day (migration).

* *Current state:* Tasks stay on their scheduled day.
* *Idea:* A "Migrate" button on the Week View that pushes all unfinished tasks from "Yesterday" to "Today."

**3\. Project "Context" View** Right now, you can filter by tag. However, your data shows specific projects like "Coherence" (the roguelike game).

* *Idea:* A dedicated "Project View" where clicking a project card opens a filtered view of *only* that project's tasks, notes, and history, effectively turning the console into a project manager for that specific item.