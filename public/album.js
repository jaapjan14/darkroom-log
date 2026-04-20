const slug=location.pathname.replace('/album/','').replace(/\//g,'');
let album=null,assetMeta={};
let ssActiveSlot='a',ssIndex=0,ssPausedState=false,ssTimer=null,ssHideTimer=null;
let ssAudio=null,ssAudioFade=null,ssDescVisible=true,ssCleanupTimers=[];

// Cross-tab music coordination — stop music in any other darkroom tab when this one takes over
const _bc = (() => { try { return new BroadcastChannel('darkroom-music'); } catch(e) { return null; } })();
if (_bc) _bc.addEventListener('message', e => { if (e.data === 'stop') stopMusic(); });

const KB=[
  {s:'scale(1.0) translate(-3%,-3%)',e:'scale(1.25) translate(2%,2%)'},
  {s:'scale(1.25) translate(3%,2%)',e:'scale(1.0) translate(-2%,-2%)'},
  {s:'scale(1.0) translate(4%,-4%)',e:'scale(1.3) translate(-3%,3%)'},
  {s:'scale(1.3) translate(-4%,3%)',e:'scale(1.0) translate(3%,-2%)'},
  {s:'scale(1.0) translate(0%,-5%)',e:'scale(1.25) translate(0%,3%)'},
  {s:'scale(1.25) translate(0%,4%)',e:'scale(1.0) translate(0%,-3%)'},
];

async function init(){
  const r=await fetch('/api/public/album/'+slug);
  if(!r.ok){document.getElementById('photo-grid').innerHTML='<div class="loading" style="grid-column:1/-1">Album not found.</div>';return;}
  album=await r.json();
  document.title=album.title+' — Darkroom Log';
  document.getElementById('album-name').textContent=album.title;
  if (isEmbed) {
    const coverId = album.cover || album.assets[0];
    if (coverId) {
      document.getElementById('embed-hero-img').src = '/api/public/thumb/' + coverId;
      document.getElementById('embed-hero-title').textContent = album.title;
      document.getElementById('embed-hero').style.display = 'block';
      document.getElementById('photo-grid').style.display = 'none';
    }
  } else {
    // If ?autoplay landed inside an iframe, escalate to top-level so we escape the embed
    if (new URLSearchParams(location.search).has('autoplay') && window !== window.top) {
      try { window.top.location.href = window.location.href; } catch(e) {}
      return;
    }
    renderGrid();
    if (new URLSearchParams(location.search).has('autoplay')) openSlideshow(0);
  }
}

function renderGrid(){
  const g=document.getElementById('photo-grid');
  if(!album.assets.length){g.innerHTML='<div class="loading" style="grid-column:1/-1">No photos.</div>';return;}
  g.innerHTML=album.assets.map((id,i)=>`<div class="photo-item" data-action="openSlideshow" data-idx="${i}"><img src="/api/public/thumb/${id}" loading="lazy"></div>`).join('');
}

async function openSlideshow(idx){
  ssIndex=idx;ssPausedState=false;ssActiveSlot='a';ssDescVisible=true;ssCleanupTimers=[];
  document.getElementById('ss-slide-a').innerHTML='';
  document.getElementById('ss-slide-b').innerHTML='';
  document.getElementById('ss-overlay').classList.add('active');
  startMusic();
  await showTitleCard();
  showKBSlide(idx);
  scheduleNext();
  showSSControls();
}
function startSlideshow(){openSlideshow(0);}

async function showTitleCard(){
  const settings=album.slideshowSettings||{};
  if(!settings.showTitle)return;
  const card=document.getElementById('ss-title-card');
  const content=document.getElementById('ss-title-card-content');
  let html=`<div class="ss-title-main">${album.title}</div>`;
  html+=`<div style="width:60px;height:1px;background:#c8611a;margin:1.5rem auto"></div>`;
  if(settings.byline)html+=`<div class="ss-title-sub">Photography by ${settings.byline}</div>`;
  if(settings.showCount)html+=`<div class="ss-title-sub" style="margin-top:0.75rem">${album.assets.length} PHOTOS</div>`;
  content.innerHTML=html;
  card.style.display='flex';
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  card.style.opacity='1';
  await new Promise(r=>setTimeout(r,3500));
  card.style.opacity='0';
  await new Promise(r=>setTimeout(r,1000));
  card.style.display='none';
}

function stopMusic(){
  if(ssAudioFade){clearInterval(ssAudioFade);ssAudioFade=null;}
  if(ssAudio){
    ssAudio.pause();
    ssAudio.src=''; // release resource so iOS bfcache can't keep it playing
    ssAudio.load();
    ssAudio=null;
  }
}
function startMusic(){
  const settings=album.slideshowSettings||{};
  stopMusic();
  if(!settings.musicFile)return;
  if(_bc) _bc.postMessage('stop'); // tell other tabs to stop their music
  const audio=new Audio('/api/albums/music/'+encodeURIComponent(settings.musicFile));
  ssAudio=audio;
  audio.loop=true;audio.volume=0;
  audio.play().catch(()=>{});
  let vol=0;
  ssAudioFade=setInterval(()=>{
    if(ssAudio!==audio){clearInterval(ssAudioFade);ssAudioFade=null;return;}
    vol=Math.min(vol+0.05,0.8);audio.volume=vol;
    if(vol>=0.8){clearInterval(ssAudioFade);ssAudioFade=null;}
  },100);
}

function cancelSlideCleanup(){
  ssCleanupTimers.forEach(t=>clearTimeout(t));
  ssCleanupTimers=[];
  // Hide the inactive slot cleanly without touching the visible one
  const inactiveSlot = ssActiveSlot === 'a' ? 'b' : 'a';
  const inactiveEl = document.getElementById('ss-slide-' + inactiveSlot);
  if (inactiveEl) { inactiveEl.classList.remove('ss-visible'); inactiveEl.innerHTML=''; inactiveEl.style.zIndex=1; }
}

function showKBSlide(idx){
  ssIndex=idx;
  const id=album.assets[idx];
  document.getElementById('ss-counter').textContent=(idx+1)+' / '+album.assets.length;
  const desc=document.getElementById('ss-description');
  if(assetMeta[id]){desc.textContent=assetMeta[id].description||'';}
  else{
    desc.textContent='';
    fetch('/api/public/photo/'+id).then(r=>r.json()).then(m=>{
      assetMeta[id]=m;
      if(ssIndex===idx)desc.textContent=m.description||'';
    }).catch(()=>{});
  }
  const move=KB[idx%KB.length];
  const ns=ssActiveSlot==='a'?'b':'a';
  const cur=document.getElementById('ss-slide-'+ssActiveSlot);
  const nxt=document.getElementById('ss-slide-'+ns);
  nxt.innerHTML=`<div class="ss-bg" style="background-image:url('/api/public/thumb/${id}')"></div><img class="ss-img" src="/api/public/original/${id}">`;
  nxt.style.zIndex=1;nxt.classList.remove('ss-visible');
  const img=nxt.querySelector('.ss-img');
  const show=()=>{
    img.style.setProperty('--kb-start',move.s);
    img.style.setProperty('--kb-end',move.e);
    nxt.style.zIndex=3;void nxt.offsetWidth;nxt.classList.add('ss-visible');
    const t1=setTimeout(()=>{cur.classList.remove('ss-visible');},1500);
    const t2=setTimeout(()=>{cur.innerHTML='';cur.style.zIndex=1;ssActiveSlot=ns;ssCleanupTimers=ssCleanupTimers.filter(t=>t!==t1&&t!==t2);},3500);
    ssCleanupTimers.push(t1,t2);
  };
  if(img.complete)show();else img.onload=show;
  new Image().src='/api/public/original/'+album.assets[(idx+1)%album.assets.length];
}

function scheduleNext(){clearTimeout(ssTimer);if(!ssPausedState)ssTimer=setTimeout(ssNext,7000);}
function ssNext(){cancelSlideCleanup();showKBSlide((ssIndex+1)%album.assets.length);scheduleNext();}
function ssPrev(){cancelSlideCleanup();showKBSlide((ssIndex-1+album.assets.length)%album.assets.length);scheduleNext();}
function ssToggle(){
  ssPausedState=!ssPausedState;
  document.getElementById('ss-pause').textContent=ssPausedState?'▶':'❚❚';
  if(!ssPausedState){
    if(ssAudio)ssAudio.play().catch(()=>{});
    ssNext();
  } else {
    clearTimeout(ssTimer);
    if(ssAudio)ssAudio.pause();
  }
}
function ssToggleDesc(){
  ssDescVisible=!ssDescVisible;
  const desc=document.getElementById('ss-description');
  const btn=document.getElementById('ss-desc-btn');
  if(desc)desc.style.opacity=ssDescVisible?'1':'0';
  if(btn)btn.style.color=ssDescVisible?'var(--safe)':'';
}
function ssToggleMusic(){
  const btn=document.getElementById('ss-music-btn');
  if(ssAudio){
    if(ssAudio.paused){ssAudio.play();if(btn)btn.style.color='';}
    else{ssAudio.pause();if(btn)btn.style.color='var(--text-dim)';}
  }
}
function ssClose(){
  clearTimeout(ssTimer);cancelSlideCleanup();
  document.getElementById('ss-overlay').classList.remove('active');
  const card=document.getElementById('ss-title-card');
  if(card){card.style.opacity='0';card.style.display='none';}
  stopMusic();
}
function iosFallbackFullscreen(){
  const dest = window.location.href.replace(/[?&]embed/g, '') + '?autoplay';
  ssClose();
  window.location.href = dest; // navigate iframe → ?autoplay → escalates to top frame
}
function ssFullscreen(){
  const el = document.getElementById('ss-overlay');
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;

  if (isFullscreen) {
    exit.call(document);
    document.getElementById('ss-fs-btn').textContent = '⤢';
    return;
  }

  if (req) {
    req.call(el).then(() => {
      document.getElementById('ss-fs-btn').textContent = '⤡';
    }).catch(() => {
      // API exists but failed (e.g. cross-origin iframe without permission) — fall back to navigation
      iosFallbackFullscreen();
    });
  } else {
    iosFallbackFullscreen();
  }
}
['fullscreenchange','webkitfullscreenchange'].forEach(ev => document.addEventListener(ev, () => {
  const btn = document.getElementById('ss-fs-btn');
  if (btn) btn.textContent = (document.fullscreenElement || document.webkitFullscreenElement) ? '⤡' : '⤢';
}));
function showSSControls(){
  ['ss-controls','ss-counter'].forEach(id=>{const e=document.getElementById(id);if(e)e.classList.remove('ss-hidden');});
  clearTimeout(ssHideTimer);
  ssHideTimer=setTimeout(()=>{
    ['ss-controls','ss-counter'].forEach(id=>{const e=document.getElementById(id);if(e)e.classList.add('ss-hidden');});
  },3000);
}
document.addEventListener('mousemove', () => {
  if(document.getElementById('ss-overlay')?.classList.contains('active')) showSSControls();
});

// Stop music when page is navigated away or put into bfcache (iOS back-swipe restore)
window.addEventListener('pagehide', () => stopMusic());
window.addEventListener('pageshow', e => { if (e.persisted) stopMusic(); });

document.addEventListener('keydown',e=>{
  if(!document.getElementById('ss-overlay').classList.contains('active'))return;
  if(e.key==='ArrowRight')ssNext();
  if(e.key==='ArrowLeft')ssPrev();
  if(e.key===' '){e.preventDefault();ssToggle();}
  if(e.key==='Escape')ssClose();
});
let tx=null;
document.addEventListener('touchstart',e=>{if(document.getElementById('ss-overlay').classList.contains('active'))tx=e.touches[0].clientX;},{passive:true});
document.addEventListener('touchend',e=>{if(!tx)return;const dx=e.changedTouches[0].clientX-tx;if(Math.abs(dx)>50)dx<0?ssNext():ssPrev();tx=null;},{passive:true});

const isEmbed = location.search.includes('embed');
if (isEmbed) {
  document.querySelector('.header').style.display = 'none';
  document.querySelector('.toolbar').style.display = 'none';
  // Hide fullscreen button on touch-primary devices (phones/tablets) — not reliable in cross-origin iframes on iOS
  if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) {
    const fsBtn = document.getElementById('ss-fs-btn');
    if (fsBtn) fsBtn.style.display = 'none';
  }
}
// Wire all event listeners
function wireAlbumListeners() {
  const w = (id, evt, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(evt, fn); };
  w('btn-slideshow', 'click', () => startSlideshow());
  w('embed-hero', 'click', () => startSlideshow());
  // Safari requires explicit click handlers on non-button elements
  const overlay = document.querySelector('.embed-hero-overlay');
  if (overlay) {
    overlay.addEventListener('click', () => startSlideshow());
    overlay.addEventListener('touchend', (e) => { e.preventDefault(); startSlideshow(); });
  }
  const hero = document.getElementById('embed-hero');
  if (hero) {
    hero.addEventListener('click', () => startSlideshow());
    hero.addEventListener('touchend', (e) => { e.preventDefault(); startSlideshow(); });
  }
  w('ss-overlay', 'click', (e) => { if (document.getElementById('ss-overlay').classList.contains('active')) showSSControls(); });
  w('btn-ss-prev', 'click', (e) => { ssPrev(); e.stopPropagation(); });
  w('ss-pause', 'click', (e) => { ssToggle(); e.stopPropagation(); });
  w('ss-desc-btn', 'click', (e) => { ssToggleDesc(); e.stopPropagation(); });
  w('ss-music-btn', 'click', (e) => { ssToggleMusic(); e.stopPropagation(); });
  w('btn-ss-next', 'click', (e) => { ssNext(); e.stopPropagation(); });
  w('ss-fs-btn', 'click', (e) => { ssFullscreen(); e.stopPropagation(); });
  w('btn-ss-close', 'click', (e) => { ssClose(); e.stopPropagation(); });
}

// Delegation for dynamic grid items
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  if (action === 'openSlideshow') openSlideshow(parseInt(el.dataset.idx));
  if (action === 'startSlideshow') startSlideshow();
});

init().then(() => wireAlbumListeners());
