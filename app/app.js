import { loadInitialMarkdown, exportMarkdownFile, importMarkdownFile } from './io.js';
import { saveDraft, loadDraft, clearDraft } from './storage.js';
import { buildSectionIndex, jumpToSection, highlightSearch } from './nav.js';

const DRAFT_KEY = 'everything_editor_draft_v1';

const $ = (sel) => document.querySelector(sel);
const statusEl = $('#status');
const sectionsEl = $('#sections');
const toastEl = $('#toast');
const fileInput = $('#fileInput');

function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>toastEl.classList.remove('show'), 1600);
}

function setStatus(msg){ statusEl.textContent = msg; }

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

  // Autosave draft (debounced)
  let t;
  editor.on('change', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const md = editor.getMarkdown();
      saveDraft(DRAFT_KEY, md);
      setStatus('Draft saved');
      refreshSections(md);
    }, 450);
  });

const lastTouchedEl = $('#lastTouched');

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

  
  refreshSections(editor.getMarkdown());
}

function refreshSections(markdown){
  const items = buildSectionIndex(markdown);
  sectionsEl.innerHTML = '';
  for(const it of items){
    const a = document.createElement('a');
    a.href = '#';
    a.className = 'sectionItem';
    a.innerHTML = `<span class="hash">##</span><span class="label"></span>`;
    a.querySelector('.label').textContent = it.title;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      jumpToSection(editor, it.line);
    });
    sectionsEl.appendChild(a);
  }
}

editor.moveCursorTo(it.line, 0);

// Then scroll the editor viewport
setTimeout(() => {
  const editorEl = document.querySelector('.toastui-editor-contents');
  if (!editorEl) return;

  const headings = editorEl.querySelectorAll('h1, h2, h3, h4');
  const target = headings[it.index]; // see note below
  if (target) {
    target.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
}, 0);


async function init(){
  setStatus('Loading…');

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
  $('#btnPrint')?.addEventListener('click', () => window.print());


  $('#btnExport').addEventListener('click', () => {
    const md = editor.getMarkdown();
    exportMarkdownFile(md, 'README.md');
    toast('Exported README.md');
  });

  $('#btnImport').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if(!file) return;
    const md = await importMarkdownFile(file);
    editor.setMarkdown(md);
    saveDraft(DRAFT_KEY, md);
    toast('Imported');
    setStatus('Imported file');
    fileInput.value = '';
  });

  $('#btnReset').addEventListener('click', () => {
    clearDraft(DRAFT_KEY);
    toast('Draft cleared');
    setStatus('Draft cleared');
  });

  // Search (highlights in editor by moving cursor)
  $('#search').addEventListener('input', (e) => {
    const q = e.target.value ?? '';
    if(!q.trim()) return;
    highlightSearch(editor, q.trim());
  });

  // Keyboard shortcut: Ctrl/Cmd+S exports
  window.addEventListener('keydown', (e) => {
    const isMac = navigator.platform.toLowerCase().includes('mac');
    const saveCombo = (isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 's';
    if(saveCombo){
      e.preventDefault();
      const md = editor.getMarkdown();
      exportMarkdownFile(md, 'README.md');
      toast('Exported README.md');
    }
  });

  toast('Ready');
}

init().catch((err) => {
  console.error(err);
  setStatus('Error');
  toast('Error loading editor');
});
