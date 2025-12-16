export async function loadInitialMarkdown(readmePath){
  try{
    const res = await fetch(readmePath, { cache: 'no-store' });
    if(!res.ok) throw new Error('README not found');
    return await res.text();
  }catch{
    // First run: no README at root, or local preview via file://
    return `# Everything Repo\n\nThis is your editor landing page.\n\n## Quick Tasks\n- [ ] Add your first task\n`;
  }
}

export function exportMarkdownFile(markdown, filename){
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function importMarkdownFile(file){
  return await file.text();
}
