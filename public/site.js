const menu=document.querySelector('.mobile-menu');
menu?.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));document.querySelector('#main-nav').classList.toggle('open',open);});
const slides=[...document.querySelectorAll('.slide')];
let currentSlide=0,paused=matchMedia('(prefers-reduced-motion: reduce)').matches;
const setSlide=i=>{slides[currentSlide]?.classList.remove('active');currentSlide=(i+slides.length)%slides.length;slides[currentSlide]?.classList.add('active');};
const pauseButton=document.querySelector('[data-slide="pause"]');
function showPauseState(){if(pauseButton){pauseButton.textContent=paused?'▶':'Ⅱ';pauseButton.setAttribute('aria-label',paused?'スライドショーを再生':'スライドショーを一時停止');}}
showPauseState();
if(slides.length>1)setInterval(()=>{if(!paused&&!document.hidden)setSlide(currentSlide+1);},5500);
document.querySelector('[data-slide="prev"]')?.addEventListener('click',()=>{paused=true;showPauseState();setSlide(currentSlide-1);});
document.querySelector('[data-slide="next"]')?.addEventListener('click',()=>{paused=true;showPauseState();setSlide(currentSlide+1);});
pauseButton?.addEventListener('click',()=>{paused=!paused;showPauseState();});

const lightbox=document.querySelector('#lightbox'),gallery=[...document.querySelectorAll('[data-gallery] img')];let galleryIndex=0;
function showPhoto(i){galleryIndex=(i+gallery.length)%gallery.length;lightbox.querySelector('img').src=gallery[galleryIndex].src;lightbox.querySelector('img').alt=gallery[galleryIndex].alt;lightbox.querySelector('.lightbox-count').textContent=`${galleryIndex+1} / ${gallery.length}`;}
document.querySelectorAll('[data-gallery]').forEach(button=>button.addEventListener('click',()=>{showPhoto(Number(button.dataset.gallery));lightbox.showModal();}));
lightbox?.querySelector('.lightbox-close').addEventListener('click',()=>lightbox.close());
lightbox?.querySelector('.lightbox-prev').addEventListener('click',()=>showPhoto(galleryIndex-1));
lightbox?.querySelector('.lightbox-next').addEventListener('click',()=>showPhoto(galleryIndex+1));
lightbox?.addEventListener('keydown',event=>{if(event.key==='ArrowLeft')showPhoto(galleryIndex-1);if(event.key==='ArrowRight')showPhoto(galleryIndex+1);});
lightbox?.addEventListener('click',event=>{if(event.target===lightbox)lightbox.close();});

document.querySelectorAll('[data-api-form]').forEach(form=>form.addEventListener('submit',async event=>{
  event.preventDefault();const button=form.querySelector('[type="submit"]'),status=form.querySelector('.form-status');
  if(!form.reportValidity())return;
  const data=Object.fromEntries(new FormData(form));
  if(data.confirm_password!==undefined&&data.password!==data.confirm_password){status.textContent='パスワードが一致しません。';status.classList.add('error');return;}
  button.disabled=true;status.textContent='送信中…';status.classList.remove('error');
  try{
    const response=await fetch(form.dataset.apiForm,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'送信できませんでした。');
    if(result.next){location.assign(result.next);return;}
    form.reset();status.textContent='Your details were sent successfully! お問い合わせを受け付けました。';
  }catch(error){status.textContent=error.message||'接続できませんでした。もう一度お試しください。';status.classList.add('error');}
  finally{button.disabled=false;}
}));
document.querySelector('[data-logout]')?.addEventListener('click',async event=>{
  const button=event.currentTarget;button.disabled=true;
  try{const response=await fetch('/api/logout',{method:'POST',headers:{'X-CSRF-Token':button.dataset.csrf}});if(!response.ok)throw new Error();location.assign('/');}catch{button.disabled=false;button.textContent='再度ログアウトする';}
});
