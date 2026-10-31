const $ = id => document.getElementById(id);
const state = { key:null, scripts:[], editing:null };
const savedKey = 'lunex-owner-key-v1';
const base = location.origin;
function escapeHtml(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function toast(message,error=false){$('notice').textContent=message;$('notice').classList.remove('hidden','error');if(error)$('notice').classList.add('error');window.scrollTo({top:$('notice').getBoundingClientRect().top+scrollY-100,behavior:'smooth'});}
async function api(path,opts={}){const r=await fetch(path,{...opts,headers:{'Content-Type':'application/json',...(state.key?{'x-lunex-key':state.key}:{}),...(opts.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`حدث خطأ (${r.status})`);return d;}
async function boot(){
 $('year').textContent=new Date().getFullYear();
 try{
  state.key=localStorage.getItem(savedKey);
  if(state.key){const v=await api('/api/verify-key',{method:'POST',body:JSON.stringify({key:state.key})});if(!v.valid)state.key=null;}
  if(!state.key){const d=await api('/api/owner-key',{method:'POST',body:'{}'});state.key=d.key;localStorage.setItem(savedKey,state.key);$('keyPanel').classList.remove('hidden');$('ownerKey').textContent=state.key;toast('تم إنشاء مفتاح ملكيتك. انسخه واحفظه بمكان آمن.');}
  await loadScripts();
 }catch(e){toast(e.message,true);}
}
async function loadScripts(){
 const d=await api('/api/scripts');state.scripts=d.scripts||[];render();
}
function render(){
 $('scriptList').innerHTML=state.scripts.map(s=>{
  const url=`${base}/${encodeURIComponent(s.name)}`;
  return `<article class="script-card"><div class="script-top"><div><div class="script-name">${escapeHtml(s.name)}</div><div class="script-date">آخر تحديث: ${new Date(s.updated_at).toLocaleString('ar-SA')}</div></div><span class="pill ${s.revoked?'off':''}">${s.revoked?'معطّل':'منشور'}</span></div><div class="url-box"><code>${escapeHtml(url)}</code><button class="secondary" data-copy="${escapeHtml(url)}">نسخ الرابط</button></div><div class="card-actions"><button class="secondary" data-edit="${escapeHtml(s.name)}">تحديث السورس</button><button class="ghost" data-toggle="${escapeHtml(s.name)}">${s.revoked?'تفعيل':'تعطيل'}</button><button class="ghost" data-delete="${escapeHtml(s.name)}">حذف</button><button class="ghost" data-loader="${escapeHtml(s.name)}">نسخ كود التشغيل</button></div></article>`;
 }).join('');
 $('empty').classList.toggle('hidden',state.scripts.length>0);
}
function openEditor(script=null){
 state.editing=script?.name||null;$('modalTitle').textContent=script?'تحديث السورس':'إنشاء سورس';
 $('scriptName').value=script?.name||'';$('scriptName').disabled=!!script;
 $('source').value=script?.content||'';updateCount();$('editorError').classList.add('hidden');$('editor').showModal();
}
function updateCount(){$('count').textContent=`${$('source').value.length.toLocaleString('ar')} حرف`;}
async function copy(text){try{await navigator.clipboard.writeText(text);toast('تم النسخ.');}catch{prompt('انسخ النص يدويًا:',text);}}
$('newBtn').onclick=$('emptyNew').onclick=()=>openEditor();
$('closeModal').onclick=$('cancel').onclick=()=>$('editor').close();
$('source').addEventListener('input',updateCount);
$('scriptForm').addEventListener('submit',async e=>{
 e.preventDefault();const name=state.editing||$('scriptName').value.trim();const content=$('source').value;
 $('saveBtn').disabled=true;$('saveBtn').textContent='جاري الحفظ…';
 try{await api('/api/scripts',{method:'POST',body:JSON.stringify({name,content})});$('editor').close();await loadScripts();toast('تم حفظ السورس وتحديث الرابط.');}
 catch(err){$('editorError').textContent=err.message;$('editorError').classList.remove('hidden');}
 finally{$('saveBtn').disabled=false;$('saveBtn').textContent='حفظ ونشر';}
});
$('scriptList').addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b)return;
 try{
  if(b.dataset.copy) return copy(b.dataset.copy);
  if(b.dataset.loader) return copy(`loadstring(game:HttpGet("${base}/${b.dataset.loader}?exec=1"))()`);
  if(b.dataset.edit){const s=state.scripts.find(x=>x.name===b.dataset.edit);if(!s)return;openEditor(s);return;}
  if(b.dataset.toggle){await api(`/api/scripts/${encodeURIComponent(b.dataset.toggle)}/toggle`,{method:'POST',body:'{}'});await loadScripts();toast('تم تحديث حالة السورس.');}
  if(b.dataset.delete&&confirm(`حذف ${b.dataset.delete}؟`)){await api(`/api/scripts/${encodeURIComponent(b.dataset.delete)}`,{method:'DELETE'});await loadScripts();toast('تم حذف السورس.');}
 }catch(err){toast(err.message,true);}
});
$('keyBtn').onclick=()=>{$('keyPanel').classList.toggle('hidden');$('ownerKey').textContent=state.key||'غير متوفر';};
$('copyKey').onclick=()=>copy(state.key||'');
$('hideKey').onclick=()=>$('keyPanel').classList.add('hidden');
boot();
