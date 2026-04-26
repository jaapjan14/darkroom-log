const slug=location.pathname.replace('/album/','').replace(/\//g,'');
let album=null,assetMeta={};
let ssActiveSlot='a',ssIndex=0,ssPausedState=false,ssTimer=null,ssHideTimer=null;
let ssAudio=null,ssAudioFade=null,ssDescVisible=true,ssCleanupTimers=[];
let ssZoom={scale:1,tx:0,ty:0}; // pinch-zoom inside the slideshow overlay

// Cross-tab music coordination — stop music in any other darkroom tab when this one takes over
const _bc = (() => { try { return new BroadcastChannel('darkroom-music'); } catch(e) { return null; } })();
if (_bc) _bc.addEventListener('message', e => { if (e.data === 'stop') stopMusic(); });

const KB=[
  {s:'scale(1.08) translate(-3%,-3%)',e:'scale(1.25) translate(2%,2%)'},
  {s:'scale(1.25) translate(3%,2%)',e:'scale(1.08) translate(-2%,-2%)'},
  {s:'scale(1.08) translate(4%,-4%)',e:'scale(1.3) translate(-3%,3%)'},
  {s:'scale(1.3) translate(-4%,3%)',e:'scale(1.08) translate(3%,-2%)'},
  {s:'scale(1.08) translate(0%,-5%)',e:'scale(1.25) translate(0%,3%)'},
  {s:'scale(1.25) translate(0%,4%)',e:'scale(1.08) translate(0%,-3%)'},
];

function isZoomed(){return ssZoom.scale>1.001;}
function applyZoomTransform(){
  const img=document.getElementById('ss-img-'+ssActiveSlot);
  if(!img)return;
  if(isZoomed()){
    img.style.animation='none';
    img.style.transform=`translate(${ssZoom.tx}px,${ssZoom.ty}px) scale(${ssZoom.scale})`;
  } else {
    img.style.transform='';
  }
}
function resetZoom(){
  ssZoom={scale:1,tx:0,ty:0};
  // clear leftover transforms on both slot images
  ['a','b'].forEach(s=>{const im=document.getElementById('ss-img-'+s);if(im)im.style.transform='';});
}
async function init(){
  const r=await fetch('/api/public/album/'+slug);
  if(!r.ok){document.getElementById('photo-grid').innerHTML='<div class="loading" style="grid-column:1/-1">Album not found.</div>';return;}
  album=await r.json();
  document.title=album.title+' — Darkroom Log';
  document.getElementById('album-name').textContent=album.title;
  if (isEmbed) {
    const coverId = album.cover || album.assets[0];
    if (coverId) {
      document.getElementById('embed-hero-img').src = '/api/public/original/' + coverId;
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
    if (!new URLSearchParams(location.search).has('gallery')) openSlideshowPaused(0);
  }
}

function renderGrid(){
  const g=document.getElementById('photo-grid');
  if(!album.assets.length){g.innerHTML='<div class="loading" style="grid-column:1/-1">No photos.</div>';return;}
  g.innerHTML=album.assets.map((id,i)=>`<div class="photo-item" data-action="openPhoto" data-idx="${i}"><img src="/api/public/thumb/${id}" loading="lazy"></div>`).join('');
}

async function openSlideshow(idx){
  resetZoom();
  ssIndex=idx;ssPausedState=false;ssActiveSlot='a';ssDescVisible=true;ssCleanupTimers=[];
  document.getElementById('ss-overlay').classList.add('active');
  startMusic();
  await showTitleCard();
  showKBSlide(idx);
  scheduleNext();
  showSSControls();
}
async function openSlideshowPaused(idx){
  resetZoom();
  ssIndex=idx;ssPausedState=true;ssActiveSlot='a';ssDescVisible=true;ssCleanupTimers=[];
  document.getElementById('ss-overlay').classList.add('active');
  const settings=album.slideshowSettings||{};
  const card=document.getElementById('ss-title-card');
  const content=document.getElementById('ss-title-card-content');
  let html=`<div class="ss-title-main">${album.title}</div>`;
  html+=`<div style="width:60px;height:1px;background:#c8611a;margin:1.5rem auto"></div>`;
  if(settings.byline)html+=`<div class="ss-title-sub">Photography by ${settings.byline}</div>`;
  if(settings.showCount)html+=`<div class="ss-title-sub" style="margin-top:0.75rem">${album.assets.length} PHOTOS</div>`;
  html+=`<button id="ss-play-btn" style="margin-top:2.5rem;width:72px;height:72px;border-radius:50%;background:transparent;border:2px solid #c8611a;color:#c8611a;font-size:26px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding-left:4px;transition:background 0.2s,color 0.2s">▶</button>`;
  content.innerHTML=html;
  card.style.pointerEvents='auto';
  card.style.display='flex';
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  card.style.opacity='1';
  const playBtn=document.getElementById('ss-play-btn');
  playBtn.addEventListener('mouseenter',()=>{playBtn.style.background='#c8611a';playBtn.style.color='#0a0a0a';});
  playBtn.addEventListener('mouseleave',()=>{playBtn.style.background='transparent';playBtn.style.color='#c8611a';});
  playBtn.addEventListener('click',async()=>{
    card.style.opacity='0';
    await new Promise(r=>setTimeout(r,800));
    card.style.display='none';
    card.style.pointerEvents='none';
    ssPausedState=false;
    startMusic();
    showKBSlide(idx);
    scheduleNext();
    showSSControls();
  });
}
function startSlideshow(){openSlideshow(0);}
// Tapping a thumbnail opens the library-style detail view (two-column on desktop,
// stacked on mobile): image on one side, EXIF/description on the other. Tapping
// the image inside detail view enters the pure fullscreen viewer (image only,
// pinch-zoom enabled, no metadata). Slideshow path (▶ on title card / header)
// is independent and unchanged.
function openPhotoView(idx){
  albumDetailOpen(idx);
}

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
  const inactiveSlot = ssActiveSlot === 'a' ? 'b' : 'a';
  const inactiveEl = document.getElementById('ss-slide-' + inactiveSlot);
  if (inactiveEl) { inactiveEl.classList.remove('ss-visible'); inactiveEl.style.zIndex=1; }
}

function prepareSlot(ns, idx){
  const id=album.assets[idx];
  const img=document.getElementById('ss-img-'+ns);
  const bg=document.getElementById('ss-bg-'+ns);
  bg.style.backgroundImage=`url('/api/public/thumb/${id}')`;
  if(!img.src.endsWith('/api/public/original/'+id)){
    img.src='/api/public/original/'+id;
  }
  if(!assetMeta[id]){
    fetch('/api/public/photo/'+id).then(r=>r.json()).then(m=>{assetMeta[id]=m;}).catch(()=>{});
  }
  return img;
}

function showKBSlide(idx){
  resetZoom();
  ssIndex=idx;
  const id=album.assets[idx];
  document.getElementById('ss-counter').textContent=(idx+1)+' / '+album.assets.length;
  const ns=ssActiveSlot==='a'?'b':'a';
  const cur=document.getElementById('ss-slide-'+ssActiveSlot);
  const nxt=document.getElementById('ss-slide-'+ns);
  nxt.classList.remove('ss-visible');
  nxt.style.zIndex=1;
  const img=prepareSlot(ns, idx);
  const show=()=>{
    const desc=document.getElementById('ss-description');
    if(assetMeta[id]){desc.textContent=assetMeta[id].description||'';}
    else desc.textContent='';
    nxt.style.zIndex=3;
    img.style.transform=''; // clear any stale zoom transform
    // Set KB vars here (not prepareSlot) — CSS vars in @keyframes are live, changing them
    // on a running animation causes an immediate position jump.
    const move=KB[idx%KB.length];
    img.style.setProperty('--kb-start',move.s);
    img.style.setProperty('--kb-end',move.e);
    img.style.animation='none';
    void img.offsetWidth;
    img.style.animation='kenburns 14s linear forwards';
    requestAnimationFrame(()=>requestAnimationFrame(()=>nxt.classList.add('ss-visible')));
    if(!ssPausedState) scheduleNext();
    const t1=setTimeout(()=>{cur.classList.remove('ss-visible');},1500);
    const t2=setTimeout(()=>{
      cur.style.zIndex=1;
      ssActiveSlot=ns;
      ssCleanupTimers=ssCleanupTimers.filter(t=>t!==t1&&t!==t2);
      prepareSlot(ns==='a'?'b':'a', (idx+1)%album.assets.length);
    },3500);
    ssCleanupTimers.push(t1,t2);
  };
  if(img.complete && img.naturalWidth>0)show();else{img.onload=show;img.onerror=show;}
}

function scheduleNext(){clearTimeout(ssTimer);if(!ssPausedState)ssTimer=setTimeout(ssNext,7000);}
function ssNext(){cancelSlideCleanup();showKBSlide((ssIndex+1)%album.assets.length);scheduleNext();}
function ssPrev(){cancelSlideCleanup();showKBSlide((ssIndex-1+album.assets.length)%album.assets.length);scheduleNext();}
function ssToggle(){
  ssPausedState=!ssPausedState;
  document.getElementById('ss-pause').textContent=ssPausedState?'▶':'❚❚';
  if(!ssPausedState){
    if(!ssAudio)startMusic();
    else ssAudio.play().catch(()=>{});
    showKBSlide(ssIndex);
    scheduleNext();
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
  clearTimeout(ssTimer);cancelSlideCleanup();resetZoom();
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
// Touch: 1-finger swipe = navigate/close (when not zoomed); 2-finger = pinch-zoom; 1-finger when zoomed = pan
let _swipeX=null,_swipeY=null,_pinch=null,_pan=null;
function _dist(t1,t2){return Math.hypot(t2.clientX-t1.clientX,t2.clientY-t1.clientY);}
document.addEventListener('touchstart',e=>{
  if(!document.getElementById('ss-overlay').classList.contains('active'))return;
  if(e.touches.length>=2){
    _pinch={d:_dist(e.touches[0],e.touches[1]),s:ssZoom.scale,tx:ssZoom.tx,ty:ssZoom.ty};
    _swipeX=_swipeY=null;_pan=null;
  } else if(e.touches.length===1){
    if(isZoomed()){
      _pan={x:e.touches[0].clientX,y:e.touches[0].clientY,tx:ssZoom.tx,ty:ssZoom.ty};
      _swipeX=_swipeY=null;
    } else {
      _swipeX=e.touches[0].clientX;_swipeY=e.touches[0].clientY;
    }
  }
},{passive:true});
document.addEventListener('touchmove',e=>{
  if(_pinch && e.touches.length>=2){
    const d=_dist(e.touches[0],e.touches[1]);
    let s=_pinch.s*(d/_pinch.d);
    s=Math.max(1,Math.min(5,s));
    ssZoom.scale=s;
    if(s<=1.001){ssZoom.tx=0;ssZoom.ty=0;}
    applyZoomTransform();
    e.preventDefault();
  } else if(_pan && e.touches.length===1 && isZoomed()){
    ssZoom.tx=_pan.tx+(e.touches[0].clientX-_pan.x);
    ssZoom.ty=_pan.ty+(e.touches[0].clientY-_pan.y);
    applyZoomTransform();
    e.preventDefault();
  }
},{passive:false});
document.addEventListener('touchend',e=>{
  if(_pinch && e.touches.length<2){
    _pinch=null;
    if(ssZoom.scale<=1.001){resetZoom();}
  }
  if(_pan && e.touches.length===0){_pan=null;}
  if(_swipeX!==null && !isZoomed()){
    const dx=e.changedTouches[0].clientX-_swipeX;
    const dy=e.changedTouches[0].clientY-_swipeY;
    if(dy>70&&Math.abs(dy)>Math.abs(dx)){ssClose();}
    else if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)){dx<0?ssNext():ssPrev();}
  }
  _swipeX=_swipeY=null;
},{passive:true});
// Double-tap to toggle zoom (mobile convenience: 2x in / out)
let _lastTap=0;
document.addEventListener('touchend',e=>{
  if(!document.getElementById('ss-overlay').classList.contains('active'))return;
  if(e.changedTouches.length!==1||e.touches.length!==0)return;
  const now=Date.now();
  if(now-_lastTap<320){
    if(isZoomed()){resetZoom();}
    else{ssZoom={scale:2.5,tx:0,ty:0};applyZoomTransform();}
    _lastTap=0;
  } else {
    _lastTap=now;
  }
},{passive:true});

const isEmbed = location.search.includes('embed');
if (isEmbed) {
  document.querySelector('.header').style.display = 'none';
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
  if (action === 'openPhoto') openPhotoView(parseInt(el.dataset.idx));
  if (action === 'startSlideshow') startSlideshow();
});

