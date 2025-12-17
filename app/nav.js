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
  // Move cursor to the heading line using Toast UI's API
  try{
    // This moves the cursor to the start of the specified line (1-indexed in some versions, 0-indexed in others)
    const pos = [lineIndex + 1, 0]; // Try 1-indexed first
    editor.setSelection(pos, pos);
    editor.focus();
  }catch(err){
    // Fallback to 0-indexed
    try{
      const pos = [lineIndex, 0];
      editor.setSelection(pos, pos);
      editor.focus();
    }catch(err2){
      console.warn('Could not move cursor:', err2);
    }
  }

  // Scroll the visible editor/preview container
  setTimeout(() => {
    // Get all possible editor containers
    const mdScrollContainer = document.querySelector('.toastui-editor-md-container .toastui-editor-md-splitter .toastui-editor-md-vertical-style .ProseMirror, .CodeMirror-scroll');
    const wwScrollContainer = document.querySelector('.toastui-editor-ww-container .toastui-editor-ww-mode .ProseMirror');
    const previewScrollContainer = document.querySelector('.toastui-editor-contents');
    
    // Find which container is currently active/visible
    const activeContainer = [mdScrollContainer, wwScrollContainer, previewScrollContainer]
      .find(c => c && c.offsetParent !== null);
    
    if(activeContainer){
      // Calculate approximate scroll position (each line is ~20-30px typically)
      const estimatedScroll = lineIndex * 24;
      activeContainer.scrollTo({
        top: estimatedScroll,
        behavior: 'smooth'
      });
      
      // Also try to find and highlight the actual heading element
      setTimeout(() => {
        const headings = activeContainer.querySelectorAll('h1, h2, h3, h4');
        if(headings[sectionIndex]){
          headings[sectionIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
          headings[sectionIndex].classList.add('section-focus');
          setTimeout(() => headings[sectionIndex].classList.remove('section-focus'), 1200);
        }
      }, 150);
    }
  }, 100);
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
