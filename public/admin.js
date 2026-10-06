const $=selector=>document.querySelector(selector);
const csrf=$('meta[name="csrf-token"]').content;
const labels={'lesson-report':'Lesson Report',notice:'お知らせ','word-rhythm':'Word Rhythm'};
const statuses={draft:'下書き',published:'公開中',archived:'アーカイブ'};
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value?new Date(value).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
let posts=[],media=[],current=null,dirty=false,view='posts',mediaPurpose='body',savedRange=null;

function status(message,error=false){$('#admin-status').textContent=message;$('#admin-status').classList.toggle('error',error);}
async function api(url,options={}){
  const response=await fetch(url,{...options,headers:{'X-CSRF-Token':csrf,...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...options.headers}});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'処理に失敗しました。');return data;
}
const run=fn=>async(...args)=>{try{await fn(...args);}catch(error){status(error.message||'接続できませんでした。もう一度お試しください。',true);}};
function confirmAction(title,message){
  return new Promise(resolve=>{
    const dialog=$('#confirm-dialog');$('#confirm-title').textContent=title;$('#confirm-message').textContent=message;
    const close=answer=>{dialog.close();$('#confirm-yes').onclick=null;$('#confirm-cancel').onclick=null;dialog.oncancel=null;resolve(answer);};
    $('#confirm-yes').onclick=()=>close(true);$('#confirm-cancel').onclick=()=>close(false);dialog.oncancel=event=>{event.preventDefault();close(false);};dialog.showModal();
  });
}
async function leaveEditor(){return !dirty||await confirmAction('保存されていない変更があります','保存せずに、この画面を離れますか？');}
function markDirty(){dirty=true;$('#post-save-state').textContent='未保存の変更があります';}
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});

