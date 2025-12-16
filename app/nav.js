// Build a simple section list from Markdown headings.
// Uses '## ' as the main navigable level.
export function buildSectionIndex(markdown){
  const lines = (markdown ?? '').split(/\r?\n/);
  const items = [];
  for(let i=0;i<lines.length;i++){
    const m = lines[i].match(/^##\s+(.+)\s*$/);
    if(m){
      items.push({ title: m[1].trim(), line: i });
    }
  }
  return items;
}

export function jumpToSection(editor, lineIndex){
  // Toast UI selection uses [line, ch] (0-based)
  try{
    editor.setSelection([lineIndex, 0], [lineIndex, 0]);
    editor.focus();
  }catch{
    // If selection API differs in your build, this fails gracefully.
  }
}

export function highlightSearch(editor, query){
  // Very light search: jump to first match in the Markdown text.
  const md = editor.getMarkdown();
  const lines = md.split(/\r?\n/);
  const q = query.toLowerCase();
  for(let i=0;i<lines.length;i++){
    const idx = lines[i].toLowerCase().indexOf(q);
    if(idx !== -1){
      try{
        editor.setSelection([i, idx], [i, idx + query.length]);
        editor.focus();
      }catch{}
      return true;
    }
  }
  return false;
}
