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

export function jumpToSection(editor, lineIndex, sectionIndex){
  // Move cursor to the heading line
  try{
    editor.setSelection([lineIndex, 0], [lineIndex, 0]);
    editor.focus();
  }catch(err){
    console.warn('Could not set editor selection:', err);
  }

  // Scroll the preview pane to the heading and highlight it
  setTimeout(() => {
    const editorEl = document.querySelector('.toastui-editor-contents');
    if (!editorEl) return;

    const headings = editorEl.querySelectorAll('h1, h2, h3, h4');
    const target = headings[sectionIndex];
    
    if (target) {
      target.scrollIntoView({ block: 'start', behavior: 'smooth' });
      
      // Visual highlight effect
      target.classList.add('section-focus');
      setTimeout(() => target.classList.remove('section-focus'), 1200);
    }
  }, 50);
}

export function highlightSearch(editor, query){
  // Light search: jump to first match in the Markdown text.
  const md = editor.getMarkdown();
  const lines = md.split(/\r?\n/);
  const q = query.toLowerCase();
  
  for(let i=0;i<lines.length;i++){
    const idx = lines[i].toLowerCase().indexOf(q);
    if(idx !== -1){
      try{
        editor.setSelection([i, idx], [i, idx + query.length]);
        editor.focus();
        return true;
      }catch(err){
        console.warn('Could not highlight search result:', err);
      }
    }
  }
  return false;
}