// ── ALBUM DETAIL VIEW + FULLSCREEN VIEWER ────────────────────────────────────
// Two layers, mirroring the main app's library experience:
//   1. Detail view (#album-detail-view): two-column on desktop / stacked on mobile.
//      Image on one side, EXIF table (description + library-style rows) on the other.
//      Tap a thumbnail in the grid to open. Tap the photo inside to enter fullscreen.
//   2. Fullscreen (#album-fs-overlay): image only, pinch-zoom + pan + double-tap
//      toggle, tap-zone nav, swipe down/center-tap to close. No metadata, no counter —
//      a clean view of the image. Closing returns to the detail view underneath.
// Slideshow path (cross-fade Ken Burns ▶ button) is independent and unchanged.
let albFs = { idx: 0, scale: 1, tx: 0, ty: 0 };
function _albFsIsZoomed(){ return albFs.scale > 1.001; }
function _albFsApplyZoom(){
  const img = document.getElementById('album-fs-img');
  if (!img) return;
  if (_albFsIsZoomed()) img.style.transform = `translate(${albFs.tx}px,${albFs.ty}px) scale(${albFs.scale})`;
  else img.style.transform = '';
}
function _albFsResetZoom(){
  albFs.scale = 1; albFs.tx = 0; albFs.ty = 0;
  _albFsApplyZoom();
}
function albumFsOpen(idx){
  if (!album || !album.assets) return;
  albFs.idx = idx;
  _albFsResetZoom();
  document.getElementById('album-fs-img').src = '/api/public/original/' + album.assets[idx];
  document.getElementById('album-fs-overlay').classList.add('active');
}
function albumFsClose(){
  _albFsResetZoom();
  document.getElementById('album-fs-overlay').classList.remove('active');
}
function albumFsNavigate(dir){
  if (!album || !album.assets || !album.assets.length) return;
  albFs.idx = (albFs.idx + dir + album.assets.length) % album.assets.length;
  _albFsResetZoom();
  document.getElementById('album-fs-img').src = '/api/public/original/' + album.assets[albFs.idx];
  // Keep the detail view in sync so closing fullscreen lands on the right photo.
  _albDetailRender(albFs.idx);
}

