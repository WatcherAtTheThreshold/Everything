import { loadInitialMarkdown, exportMarkdownFile, importMarkdownFile } from './io.js';
import { saveDraft, loadDraft } from './storage.js';
import { buildSectionIndex, jumpToSection } from './nav.js';

const DRAFT_KEY = 'everything_editor_draft_v1';

const $ = (sel) => document.querySelector(sel);
const statusEl = $('#status');
const sectionsEl = $('#sections');
const toastEl = $('#toast');
const lastTouchedEl = $('#lastTouched');
const fileInput = $('#fileInput');

function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>toastEl.classList.remove('show'), 1600);
}

function setStatus(msg){ statusEl.textContent = msg; }

function setLastTouched(){
  const d = new Date();
  localStorage.setItem('everything_last_touched', d.toISOString());
  if(lastTouchedEl) lastTouchedEl.textContent = `Last touched: ${d.toLocaleString()}`;
}

function loadLastTouched(){
  const iso = localStorage.getItem('everything_last_touched');
  if(!iso || !lastTouchedEl) return;
  lastTouchedEl.textContent = `Last touched: ${new Date(iso).toLocaleString()}`;
}

function printMarkdown(editor){
  // Get the rendered HTML from the editor
  const html = editor.getHTML();
  
  // Create a print window with clean styles
  const printWindow = window.open('', '_blank', 'width=800,height=600');
  
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Everything Repo - Print</title>
      <style>
        * { box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
          line-height: 1.6;
          color: #24292e;
          max-width: 980px;
          margin: 0 auto;
          padding: 45px;
        }
        h1 { font-size: 2em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; margin-top: 24px; margin-bottom: 16px; }
        h2 { font-size: 1.5em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; margin-top: 24px; margin-bottom: 16px; }
        p { margin-top: 0; margin-bottom: 16px; }
        
        /* Styled Keyboard Keys for Print */
        code {
          font-family: 'Courier New', monospace;
          font-size: 85%;
          background: #f6f8fa;
          border: 1px solid #c8d1db;
          border-radius: 6px;
          padding: 0.2em 0.4em;
        }

        /* Specific styling for keys inside the shortcuts table */
        table code {
          background: #ffffff;
          border: 1px solid #adb5bd;
          box-shadow: 0 1px 0 rgba(0,0,0,0.2);
          font-weight: 600;
          white-space: nowrap;
        }

        table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
        table th, table td { border: 1px solid #dfe2e5; padding: 6px 13px; }
        table th { background: #f6f8fa; font-weight: 600; }
        
        @media print {
          body { padding: 0; }
          /* Ensure shadows and borders render in all browsers */
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          h1, h2, h3 { page-break-after: avoid; }
        }
      </style>
    </head>
    <body>
      ${html}
      <script>
        window.onload = function() {
          window.print();
          setTimeout(function() { window.close(); }, 100);
        };
      </script>
    </body>
    </html>
  `);
  
  printWindow.document.close();
}

let editor;

function createEditor(initialMarkdown){
  // eslint-disable-next-line no-undef
  editor = new toastui.Editor({
    el: $('#editor'),
    height: '100%',
    initialEditType: 'wysiwyg',
    previewStyle: 'tab',
    initialValue: initialMarkdown ?? '',
    usageStatistics: false,
    hideModeSwitch: false
  });

  // Load last touched time on init
  loadLastTouched();

  // Autosave draft (debounced)
  let t;
  editor.on('change', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const md = editor.getMarkdown();
      saveDraft(DRAFT_KEY, md);
      setStatus('Draft saved');
      setLastTouched();
      refreshSections(md);
    }, 450);
  });

  refreshSections(editor.getMarkdown());
}

function refreshSections(markdown){
  const items = buildSectionIndex(markdown);
  sectionsEl.innerHTML = '';
  for(let i = 0; i < items.length; i++){
    const it = items[i];
    const a = document.createElement('a');
    a.href = '#';
    a.className = 'sectionItem';
    a.innerHTML = `<span class="hash">##</span><span class="label"></span>`;
    a.querySelector('.label').textContent = it.title;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      jumpToSection(editor, it.line, i);
    });
    sectionsEl.appendChild(a);
  }
}

async function init(){
  setStatus('Loadingâ€¦');

  const draft = loadDraft(DRAFT_KEY);
  const initial = draft ?? await loadInitialMarkdown('./README.md');

  createEditor(initial);

  if(draft){
    toast('Restored local draft');
    setStatus('Draft restored');
  }else{
    setStatus('Loaded README.md');
  }

  // Wire buttons
  $('#btnPrint')?.addEventListener('click', () => {
    printMarkdown(editor);
    toast('Opening print dialogâ€¦');
  });

  $('#btnExport').addEventListener('click', () => {
  const md = editor.getMarkdown();
  const filename = $('#fileName').value.trim() || 'README.md';
  // Ensure it has .md extension
  const finalName = filename.endsWith('.md') ? filename : filename + '.md';
  exportMarkdownFile(md, finalName);
  toast(`Exported ${finalName}`);
});

  $('#btnImport').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if(!file) return;
    const md = await importMarkdownFile(file);
    editor.setMarkdown(md);
    saveDraft(DRAFT_KEY, md);
    $('#fileName').value = file.name;
    toast('Imported');
    setStatus('Imported file');
    setLastTouched();
    fileInput.value = '';
  });



  // Keyboard shortcut: Ctrl/Cmd+S exports
  window.addEventListener('keydown', (e) => {
    const isMac = navigator.platform.toLowerCase().includes('mac');
    const saveCombo = (isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 's';
    if(saveCombo){
  e.preventDefault();
  const md = editor.getMarkdown();
  const filename = $('#fileName').value.trim() || 'README.md';
  const finalName = filename.endsWith('.md') ? filename : filename + '.md';
  exportMarkdownFile(md, finalName);
  toast(`Exported ${finalName}`);
}
  });

  toast('Ready');
}

init().catch((err) => {
  console.error(err);
  setStatus('Error');
  toast('Error loading editor');
});
