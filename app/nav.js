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
  const editorMode = editor.isMarkdownMode() ? 'markdown' : 'wysiwyg';
  
  // Only try to set cursor position in Markdown mode
  if(editorMode === 'markdown'){
    try{
      const pos = [lineIndex + 1, 0];
      editor.setSelection(pos, pos);
      editor.focus();
    }catch(err){
      try{
        const pos = [lineIndex, 0];
        editor.setSelection(pos, pos);
        editor.focus();
      }catch(err2){
        console.warn('Could not move cursor:', err2);
      }
    }
  }

  // Scroll to the section (works in all modes)
  setTimeout(() => {
    let activeContainer;
    
    if(editorMode === 'wysiwyg'){
      // WYSIWYG mode - find the heading directly in the editor
      activeContainer = document.querySelector('.toastui-editor-ww-container .ProseMirror');
      if(activeContainer){
        const headings = activeContainer.querySelectorAll('h1, h2, h3, h4, h5, h6');
        if(headings[sectionIndex]){
          headings[sectionIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
          headings[sectionIndex].classList.add('section-focus');
          setTimeout(() => headings[sectionIndex].classList.remove('section-focus'), 1200);
          return;
        }
      }
    } else {
      // Markdown mode - scroll by estimated line position
      activeContainer = document.querySelector('.toastui-editor-md-container .CodeMirror-scroll');
      if(activeContainer){
        const estimatedScroll = lineIndex * 24;
        activeContainer.scrollTo({
          top: estimatedScroll,
          behavior: 'smooth'
        });
        return;
      }
    }
    
    // Fallback: try to find any visible container
    const containers = [
      document.querySelector('.toastui-editor-ww-container .ProseMirror'),
      document.querySelector('.toastui-editor-md-container .CodeMirror-scroll'),
      document.querySelector('.toastui-editor-contents')
    ];
    
    activeContainer = containers.find(c => c && c.offsetParent !== null);
    if(activeContainer){
      const headings = activeContainer.querySelectorAll('h1, h2, h3, h4, h5, h6');
      if(headings[sectionIndex]){
        headings[sectionIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
        headings[sectionIndex].classList.add('section-focus');
        setTimeout(() => headings[sectionIndex].classList.remove('section-focus'), 1200);
      }
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