async function showView(next,skipPrompt=false){
  if(!skipPrompt&&!await leaveEditor())return;
  view=next;dirty=false;status('');
  for(const name of ['posts','editor','media','members','messages'])$('#'+name+'-view').hidden=name!==next;
  document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view===next||(next==='editor'&&button.dataset.view==='posts')));
  $('#view-title').textContent={posts:'記事一覧',editor:current?'記事を編集':'新しい記事',media:'画像・音声',members:'保護者',messages:'お問い合わせ'}[next];
  $('#new-post').hidden=next==='editor';
  if(next==='posts')await loadPosts();
  if(next==='media')await loadMedia();
  if(next==='members')await loadMembers();
  if(next==='messages')await loadMessages();
}
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',run(()=>showView(button.dataset.view))));
async function loadPosts(){posts=(await api('/api/admin/posts')).posts;renderPosts();}
function renderPosts(){
  $('#stat-published').textContent=posts.filter(p=>p.status==='published').length;$('#stat-draft').textContent=posts.filter(p=>p.status==='draft').length;$('#stat-total').textContent=posts.length;
  const q=$('#post-search').value.toLowerCase(),category=$('#category-filter').value,postStatus=$('#status-filter').value;
  const filtered=posts.filter(p=>(postStatus?p.status===postStatus:p.status!=='archived')&&(!category||p.category===category)&&(!q||(p.title+' '+p.excerpt).toLowerCase().includes(q)));
  $('#post-list').innerHTML=filtered.length?filtered.map(p=>`<article class="post-row"><img src="${escape(p.cover||'/assets/f00f2c_949466f73c8e46fc9ece2b2065c8d0ce~mv2.png')}" alt=""><div class="post-row-main"><span class="badge ${p.category}">${labels[p.category]}</span><h2>${escape(p.title)}</h2><div class="post-row-meta"><span class="badge status-${p.status}">${statuses[p.status]}</span><span>${p.visibility==='members'?'保護者限定':'一般公開'}</span><time>${date(p.updated_at)}</time></div></div><button data-edit="${p.id}" aria-label="${escape(p.title)} を編集">編集</button></article>`).join(''):'<div class="admin-empty"><h2>記事がありません</h2><p>「新しい記事を書く」から作成できます。</p></div>';
  document.querySelectorAll('[data-edit]').forEach(button=>button.addEventListener('click',run(()=>openEditor(button.dataset.edit))));
}
['post-search','category-filter','status-filter'].forEach(id=>$('#'+id).addEventListener('input',renderPosts));
async function openEditor(id=null){
  if(!await leaveEditor())return;
  current=id?(await api('/api/admin/posts/'+id)).post:null;
  await showView('editor',true);$('#post-form').reset();
  for(const key of ['title','excerpt','category','visibility','lesson_date','class_name','cover']){
    const input=$('#post-form').elements.namedItem(key);input.value=current?.[key]??({category:'lesson-report',visibility:'members'}[key]||'');
  }
  $('#post-body').innerHTML=current?.body||'';$('#post-featured').checked=!!current?.featured;
  syncEditor();await loadRevisions();dirty=false;$('#post-title').focus();
}
function syncEditor(){
  $('#view-title').textContent=current?'記事を編集':'新しい記事';
  $('#post-save-state').textContent=current?`${statuses[current.status]} · ${date(current.updated_at)} 保存`:'未保存';
  $('#save-draft').textContent=current?.status==='published'?'下書きに戻す':'下書き保存';
  $('#publish-post').textContent=current?.status==='published'?'更新を公開':'公開する';
  $('#archive-post').hidden=!current||current.status==='archived';
  $('#post-featured').disabled=$('#post-category').value!=='notice'||$('#post-visibility').value!=='public';
  const cover=$('#post-cover').value;$('#cover-preview').innerHTML=cover?`<img src="${escape(cover)}" alt="カバー画像">`:'画像を選択';
}
$('#new-post').addEventListener('click',run(()=>openEditor()));$('#back-to-posts').addEventListener('click',run(()=>showView('posts')));
$('#post-form').addEventListener('input',markDirty);$('#post-body').addEventListener('input',markDirty);
['post-category','post-visibility'].forEach(id=>$('#'+id).addEventListener('change',()=>{syncEditor();markDirty();}));
function postData(postStatus){
  const data=Object.fromEntries(new FormData($('#post-form')));delete data.featured;
  return {...data,body:$('#post-body').innerHTML,status:postStatus,featured:$('#post-featured').checked,version:current?.version};
}
async function save(postStatus){
  if(!$('#post-form').reportValidity())return;
  if(postStatus==='published'&&$('#post-visibility').value==='public'&&(!current||current.visibility!=='public'||current.status!=='published')){
    if(!await confirmAction('一般公開しますか？','この記事と画像・音声は、ログインしていない方も閲覧できるようになります。'))return;
  }
  if(postStatus==='draft'&&current?.status==='published'&&!await confirmAction('下書きに戻しますか？','この記事は保護者ページとホームページに表示されなくなります。'))return;
  const buttons=[$('#save-draft'),$('#publish-post'),$('#archive-post')];buttons.forEach(b=>b.disabled=true);
  try{
    const result=await api('/api/admin/posts'+(current?'/'+current.id:''),{method:current?'PUT':'POST',body:JSON.stringify(postData(postStatus))});
    current=result.post;dirty=false;syncEditor();await loadRevisions();status(postStatus==='published'?'記事を公開しました。':postStatus==='archived'?'記事をアーカイブしました。':'下書きを保存しました。');
  }finally{buttons.forEach(b=>b.disabled=false);}
}
$('#post-form').addEventListener('submit',run(async event=>{event.preventDefault();await save('draft');}));
$('#publish-post').addEventListener('click',run(()=>save('published')));
$('#archive-post').addEventListener('click',run(async()=>{if(await confirmAction('記事をアーカイブしますか？','記事は非表示になります。あとで「アーカイブ」から開き、再公開できます。'))await save('archived');}));
$('#preview-post').addEventListener('click',run(async()=>{
  if(!$('#post-form').reportValidity())return;
  const data=await api('/api/admin/preview',{method:'POST',body:JSON.stringify(postData('draft'))});
  let dialog=$('#preview-dialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='preview-dialog';dialog.className='preview-dialog';document.body.append(dialog);}
  dialog.innerHTML='<button type="button">プレビューを閉じる ×</button>'+data.html;dialog.querySelector('button').onclick=()=>dialog.close();dialog.querySelectorAll('a').forEach(a=>a.addEventListener('click',event=>event.preventDefault()));dialog.showModal();
}));
async function loadRevisions(){
  if(!current){$('#revision-list').textContent='保存後に履歴が表示されます。';return;}
  const revisions=(await api('/api/admin/posts/'+current.id+'/revisions')).revisions;
  $('#revision-list').innerHTML=revisions.length?revisions.map(r=>`<div class="revision-row"><span>${date(r.created_at)}</span><button type="button" data-restore="${r.id}">下書きとして復元</button></div>`).join(''):'以前の編集履歴はまだありません。';
  document.querySelectorAll('[data-restore]').forEach(button=>button.addEventListener('click',run(async()=>{
    if(!await confirmAction('以前の記事を復元しますか？','選んだ履歴を下書きとして復元します。現在の内容も履歴に残ります。'))return;
    const result=await api(`/api/admin/posts/${current.id}/restore/${button.dataset.restore}`,{method:'POST',body:JSON.stringify({version:current.version})});dirty=false;await openEditor(result.post.id);status('履歴を下書きとして復元しました。');
  })));
}

// Remember the insertion point while a media/link dialog has focus.
function rememberSelection(){const selection=window.getSelection();if(selection.rangeCount&&$('#post-body').contains(selection.anchorNode))savedRange=selection.getRangeAt(0).cloneRange();}
function restoreSelection(){const editor=$('#post-body');editor.focus();const selection=window.getSelection();selection.removeAllRanges();if(savedRange&&editor.contains(savedRange.startContainer))selection.addRange(savedRange);else{const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);selection.addRange(range);}}
function insertHtml(html){restoreSelection();document.execCommand('insertHTML',false,html);rememberSelection();markDirty();}
$('.editor-toolbar').addEventListener('mousedown',event=>{if(event.target.closest('button')){rememberSelection();event.preventDefault();}});
document.querySelectorAll('[data-command]').forEach(button=>button.addEventListener('click',()=>{restoreSelection();document.execCommand(button.dataset.command,false,button.dataset.value||null);rememberSelection();markDirty();}));
$('#post-body').addEventListener('paste',event=>{event.preventDefault();document.execCommand('insertText',false,event.clipboardData.getData('text/plain'));markDirty();});
$('#insert-link').addEventListener('click',()=>{rememberSelection();$('#link-form').reset();$('#link-text').value=window.getSelection()?.toString()||'';$('#link-dialog').showModal();});
$('#link-cancel').onclick=()=>$('#link-dialog').close();
$('#link-form').addEventListener('submit',event=>{event.preventDefault();const url=$('#link-url').value;if(!/^https?:\/\//i.test(url)){$('#link-url').setCustomValidity('https:// または http:// で始まるURLを入力してください。');$('#link-url').reportValidity();return;}$('#link-dialog').close();insertHtml(`<a href="${escape(url)}" rel="noopener noreferrer">${escape($('#link-text').value)}</a>`);});
$('#link-url').addEventListener('input',()=>$('#link-url').setCustomValidity(''));

function mediaTile(item,selectable=false){return `<${selectable?'button':'div'} class="media-tile"${selectable?` type="button" data-media="${item.id}"`:''}>${item.mime.startsWith('image/')?`<img src="${escape(item.url)}" alt="${escape(item.original_name)}" loading="lazy">`:!selectable?`<${item.mime.startsWith('audio/')?'audio':'video'} src="${escape(item.url)}" controls preload="metadata"></${item.mime.startsWith('audio/')?'audio':'video'}>`:`<div class="media-symbol">${item.mime.startsWith('audio/')?'♫':'▷'}</div>`}<p>${escape(item.original_name)}</p><small>${(item.size/1024/1024).toFixed(2)} MB · ${escape(item.mime.split('/')[0])}</small></${selectable?'button':'div'}>`;}
async function loadMedia(){media=(await api('/api/admin/media')).media;$('#media-library').innerHTML=media.length?media.map(m=>mediaTile(m)).join(''):'<p class="admin-empty">画像・音声をアップロードできます。</p>';}
async function openMedia(purpose){mediaPurpose=purpose;rememberSelection();await loadMedia();$('#media-hint').textContent=purpose==='cover'?'カバー画像を選んでください。':'画像・音声・動画を本文に追加します。';$('#editor-upload').accept=purpose==='cover'?'image/jpeg,image/png,image/gif,image/webp':'image/jpeg,image/png,image/gif,image/webp,audio/mpeg,audio/mp4,audio/ogg,audio/wav,video/mp4';renderPicker();$('#media-dialog').showModal();}
function renderPicker(){const items=media.filter(m=>mediaPurpose!=='cover'||m.mime.startsWith('image/'));$('#media-picker').innerHTML=items.length?items.map(m=>mediaTile(m,true)).join(''):'<p>ファイルをアップロードしてください。</p>';document.querySelectorAll('[data-media]').forEach(button=>button.onclick=()=>chooseMedia(media.find(m=>m.id===button.dataset.media)));}
function chooseMedia(item){$('#media-dialog').close();if(mediaPurpose==='cover'){$('#post-cover').value=item.url;syncEditor();markDirty();return;}if(item.mime.startsWith('image/'))insertHtml(`<p><img src="${escape(item.url)}" alt="${escape(item.original_name)}"></p><p><br></p>`);else{const tag=item.mime.startsWith('audio/')?'audio':'video';insertHtml(`<p>${escape(item.original_name)}</p><${tag} src="${escape(item.url)}" controls preload="metadata"></${tag}><p><br></p>`);}}
$('#insert-media').addEventListener('click',run(()=>openMedia('body')));$('#choose-cover').addEventListener('click',run(()=>openMedia('cover')));$('#close-media').onclick=()=>$('#media-dialog').close();$('#remove-cover').onclick=()=>{$('#post-cover').value='';syncEditor();markDirty();};
async function uploadFile(input,picker=false){
  const file=input.files[0];if(!file)return;if(file.size>25*1024*1024)throw new Error('ファイルは25MB以下にしてください。');
  const form=new FormData();form.append('file',file);input.disabled=true;status('ファイルをアップロードしています…');
  try{await api('/api/admin/media',{method:'POST',body:form});await loadMedia();if(picker)renderPicker();status('アップロードしました。'+(picker?'ファイルを選ぶと記事に追加できます。':''));}finally{input.disabled=false;input.value='';}
}
$('#library-upload').addEventListener('change',run(event=>uploadFile(event.target)));$('#editor-upload').addEventListener('change',run(event=>uploadFile(event.target,true)));

function showInvite(url){$('#invite-url').value=url;$('#invite-result').hidden=false;}
$('#member-form').addEventListener('submit',run(async event=>{event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;try{const result=await api('/api/admin/members',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(event.target)))});showInvite(result.url);event.target.reset();await loadMembers();status('招待リンクを作成しました。');}finally{button.disabled=false;}}));
$('#copy-invite').addEventListener('click',run(async()=>{try{await navigator.clipboard.writeText($('#invite-url').value);status('招待リンクをコピーしました。');}catch{$('#invite-url').select();status('リンクを選択しました。コピーして保護者にお知らせください。');}}));
async function loadMembers(){
  const members=(await api('/api/admin/members')).members;
  $('#member-list').innerHTML=members.map(m=>`<div class="member-row"><div><strong>${escape(m.name)} ${m.role==='admin'?'<span class="badge">管理者</span>':''}</strong><small>${escape(m.email)}</small><small>${m.active?(m.registered?'登録済み':'招待中'):'無効'}</small></div>${m.role==='parent'?`<div class="button-row">${m.active?`<button data-reinvite="${m.id}">招待・再設定リンク</button>`:''}<button data-toggle-member="${m.id}" data-active="${m.active?0:1}">${m.active?'無効にする':'有効にする'}</button></div>`:''}</div>`).join('');
  document.querySelectorAll('[data-reinvite]').forEach(button=>button.addEventListener('click',run(async()=>{if(!await confirmAction('新しいリンクを作成しますか？','以前の招待・再設定リンクは無効になります。'))return;showInvite((await api('/api/admin/members/'+button.dataset.reinvite+'/invite',{method:'POST'})).url);status('新しいリンクを作成しました。');})));
  document.querySelectorAll('[data-toggle-member]').forEach(button=>button.addEventListener('click',run(async()=>{const active=button.dataset.active==='1';if(!await confirmAction(active?'アカウントを有効にしますか？':'アカウントを無効にしますか？',active?'保護者が再びログインできるようになります。':'この保護者はログアウトされ、限定記事を閲覧できなくなります。'))return;await api('/api/admin/members/'+button.dataset.toggleMember,{method:'PUT',body:JSON.stringify({active})});await loadMembers();status('アカウントを更新しました。');})));
}
async function loadMessages(){
  const messages=(await api('/api/admin/messages')).messages, unread=messages.filter(m=>!m.is_read).length;$('#unread-count').textContent=unread||'';
  $('#message-list').innerHTML=messages.length?messages.map(m=>`<article class="message-card${m.is_read?'':' unread'}"><header><div><h2>${escape(m.subject||'お問い合わせ')}</h2><p class="message-info">${escape(m.name)} · <a href="mailto:${escape(m.email)}">${escape(m.email)}</a><br>${date(m.created_at)}</p></div><button data-message="${m.id}" data-read="${m.is_read?0:1}">${m.is_read?'未読にする':'既読にする'}</button></header><div class="message-content">${escape(m.message)}</div></article>`).join(''):'<div class="admin-empty">お問い合わせはまだありません。</div>';
  document.querySelectorAll('[data-message]').forEach(button=>button.addEventListener('click',run(async()=>{await api('/api/admin/messages/'+button.dataset.message,{method:'PUT',body:JSON.stringify({is_read:button.dataset.read==='1'})});await loadMessages();})));
}
$('#admin-logout').addEventListener('click',run(async()=>{if(!await leaveEditor())return;await api('/api/logout',{method:'POST'});dirty=false;location.assign('/');}));
run(async()=>{await showView('posts');await loadMessages();})();