// ── Detail view ─────────────────────────────────────────────────────────────
function _albFmtShutter(s){
  if (s === '' || s == null) return '';
  const str = String(s);
  if (str.includes('/')) return str + 's';
  const f = parseFloat(str);
  if (!isFinite(f) || f <= 0) return '';
  if (f >= 1) return f + 's';
  return '1/' + Math.round(1 / f) + 's';
}
function _albFmtDate(iso){
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
function _albFmtTime(iso){
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}
function albumDetailOpen(idx){
  if (!album || !album.assets) return;
  albFs.idx = idx;
  document.getElementById('album-detail-view').classList.add('active');
  _albDetailRender(idx);
}
function albumDetailClose(){
  document.getElementById('album-detail-view').classList.remove('active');
}
function albumDetailNavigate(dir){
  if (!album || !album.assets || !album.assets.length) return;
  albFs.idx = (albFs.idx + dir + album.assets.length) % album.assets.length;
  _albDetailRender(albFs.idx);
}
async function _albDetailRender(forIdx){
  const id = album.assets[forIdx];
  const total = album.assets.length;
  // Reset stale UI immediately so the prior photo's data doesn't linger
  const img = document.getElementById('album-detail-image');
  const descEl = document.getElementById('album-detail-desc');
  const tableEl = document.getElementById('album-exif-table');
  const counterEl = document.getElementById('album-detail-counter');
  if (img) img.src = '/api/public/original/' + id;
  if (descEl) descEl.textContent = '';
  if (tableEl) tableEl.innerHTML = '';
  if (counterEl) counterEl.textContent = (forIdx + 1) + ' / ' + total;
  let m = assetMeta[id];
  if (!m) {
    try {
      const r = await fetch('/api/public/photo/' + id);
      m = await r.json();
      assetMeta[id] = m;
    } catch(e) { m = {}; }
  }
  if (albFs.idx !== forIdx) return; // user navigated away while fetch was in flight
  const exposure = [
    _albFmtShutter(m.shutterSpeed),
    m.fNumber ? 'f/' + m.fNumber : '',
    m.iso ? 'ISO ' + m.iso : '',
    m.focalLength ? Math.round(parseFloat(m.focalLength)) + 'mm' : ''
  ].filter(Boolean).join('  ·  ');
  const dateStr = _albFmtDate(m.takenAt);
  const timeStr = _albFmtTime(m.takenAt);
  const camera = [m.make, m.model].filter(Boolean).join(' ').trim();
  const location = [m.city, m.state].filter(Boolean).join(', ');
  // Library-style EXIF rows: only render rows that have data.
  const row = (icon, label, value, sub) => `
    <div class="album-exif-row">
      <div class="album-exif-icon">${icon}</div>
      <div class="album-exif-label">${label}</div>
      <div class="album-exif-value">${value}${sub ? `<div class="album-exif-sub">${sub}</div>` : ''}</div>
    </div>`;
  const rows = [];
  if (dateStr) rows.push(row('📅', 'Date', dateStr, timeStr));
  if (camera) rows.push(row('📷', 'Camera', camera, exposure || ''));
  if (m.lens) rows.push(row('🔭', 'Lens', m.lens, ''));
  if (location) rows.push(row('📍', 'Location', location, m.country || ''));
  if (descEl) descEl.textContent = m.description || '';
  if (tableEl) tableEl.innerHTML = rows.join('');
}
function _albDetailActive(){ return document.getElementById('album-detail-view')?.classList.contains('active'); }
function _albFsActive(){ return document.getElementById('album-fs-overlay')?.classList.contains('active'); }
(function wireAlbumFs(){
  const el = document.getElementById('album-fs-overlay');
  if (!el) return;
  let swipeX = null, swipeY = null, didSwipe = false;
  let pinch = null, pan = null, lastTap = 0;
  const dist = (t1, t2) => Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  el.addEventListener('touchstart', e => {
    didSwipe = false;
    if (e.touches.length >= 2) {
      pinch = { d: dist(e.touches[0], e.touches[1]), s: albFs.scale, tx: albFs.tx, ty: albFs.ty };
      swipeX = swipeY = null; pan = null;
    } else if (e.touches.length === 1) {
      if (_albFsIsZoomed()) {
        pan = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx: albFs.tx, ty: albFs.ty };
        swipeX = swipeY = null;
      } else {
        swipeX = e.touches[0].clientX;
        swipeY = e.touches[0].clientY;
      }
    }
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (pinch && e.touches.length >= 2) {
      const d = dist(e.touches[0], e.touches[1]);
      let s = pinch.s * (d / pinch.d);
      s = Math.max(1, Math.min(5, s));
      albFs.scale = s;
      if (s <= 1.001) { albFs.tx = 0; albFs.ty = 0; }
      _albFsApplyZoom();
      e.preventDefault();
    } else if (pan && e.touches.length === 1 && _albFsIsZoomed()) {
      albFs.tx = pan.tx + (e.touches[0].clientX - pan.x);
      albFs.ty = pan.ty + (e.touches[0].clientY - pan.y);
      _albFsApplyZoom();
      e.preventDefault();
    }
  }, { passive: false });
  el.addEventListener('touchend', e => {
    if (pinch && e.touches.length < 2) {
      pinch = null;
      if (albFs.scale <= 1.001) _albFsResetZoom();
      didSwipe = true;
    }
    if (pan && e.touches.length === 0) { pan = null; didSwipe = true; }
    if (swipeX !== null && !_albFsIsZoomed()) {
      const dx = e.changedTouches[0].clientX - swipeX;
      const dy = e.changedTouches[0].clientY - swipeY;
      if (Math.abs(dx) > 40 && Math.abs(dy) < 60) {
        didSwipe = true;
        dx < 0 ? albumFsNavigate(1) : albumFsNavigate(-1);
      } else if (dy > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) {
        didSwipe = true;
        albumFsClose();
      }
    }
    swipeX = swipeY = null;
    if (e.changedTouches.length === 1 && e.touches.length === 0 && !pinch && !pan) {
      const now = Date.now();
      if (now - lastTap < 320) {
        if (_albFsIsZoomed()) _albFsResetZoom();
        else { albFs.scale = 2.5; albFs.tx = 0; albFs.ty = 0; _albFsApplyZoom(); }
        didSwipe = true;
        lastTap = 0;
      } else {
        lastTap = now;
      }
    }
  }, { passive: true });
  el.addEventListener('click', e => {
    if (didSwipe) { didSwipe = false; return; }
    if (e.target.closest('#album-fs-close')) return;
    if (_albFsIsZoomed()) return;
    const xPos = e.clientX;
    const vw = window.innerWidth;
    if (xPos < vw * 0.25) albumFsNavigate(-1);
    else if (xPos > vw * 0.75) albumFsNavigate(1);
    else albumFsClose();
  });
  el.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    albFs.scale = Math.max(1, Math.min(5, albFs.scale * factor));
    if (albFs.scale <= 1.001) _albFsResetZoom();
    else _albFsApplyZoom();
  }, { passive: false });
  document.getElementById('album-fs-close')?.addEventListener('click', e => {
    e.stopPropagation();
    albumFsClose();
  });
})();
document.addEventListener('keydown', e => {
  if (_albFsActive()) {
    if (e.key === 'ArrowRight') albumFsNavigate(1);
    else if (e.key === 'ArrowLeft') albumFsNavigate(-1);
    else if (e.key === 'Escape') albumFsClose();
    return;
  }
  if (_albDetailActive()) {
    if (e.key === 'ArrowRight') albumDetailNavigate(1);
    else if (e.key === 'ArrowLeft') albumDetailNavigate(-1);
    else if (e.key === 'Escape') albumDetailClose();
  }
});

