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
