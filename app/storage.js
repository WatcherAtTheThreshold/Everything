export function saveDraft(key, markdown){
  try{
    localStorage.setItem(key, markdown);
  }catch{}
}

export function loadDraft(key){
  try{
    const v = localStorage.getItem(key);
    return v && v.length ? v : null;
  }catch{
    return null;
  }
}

export function clearDraft(key){
  try{
    localStorage.removeItem(key);
  }catch{}
}