// ── Wire detail view ────────────────────────────────────────────────────────
(function wireAlbumDetail(){
  const view = document.getElementById('album-detail-view');
  if (!view) return;
  document.getElementById('album-detail-back')?.addEventListener('click', albumDetailClose);
  document.getElementById('album-detail-prev')?.addEventListener('click', () => albumDetailNavigate(-1));
  document.getElementById('album-detail-next')?.addEventListener('click', () => albumDetailNavigate(1));
  // Tap the image area → enter pure fullscreen at the current photo
  document.getElementById('album-detail-left')?.addEventListener('click', () => albumFsOpen(albFs.idx));
  // Touch nav: 1-finger horizontal swipe on the image area = prev/next, swipe down = back to grid.
  // Tap (no swipe) on the image still falls through to the click handler above (→ fullscreen).
  const left = document.getElementById('album-detail-left');
  if (left) {
    let sx = null, sy = null, didSwipe = false;
    left.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) { sx = sy = null; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      didSwipe = false;
    }, { passive: true });
    left.addEventListener('touchend', e => {
      if (sx === null) return;
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        didSwipe = true;
        dx < 0 ? albumDetailNavigate(1) : albumDetailNavigate(-1);
      } else if (dy > 80 && Math.abs(dy) > Math.abs(dx) * 1.5) {
        didSwipe = true;
        albumDetailClose();
      }
      sx = sy = null;
    }, { passive: true });
    // Suppress the synthetic click that follows a swipe so we don't accidentally enter fullscreen
    left.addEventListener('click', e => { if (didSwipe) { e.stopPropagation(); didSwipe = false; } }, true);
  }
  // Trackpad two-finger swipe up (over the image area) → back to grid. Mirrors the
  // library detail-view gesture in app.js. Only fires when detail is active and
  // fullscreen overlay is not on top.
  let _wheelAccum = 0;
  document.addEventListener('wheel', e => {
    if (!_albDetailActive() || _albFsActive()) { _wheelAccum = 0; return; }
    const leftEl = document.getElementById('album-detail-left');
    if (leftEl && leftEl.contains(e.target)) {
      _wheelAccum += e.deltaY;
      if (_wheelAccum < -80 && Math.abs(e.deltaX) < 40) {
        _wheelAccum = 0;
        albumDetailClose();
      }
    } else {
      _wheelAccum = 0;
    }
  }, { passive: true });
})();

init().then(() => wireAlbumListeners());
