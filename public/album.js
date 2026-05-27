const slug=location.pathname.replace('/album/','').replace(/\//g,'');
let album=null,assetMeta={};
let ssActiveSlot='a',ssIndex=0,ssPausedState=false,ssTimer=null,ssHideTimer=null;
let ssDescVisible=true,ssCleanupTimers=[];
// Beat-preset state — tracks last-scheduled beat + pattern position so each
// scheduleNext call steps cleanly instead of recomputing from a moving
// musicSec reference (variable image load times caused inconsistent snaps).
let ssBeatIdx=null,ssBeatPtnIdx=null,ssSlidesShown=0;
let ssZoom={scale:1,tx:0,ty:0}; // pinch-zoom inside the slideshow overlay
let _embedExpanded=false; // true when the parent page has expanded our iframe in-place via postMessage

// Adaptive image sizing for the slideshow body. Slideshow uses
// /api/public/display/:id?w=<ssDisplayWidth>, which server.js downscales via
// sharp. Originals (full 6800+px) are reserved for lightbox/zoom and the
// /api/public/original/:id route. Width picked at startup from the Network
// Information API where available; then narrowed by measuring actual load
// times on the first few slides (works on all browsers including iOS Safari,
// which doesn't expose navigator.connection).
let ssDisplayWidth=1920;
let ssSlowLoadCount=0;
function _pickInitialDisplayWidth(){
  try{
    const c=navigator.connection;
    if(!c)return 1920;
    if(c.saveData)return 960;
    const et=c.effectiveType||'';
    if(et==='slow-2g'||et==='2g')return 960;
    if(et==='3g')return 1280;
    if(typeof c.downlink==='number'&&c.downlink<1.5)return 1280;
    return 1920;
  }catch(e){return 1920;}
}
function _measureAndAdapt(ms){
  // Slow load = downgrade after two consecutive slow slides. Fast load = decay
  // the counter so a brief stall doesn't permanently lock us at low res.
  if(ms>3500){
    ssSlowLoadCount++;
    if(ssSlowLoadCount>=2&&ssDisplayWidth>960){
      const prev=ssDisplayWidth;
      ssDisplayWidth=(ssDisplayWidth>=1920)?1280:960;
      ssSlowLoadCount=0;
      console.log('[ss] adaptive downgrade '+prev+' → '+ssDisplayWidth+' (last load '+Math.round(ms)+'ms)');
    }
  }else if(ms<800){
    ssSlowLoadCount=Math.max(0,ssSlowLoadCount-1);
  }
}

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
// No-motion pose for non-Ken-Burns presets (Quick uses this).
const KB_NONE=[{s:'scale(1) translate(0,0)',e:'scale(1) translate(0,0)'}];

async function init(){
  ssDisplayWidth=_pickInitialDisplayWidth();
  const r=await fetch('/api/public/album/'+slug);
  if(!r.ok){document.getElementById('photo-grid').innerHTML='<div class="loading" style="grid-column:1/-1">Album not found.</div>';return;}
  album=await r.json();
  document.title=album.title+' — Darkroom Log';
  document.getElementById('album-name').textContent=album.title;
  // Pre-decode the music track in the background so when the visitor clicks
  // Slideshow, playback starts instantly (decode takes 1–3s). For beat-driven
  // presets also run beat analysis on the buffer so the scheduler has the
  // beats array ready by the time the slideshow starts.
  if (window.DarkroomAudio && album.slideshowSettings && album.slideshowSettings.musicFile) {
    try {
      DarkroomAudio.ensureCtx();
      const file = album.slideshowSettings.musicFile;
      DarkroomAudio.loadTrack(file).catch(() => {});
      const preset = album.slideshowSettings.preset;
      if (preset === 'beat' || preset === 'beatfade') {
        DarkroomAudio.analyzeTrack(file).catch(() => {});
      }
    } catch(e) {}
  }
  if (isEmbed) {
    const coverId = album.cover || album.assets[0];
    if (coverId) {
      document.getElementById('embed-hero-img').src = '/api/public/original/' + coverId;
      document.getElementById('embed-hero-title').textContent = album.title;
      document.getElementById('embed-hero').style.display = 'block';
      document.getElementById('photo-grid').style.display = 'none';
    }
  } else {
    const params = new URLSearchParams(location.search);
    // If a fullscreen-only mode landed inside an iframe, escalate to top.
    if (params.has('fs') && window !== window.top) {
      try { window.top.location.href = window.location.href; } catch(e) {}
      return;
    }
    if (params.has('fs')) {
      // Slideshow-only mode — used by the embed's ⤢ button. No grid rendered;
      // closing the slideshow returns the user to where they came from
      // (history.back to the article, or window.close for popup-opened tabs).
      document.body.classList.add('fs-mode');
      // iOS Safari rejects audio.play() after a tab navigation because the
      // user-gesture token doesn't carry across page loads. Hook the first
      // touch/click to retry — silent slideshow until the user interacts.
      const resumeMusic = () => {
        // After a tab navigation iOS Safari may have suspended the
        // AudioContext; the first user interaction lets us resume it.
        if (window.DarkroomAudio) {
          try {
            DarkroomAudio.ensureCtx();
            if (!DarkroomAudio.isMusicPlaying() && album?.slideshowSettings?.musicFile) {
              DarkroomAudio.playMusic(album.slideshowSettings.musicFile, { fadeMs: 300, loop: true, volume: 0.85 });
            }
          } catch(e) {}
        }
      };
      document.addEventListener('touchstart', resumeMusic, { once: true, capture: true });
      document.addEventListener('click', resumeMusic, { once: true, capture: true });
      openSlideshow(0);
      return;
    }
    renderGrid();
    if (!params.has('gallery')) openSlideshowPaused(0);
  }
}

function renderGrid(){
  const g=document.getElementById('photo-grid');
  if(!album.assets.length){g.innerHTML='<div class="loading" style="grid-column:1/-1">No photos.</div>';return;}
  g.innerHTML=album.assets.map((id,i)=>`<div class="photo-item" data-action="openPhoto" data-idx="${i}"><img src="/api/public/thumb/${id}?size=thumbnail" loading="lazy" decoding="async" width="300" height="300"></div>`).join('');
}

async function openSlideshow(idx){
  resetZoom();
  ssIndex=idx;ssPausedState=false;ssActiveSlot='a';ssDescVisible=true;ssCleanupTimers=[];
  document.getElementById('ss-overlay').classList.add('active');
  startMusic();
  // Reset beat-preset state; showKBSlide's image-load callback calls
  // scheduleNext (single source of truth — explicit calls here would cause
  // double-scheduling and inconsistent timing).
  ssBeatIdx=null;ssBeatPtnIdx=null;ssSlidesShown=1;
  await showTitleCard();
  showKBSlide(idx);
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
    // Try entering native fullscreen NOW — while the user-gesture
    // activation token from this tap is still live. Desktop + Android
    // Chrome both honor it. iOS Safari rejects fullscreen on <div>
    // elements, so the call no-ops there — but the slideshow overlay
    // is already position:fixed inset:0 so the visual result is close
    // enough. Don't navigate away on failure (the iosFallbackFullscreen
    // path is for explicit ⤢ taps, not the play button).
    // Only auto-fullscreen on touch-primary devices (phones, tablets). On
    // desktop, leave the user in a browser tab — they can use the ⤢ button
    // if they want fullscreen.
    if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) {
      try {
        const overlay = document.getElementById('ss-overlay');
        const req = overlay.requestFullscreen || overlay.webkitRequestFullscreen;
        if (req) { const p = req.call(overlay); if (p && p.catch) p.catch(()=>{}); }
      } catch(e) { /* iOS Safari / cross-origin iframe — ignore */ }
    }

    card.style.opacity='0';
    await new Promise(r=>setTimeout(r,800));
    card.style.display='none';
    card.style.pointerEvents='none';
    ssPausedState=false;
    startMusic();
    ssBeatIdx=null;ssBeatPtnIdx=null;ssSlidesShown=1;
    showKBSlide(idx);
    showSSControls();
  });
}
function startSlideshow(){
  // Re-entry guard: the embed-hero has 4 stacked click handlers (overlay click,
  // hero click via w() + via direct addEventListener, document data-action delegator)
  // so a single tap fires startSlideshow 4 times. Without this guard each call
  // re-runs openSlideshow → re-calls scheduleNext with a stale ssBeatIdx that
  // increments by 16 each time, scheduling slide 2 to fire ~31s out instead of ~7s.
  // openSlideshow adds .active to #ss-overlay synchronously on its first line,
  // so calls #2/#3/#4 see it and bail. Standalone (non-embed) path is unaffected
  // because openSlideshowPaused's title-card play button has only one handler.
  if(document.getElementById('ss-overlay').classList.contains('active')) return;
  openSlideshow(0);
}
// Tapping a thumbnail opens the library-style detail view (two-column on desktop,
// stacked on mobile): image on one side, EXIF/description on the other. Tapping
// the image inside detail view enters the pure fullscreen viewer (image only,
// pinch-zoom enabled, no metadata). Slideshow path (▶ on title card / header)
// is independent and unchanged.
function openPhotoView(idx){
  albumDetailOpen(idx);
}

// Compute album date range from photo takenAt values. Uses assetMeta cache
// when available, lazy-fetches missing entries via the public photo endpoint.
async function _computeAlbumDateRange(){
  if(!album||!album.assets||!album.assets.length) return '';
  const fetches=album.assets.map(id=>{
    const cached=assetMeta[id];
    if(cached&&cached.takenAt) return Promise.resolve(cached.takenAt);
    return fetch('/api/public/photo/'+id)
      .then(r=>r.json())
      .then(m=>{
        if(!assetMeta[id])assetMeta[id]={};
        assetMeta[id].takenAt=m.takenAt||'';
        assetMeta[id].title=m.title||'';
        assetMeta[id].description=m.description||'';
        return m.takenAt||'';
      })
      .catch(()=>'');
  });
  const taken=await Promise.all(fetches);
  const dates=taken.filter(Boolean).map(s=>new Date(s)).filter(d=>!isNaN(d.getTime()));
  if(!dates.length) return '';
  dates.sort((a,b)=>a-b);
  return _formatDateRange(dates[0],dates[dates.length-1]);
}

function _formatDateRange(d1,d2){
  const month=d=>d.toLocaleString('en-US',{month:'short'});
  const year=d=>d.getFullYear();
  if(d1.toDateString()===d2.toDateString()) return `${month(d1)} ${d1.getDate()}, ${year(d1)}`;
  if(year(d1)===year(d2)&&d1.getMonth()===d2.getMonth()) return `${month(d1)} ${year(d1)}`;
  if(year(d1)===year(d2)) return `${month(d1)} — ${month(d2)} ${year(d1)}`;
  return `${month(d1)} ${year(d1)} — ${month(d2)} ${year(d2)}`;
}

async function showTitleCard(){
  const settings=album.slideshowSettings||{};
  if(!settings.showTitle)return;
  // Resolve the date range string before rendering — manual override or
  // auto-computed from photo takenAt. Capped at 2s so a slow Immich call
  // can't delay the slideshow indefinitely.
  let dateRangeStr='';
  if(settings.showDates){
    if(settings.dateRange){
      dateRangeStr=settings.dateRange;
    } else {
      try {
        dateRangeStr=await Promise.race([
          _computeAlbumDateRange(),
          new Promise(res=>setTimeout(()=>res(''),2000))
        ]);
      } catch(e){ dateRangeStr=''; }
    }
  }
  const card=document.getElementById('ss-title-card');
  const content=document.getElementById('ss-title-card-content');
  let html=`<div class="ss-title-main">${album.title}</div>`;
  html+=`<div style="width:60px;height:1px;background:#c8611a;margin:1.5rem auto"></div>`;
  if(settings.byline)html+=`<div class="ss-title-sub">Photography by ${settings.byline}</div>`;
  if(settings.showLocation&&settings.location)html+=`<div class="ss-title-sub" style="margin-top:0.5rem">${settings.location}</div>`;
  if(settings.showDates&&dateRangeStr)html+=`<div class="ss-title-sub" style="margin-top:0.5rem">${dateRangeStr}</div>`;
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

// Music — routed through DarkroomAudio (Web Audio engine). Gives a
// sample-accurate music clock that beat-locked scheduling can reference.
// Pre-decode happens at album load, so playMusic here is near-instant.
function stopMusic(){
  if (window.DarkroomAudio) DarkroomAudio.stopMusic({ fadeMs: 800 });
}
function startMusic(){
  const settings=album.slideshowSettings||{};
  if(!settings.musicFile)return;
  if(_bc) _bc.postMessage('stop'); // tell other tabs to stop their music
  if (!window.DarkroomAudio) return;
  DarkroomAudio.ensureCtx();
  DarkroomAudio.playMusic(settings.musicFile, {
    fadeMs: 1600,
    loop: true,
    volume: 0.85,
  }).catch(e => console.warn('music start failed:', e));
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
  // Slideshow body uses the display variant (server-resized via sharp). Width
  // is adaptive (ssDisplayWidth). Track per-asset so a width change mid-album
  // doesn't re-trigger an in-flight load for the same id.
  if(img.dataset.loadedId!==id){
    img.dataset.loadedId=id;
    img._loadStart=performance.now();
    // One-shot performance listener (separate from preset show() onload/onerror
    // handlers so we don't fight over the handler property).
    const onMeasure=()=>{
      img.removeEventListener('load',onMeasure);
      if(img._loadStart){
        _measureAndAdapt(performance.now()-img._loadStart);
        img._loadStart=null;
      }
    };
    img.addEventListener('load',onMeasure);
    // Filename form (not ?w=) so Cloudflare edge-caches by extension.
    img.src=`/api/public/display/${id}-${ssDisplayWidth}.jpg`;
  }
  if(!assetMeta[id]){
    fetch('/api/public/photo/'+id).then(r=>r.json()).then(m=>{assetMeta[id]=m;}).catch(()=>{});
  }
  return img;
}

// Hidden image preload for look-ahead slides (N+2, N+3). Browser HTTP cache
// keeps the result so the real prepareSlot() call doesn't re-fetch. Tolerates
// errors silently — this is opportunistic only.
function _preloadAhead(idx){
  if(!album||!album.assets||!album.assets.length)return;
  for(const off of [2,3]){
    const k=(idx+off)%album.assets.length;
    const id=album.assets[k];
    if(!id)continue;
    const pre=new Image();
    pre.src=`/api/public/display/${id}-${ssDisplayWidth}.jpg`;
  }
}

// Attach load/error handlers for a slide image with a graceful fallback chain.
// Replaces the old `img.onerror=show` pattern that transitioned to a broken
// <img> on network failure (cause of the "black slide" reports on poor wifi).
// On load failure: swap to the thumbnail proxy URL (smaller, more likely to
// succeed). If the thumb also fails, show() anyway — the slot's background-
// image is the last-resort thumb fallback already painted by prepareSlot.
function _attachSlideImgHandlers(img, id, show){
  if(img.complete && img.naturalWidth>0){ show(); return; }
  let fellBack=false;
  img.onload=show;
  img.onerror=()=>{
    if(fellBack){ show(); return; }
    fellBack=true;
    img.src='/api/public/thumb/'+id;
  };
}

// Returns the CURRENT slide's hold duration, including the actual
// beat-pattern step for beat/beatfade presets. _slideDurationMs() uses
// only the first step and is wrong mid-pattern.
function _currentSlideHoldMs(){
  const s=(album&&album.slideshowSettings)||{};
  if(s.preset==='quick') return 6000;
  if(s.preset==='beat'||s.preset==='beatfade'){
    const pattern=_parseBeatPattern(s.paceBeatsEvery);
    const ptnIdx=(ssBeatPtnIdx==null)?0:(ssBeatPtnIdx%pattern.length);
    const beats=pattern[ptnIdx];
    const useOverride=s.paceBpmOverrideEnabled===true;
    const override=Number(s.paceBpmOverride);
    const analysis=s.musicFile&&window.DarkroomAudio?DarkroomAudio.getTrackAnalysis(s.musicFile):null;
    let bpm=useOverride&&override>=40?override:(analysis?analysis.bpm:0);
    if(!bpm||!Number.isFinite(bpm)||bpm<40) bpm=60;
    return Math.round(beats*60000/bpm);
  }
  return s.showPhotoTitle===true?12000:7000;
}

// Per-photo overlay (title + description) — shared by all preset render
// paths. Adaptive timing scaled to the actual current slide duration so
// each step in a beat pattern gets appropriate fade timing. Title and
// description fade in lockstep.
function _renderPerPhotoOverlay(id){
  const ssSettings=(album&&album.slideshowSettings)||{};
  const wantTitle=ssSettings.showPhotoTitle===true;
  const wantDesc=ssSettings.showPhotoDescription===true;
  const desc=document.getElementById('ss-description');
  const title=document.getElementById('ss-photo-title');
  const slideDur=_currentSlideHoldMs();
  // Skip overlay on slides too short for a readable fade in/hold/out.
  const overlayTooFast=slideDur<1400;
  // Per-preset image-crossfade duration. Title shouldn't materialize until
  // the image it belongs to is fully shown.
  //   Beat Fade: 700ms; Quick: 1.8s; Classic/Beat/Custom: 1.5s default.
  const imgFadeMs=(ssSettings.preset==='beatfade')?700
                 :(ssSettings.preset==='quick')?1800
                 :1500;
  const baseDelay=imgFadeMs+200;
  let OV_DELAY_MS,OV_FADE_IN_MS,OV_FADE_OUT_MS,OV_FADE_OUT_AT_MS;
  if(slideDur>=6000){
    OV_DELAY_MS=baseDelay+800;
    OV_FADE_IN_MS=1000;
    OV_FADE_OUT_MS=1000;
    OV_FADE_OUT_AT_MS=slideDur-OV_FADE_OUT_MS-200;
  } else if(slideDur>=3500){
    OV_DELAY_MS=baseDelay;
    OV_FADE_IN_MS=600;
    OV_FADE_OUT_MS=600;
    OV_FADE_OUT_AT_MS=slideDur-OV_FADE_OUT_MS-200;
  } else if(slideDur>=2200){
    OV_DELAY_MS=Math.max(500,baseDelay-400);
    OV_FADE_IN_MS=400;
    OV_FADE_OUT_MS=400;
    OV_FADE_OUT_AT_MS=slideDur-OV_FADE_OUT_MS-150;
  } else {
    OV_DELAY_MS=200;
    OV_FADE_IN_MS=300;
    OV_FADE_OUT_MS=300;
    OV_FADE_OUT_AT_MS=slideDur-OV_FADE_OUT_MS-100;
  }
  // Clear in-flight timers from the previous slide.
  if(title&&title._slideTitleTimer){clearTimeout(title._slideTitleTimer);title._slideTitleTimer=null;}
  if(title&&title._slideTitleFadeOutTimer){clearTimeout(title._slideTitleFadeOutTimer);title._slideTitleFadeOutTimer=null;}
  if(desc&&desc._slideDescTimer){clearTimeout(desc._slideDescTimer);desc._slideDescTimer=null;}
  if(desc&&desc._slideDescFadeOutTimer){clearTimeout(desc._slideDescFadeOutTimer);desc._slideDescFadeOutTimer=null;}
  if(title){title.style.transition=`opacity ${OV_FADE_IN_MS}ms ease-in-out`;title.style.opacity='0';}
  if(desc){desc.style.transition=`opacity ${OV_FADE_IN_MS}ms ease-in-out`;desc.style.opacity='0';}

  const applyOverlay=(m)=>{
    if(desc){
      if(wantDesc&&!overlayTooFast&&m&&m.description){
        desc.textContent=m.description;
        desc.style.display='';
        if(desc._slideDescTimer)clearTimeout(desc._slideDescTimer);
        if(desc._slideDescFadeOutTimer)clearTimeout(desc._slideDescFadeOutTimer);
        desc._slideDescTimer=setTimeout(()=>{
          desc.style.transition=`opacity ${OV_FADE_IN_MS}ms ease-in-out`;
          desc.style.opacity='1';
          desc._slideDescTimer=null;
        },OV_DELAY_MS);
        desc._slideDescFadeOutTimer=setTimeout(()=>{
          desc.style.transition=`opacity ${OV_FADE_OUT_MS}ms ease-in-out`;
          desc.style.opacity='0';
          desc._slideDescFadeOutTimer=null;
        },OV_FADE_OUT_AT_MS);
      } else {
        desc.textContent='';
        desc.style.opacity='0';
        desc.style.display=wantDesc?'':'none';
      }
    }
    if(title){
      if(wantTitle&&!overlayTooFast&&m&&m.title){
        title.style.display='block';
        if(title._slideTitleTimer)clearTimeout(title._slideTitleTimer);
        if(title._slideTitleFadeOutTimer)clearTimeout(title._slideTitleFadeOutTimer);
        title._slideTitleTimer=setTimeout(()=>{
          title.textContent=m.title;
          title.style.transition=`opacity ${OV_FADE_IN_MS}ms ease-in-out`;
          title.style.opacity='1';
          title._slideTitleTimer=null;
        },OV_DELAY_MS);
        title._slideTitleFadeOutTimer=setTimeout(()=>{
          title.style.transition=`opacity ${OV_FADE_OUT_MS}ms ease-in-out`;
          title.style.opacity='0';
          title._slideTitleFadeOutTimer=null;
        },OV_FADE_OUT_AT_MS);
      } else {
        title.textContent='';
        title.style.opacity='0';
        title.style.display='none';
      }
    }
  };
  applyOverlay(assetMeta[id]);
  // Closure-capture the slide we're rendering for so the fetch callback
  // doesn't apply stale meta if the user has navigated away.
  const _idxAtFetch=ssIndex;
  const cached=assetMeta[id];
  const needFetch=!cached||(wantTitle&&cached.title===undefined)||(wantDesc&&cached.description===undefined);
  if(needFetch){
    fetch('/api/public/photo/'+id).then(r=>r.json()).then(m=>{
      if(!assetMeta[id])assetMeta[id]={};
      assetMeta[id].description=m.description||'';
      assetMeta[id].title=m.title||'';
      assetMeta[id].takenAt=m.takenAt||assetMeta[id].takenAt||'';
      if(ssIndex===_idxAtFetch) applyOverlay(assetMeta[id]);
    }).catch(()=>{});
  }
}

function showKBSlide(idx, direction){
  // Dispatch to alternative implementation if a non-Classic preset is set.
  const _preset=(album&&album.slideshowSettings&&album.slideshowSettings.preset)||'classic';
  if(_preset==='quick') return showSlideSlide(idx, direction);
  if(_preset==='beatfade') return showSlideBeatFade(idx);
  resetZoom();
  ssIndex=idx;
  const id=album.assets[idx];
  document.getElementById('ss-counter').textContent=(idx+1)+' / '+album.assets.length;
  const ns=ssActiveSlot==='a'?'b':'a';
  const cur=document.getElementById('ss-slide-'+ssActiveSlot);
  const nxt=document.getElementById('ss-slide-'+ns);
  // Clear leftover classes from non-Classic presets (Quick or Beat Fade)
  ['ss-slide-h','ss-slide-h-from-right','ss-slide-h-from-left','ss-exiting-left','ss-exiting-right','ss-fade-quick']
    .forEach(c=>{cur.classList.remove(c);nxt.classList.remove(c);});
  // Adaptive crossfade — default CSS 1.5s is longer than fast pattern
  // steps (e.g. 2 beats @ 94 BPM = 1.28s), causing transitions to stack
  // and look janky. Scale to fit comfortably inside the slide hold time.
  const _kbDur=_currentSlideHoldMs();
  const crossfadeMs=_kbDur<1600?400:_kbDur<3000?800:1500;
  [cur,nxt].forEach(el=>{
    if(el) el.style.transition=`opacity ${crossfadeMs}ms ease-in-out`;
  });
  nxt.classList.remove('ss-visible');
  nxt.style.zIndex=1;
  _renderPerPhotoOverlay(id);
  const img=prepareSlot(ns, idx);
  const show=()=>{
    nxt.style.zIndex=3;
    img.style.transform=''; // clear any stale zoom transform
    const move=KB[idx%KB.length];
    img.style.setProperty('--kb-start',move.s);
    img.style.setProperty('--kb-end',move.e);
    img.style.animation='none';
    void img.offsetWidth;
    img.style.animation='kenburns 14s linear forwards';
    requestAnimationFrame(()=>requestAnimationFrame(()=>nxt.classList.add('ss-visible')));
    if(!ssPausedState) scheduleNext();
    const t1=setTimeout(()=>{cur.classList.remove('ss-visible');},crossfadeMs);
    const t2=setTimeout(()=>{
      cur.style.zIndex=1;
      ssActiveSlot=ns;
      ssCleanupTimers=ssCleanupTimers.filter(t=>t!==t1&&t!==t2);
      prepareSlot(ns==='a'?'b':'a', (idx+1)%album.assets.length);
      _preloadAhead(idx);
    },crossfadeMs*2+500);
    ssCleanupTimers.push(t1,t2);
  };
  _attachSlideImgHandlers(img, id, show);
}

// QUICK preset (slide-horizontal, no Ken Burns). Fully isolated from
// showKBSlide. The Classic code path never enters this function.
function showSlideSlide(idx, direction){
  resetZoom();
  ssIndex=idx;
  const id=album.assets[idx];
  document.getElementById('ss-counter').textContent=(idx+1)+' / '+album.assets.length;
  const ns=ssActiveSlot==='a'?'b':'a';
  const cur=document.getElementById('ss-slide-'+ssActiveSlot);
  const nxt=document.getElementById('ss-slide-'+ns);
  // Clean transition-mode classes off both slots (last preset may have been different)
  ['ss-slide-h','ss-slide-h-from-right','ss-slide-h-from-left','ss-exiting-left','ss-exiting-right']
    .forEach(c=>{cur.classList.remove(c);nxt.classList.remove(c);});
  nxt.classList.remove('ss-visible');
  nxt.style.zIndex=1;
  _renderPerPhotoOverlay(id);
  const img=prepareSlot(ns, idx);
  const show=()=>{
    img.style.animation='none';     // no Ken Burns for Quick
    img.style.transform='';
    const dir=direction==='backward'?'backward':'forward';
    const fromClass=dir==='forward'?'ss-slide-h-from-right':'ss-slide-h-from-left';
    nxt.classList.add('ss-slide-h', fromClass);
    void nxt.offsetWidth;           // force layout so initial position takes effect
    nxt.style.zIndex=3;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      nxt.classList.add('ss-visible');
      const exitClass=dir==='forward'?'ss-exiting-left':'ss-exiting-right';
      cur.classList.add('ss-slide-h', exitClass);
    }));
    if(!ssPausedState) scheduleNext();
    const t2=setTimeout(()=>{
      cur.style.zIndex=1;
      cur.classList.remove('ss-visible');
      ssActiveSlot=ns;
      ssCleanupTimers=ssCleanupTimers.filter(t=>t!==t2);
      prepareSlot(ns==='a'?'b':'a', (idx+1)%album.assets.length);
      _preloadAhead(idx);
    }, 1900);
    ssCleanupTimers.push(t2);
  };
  _attachSlideImgHandlers(img, id, show);
}

// BEAT FADE preset — same beat-aligned scheduler as Beat preset, but no Ken
// Burns motion. Just a 700ms opacity crossfade on each beat-aligned tick.
function showSlideBeatFade(idx){
  resetZoom();
  ssIndex=idx;
  const id=album.assets[idx];
  document.getElementById('ss-counter').textContent=(idx+1)+' / '+album.assets.length;
  const ns=ssActiveSlot==='a'?'b':'a';
  const cur=document.getElementById('ss-slide-'+ssActiveSlot);
  const nxt=document.getElementById('ss-slide-'+ns);
  // Strip any prior preset's classes from both slots, then apply ss-fade-quick
  ['ss-slide-h','ss-slide-h-from-right','ss-slide-h-from-left','ss-exiting-left','ss-exiting-right']
    .forEach(c=>{cur.classList.remove(c);nxt.classList.remove(c);});
  nxt.classList.add('ss-fade-quick');
  cur.classList.add('ss-fade-quick');
  nxt.classList.remove('ss-visible');
  nxt.style.zIndex=1;
  _renderPerPhotoOverlay(id);
  const img=prepareSlot(ns, idx);
  // No ken-burns animation; static image
  img.style.animation='none';
  img.style.transform='';
  const show=()=>{
    nxt.style.zIndex=3;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      nxt.classList.add('ss-visible');
      cur.classList.remove('ss-visible');
    }));
    if(!ssPausedState) scheduleNext();
    // Cleanup timer bumped from 500 → 1500ms so it runs after the fade
    // (now 1400ms via .ss-fade-quick) fully completes.
    const t1=setTimeout(()=>{
      cur.style.zIndex=1;
      ssActiveSlot=ns;
      ssCleanupTimers=ssCleanupTimers.filter(t=>t!==t1);
      // BeatFade was missing the N+1 preload that Classic/Quick already do.
      // Adding it here puts BeatFade on parity for poor-network loading.
      prepareSlot(ns==='a'?'b':'a', (idx+1)%album.assets.length);
      _preloadAhead(idx);
    },1500);
    ssCleanupTimers.push(t1);
  };
  _attachSlideImgHandlers(img, id, show);
}

// Slide hold duration. With per-photo title enabled, use 12s (gives
// time for fade-in + readable hold + fade-out). Otherwise classic 7s.
// paceBeatsEvery is "8" (constant) or comma-separated like "8,4" (pattern).
function _parseBeatPattern(val){
  const arr=String(val??'8').split(',').map(s=>parseInt(s.trim(),10)).filter(n=>Number.isFinite(n)&&n>0&&n<=64);
  return arr.length?arr:[8];
}

function _slideDurationMs(){
  const s=(album&&album.slideshowSettings)||{};
  if(s.preset==='quick') return 6000;
  if(s.preset==='beat'||s.preset==='beatfade'){
    const pattern=_parseBeatPattern(s.paceBeatsEvery);
    const beats=pattern[0];
    const useOverride=s.paceBpmOverrideEnabled===true;
    const override=Number(s.paceBpmOverride);
    const analysis=s.musicFile&&window.DarkroomAudio?DarkroomAudio.getTrackAnalysis(s.musicFile):null;
    const bpm=useOverride&&override>=40?override:(analysis?analysis.bpm:0);
    if(Number.isFinite(bpm)&&bpm>=40) return Math.round(beats*60000/bpm);
  }
  return s.showPhotoTitle===true?12000:7000;
}

// Beat-aligned scheduler — for beat/beatfade presets only. Stateful step
// through detected beats so successive slide changes are exactly N beats
// apart (no inconsistent snap distances from variable image-load delays).
function scheduleNext(){
  clearTimeout(ssTimer);
  if(ssPausedState) return;
  const s=(album&&album.slideshowSettings)||{};
  const dur=_slideDurationMs();
  let delay=dur;
  if((s.preset==='beat'||s.preset==='beatfade')&&window.DarkroomAudio&&DarkroomAudio.isMusicPlaying()){
    const analysis=DarkroomAudio.getTrackAnalysis(s.musicFile);
    const useOverride=s.paceBpmOverrideEnabled===true;
    const override=Number(s.paceBpmOverride);
    const pattern=_parseBeatPattern(s.paceBeatsEvery);
    const ptnIdx=(ssBeatPtnIdx==null)?0:(ssBeatPtnIdx%pattern.length);
    const step=pattern[ptnIdx];
    if(useOverride&&override>=40){
      const beatSec=60/override;
      const musicSec=DarkroomAudio.getMusicTime();
      const phase=(analysis&&analysis.beats&&analysis.beats.length)?(analysis.beats[0]%beatSec):0;
      let target;
      let curPtnIdx=ptnIdx;
      if(ssBeatIdx==null){
        const minDelay=dur*0.001*0.5;
        const k=Math.ceil((musicSec+minDelay-phase)/(pattern[0]*beatSec));
        target=k*pattern[0]*beatSec+phase;
      } else {
        target=ssBeatIdx+step*beatSec;
        // Catch-up: slow image loads can push musicSec past target. Walk
        // forward through the pattern until target is comfortably ahead,
        // otherwise delay=max(50,negative) fires the slide ~instantly.
        while(target<=musicSec+0.1){
          curPtnIdx=(curPtnIdx+1)%pattern.length;
          target+=pattern[curPtnIdx]*beatSec;
        }
      }
      ssBeatIdx=target;
      ssBeatPtnIdx=(curPtnIdx+1)%pattern.length;
      delay=Math.max(50,(target-musicSec)*1000);
    } else if(analysis&&analysis.beats&&analysis.beats.length){
      const musicSec=DarkroomAudio.getMusicTime();
      const arr=analysis.beats;
      let nextIdx;
      let curPtnIdx=ptnIdx;
      if(ssBeatIdx==null){
        const minAheadSec=(dur*0.5)/1000;
        let firstIdx=-1;
        for(let i=0;i<arr.length;i++){if(arr[i]>musicSec+minAheadSec){firstIdx=i;break;}}
        if(firstIdx<0){ssTimer=setTimeout(ssNext,delay);return;}
        nextIdx=Math.ceil(firstIdx/pattern[0])*pattern[0];
      } else {
        nextIdx=ssBeatIdx+step;
        // Catch-up: walk forward through the pattern until we land on a
        // beat that's still in the future, so slides don't slip instantly.
        while(nextIdx<arr.length&&arr[nextIdx]<=musicSec+0.1){
          curPtnIdx=(curPtnIdx+1)%pattern.length;
          nextIdx+=pattern[curPtnIdx];
        }
      }
      const finalIdx=Math.min(arr.length-1,nextIdx);
      const target=arr[finalIdx];
      ssBeatIdx=finalIdx;
      ssBeatPtnIdx=(curPtnIdx+1)%pattern.length;
      delay=Math.max(50,(target-musicSec)*1000);
    }
  }
  ssTimer=setTimeout(ssNext,delay);
}

function ssNext(){
  cancelSlideCleanup();
  // End-of-pass: fade out + close, only when fadeOutAtEnd is opted-in. Default
  // is to loop (preserves existing public album behavior).
  const s=(album&&album.slideshowSettings)||{};
  if(s.fadeOutAtEnd===true && album && album.assets && ssSlidesShown>=album.assets.length){
    fadeOutSlideshow();
    return;
  }
  ssSlidesShown+=1;
  showKBSlide((ssIndex+1)%album.assets.length,'forward');
}
function ssPrev(){
  cancelSlideCleanup();
  ssBeatIdx=null;ssBeatPtnIdx=null;
  showKBSlide((ssIndex-1+album.assets.length)%album.assets.length,'backward');
}
function ssToggle(){
  ssPausedState=!ssPausedState;
  document.getElementById('ss-pause').textContent=ssPausedState?'▶':'❚❚';
  if(!ssPausedState){
    if(window.DarkroomAudio&&!DarkroomAudio.isMusicPlaying()) startMusic();
    ssBeatIdx=null;ssBeatPtnIdx=null;  // resume re-anchors the beat grid
    showKBSlide(ssIndex);
  } else {
    clearTimeout(ssTimer);
    if(window.DarkroomAudio) DarkroomAudio.pauseMusic({fadeMs:300});
  }
}

// Fade visuals to black + music together over 6s, then close. Only used when
// settings.fadeOutAtEnd is opted-in.
function fadeOutSlideshow(){
  const FADE_MS=6000;
  if(window.DarkroomAudio) DarkroomAudio.stopMusic({fadeMs:FADE_MS});
  ['a','b'].forEach(s=>{
    const el=document.getElementById('ss-slide-'+s);
    if(!el) return;
    el.style.transition=`opacity ${FADE_MS}ms ease-out`;
    el.classList.remove('ss-visible');
    el.style.opacity='0';
  });
  setTimeout(()=>ssClose(),FADE_MS+200);
}
function ssToggleDesc(){
  ssDescVisible=!ssDescVisible;
  const desc=document.getElementById('ss-description');
  const title=document.getElementById('ss-photo-title');
  const btn=document.getElementById('ss-desc-btn');
  // Toggle title + description together — the ✦ button hides all per-photo
  // overlay text as a unit.
  if(desc)desc.style.opacity=ssDescVisible?'1':'0';
  if(title)title.style.opacity=ssDescVisible?'1':'0';
  if(btn)btn.style.color=ssDescVisible?'var(--safe)':'';
}
function ssToggleMusic(){
  const btn=document.getElementById('ss-music-btn');
  if(!window.DarkroomAudio) return;
  if(DarkroomAudio.isMusicPlaying()){
    DarkroomAudio.pauseMusic({fadeMs:200});
    if(btn)btn.style.color='var(--text-dim)';
  } else {
    const file=DarkroomAudio.getMusicFile()||album?.slideshowSettings?.musicFile;
    if(!file) return;
    DarkroomAudio.playMusic(file,{fadeMs:200,loop:true,volume:0.85});
    if(btn)btn.style.color='';
  }
}
function ssClose(){
  clearTimeout(ssTimer);cancelSlideCleanup();resetZoom();
  document.getElementById('ss-overlay').classList.remove('active');
  // Exit native fullscreen if we entered it. Android Chrome honors
  // requestFullscreen on <div>, so openSlideshowPaused's play-button handler
  // puts ss-overlay into native fullscreen on touch-primary devices. Without
  // exitFullscreen here, the overlay remains document.fullscreenElement after
  // ssClose removes the .active class — Android keeps that element as the
  // input target and silently swallows taps on the gallery grid below. iOS
  // WebKit rejects requestFullscreen on <div>, so fullscreenElement is always
  // null there and this branch is a no-op.
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) { try { exit.call(document); } catch(e) {} }
  }
  const card=document.getElementById('ss-title-card');
  if(card){card.style.opacity='0';card.style.display='none';}
  // Wipe inline styles fadeOutSlideshow may have set; otherwise the next
  // slideshow opens with opacity:0 still on both slots = black screen.
  ['a','b'].forEach(s=>{
    const el=document.getElementById('ss-slide-'+s);
    if(!el) return;
    el.style.transition='';
    el.style.opacity='';
  });
  // Wipe overlay text + cancel in-flight fade timers so the next slideshow
  // doesn't open with the last slide's title/description bleeding through.
  const _dEl=document.getElementById('ss-description');
  const _tEl=document.getElementById('ss-photo-title');
  if(_tEl){
    if(_tEl._slideTitleTimer){clearTimeout(_tEl._slideTitleTimer);_tEl._slideTitleTimer=null;}
    if(_tEl._slideTitleFadeOutTimer){clearTimeout(_tEl._slideTitleFadeOutTimer);_tEl._slideTitleFadeOutTimer=null;}
    _tEl.textContent='';
    _tEl.style.opacity='';
    _tEl.style.display='';
    _tEl.style.transition='';
  }
  if(_dEl){
    if(_dEl._slideDescTimer){clearTimeout(_dEl._slideDescTimer);_dEl._slideDescTimer=null;}
    if(_dEl._slideDescFadeOutTimer){clearTimeout(_dEl._slideDescFadeOutTimer);_dEl._slideDescFadeOutTimer=null;}
    _dEl.textContent='';
    _dEl.style.opacity='';
    _dEl.style.display='';
    _dEl.style.transition='';
  }
  ssDescVisible=true;
  stopMusic();
  // If the parent had expanded our iframe in-place, collapse it back.
  if (_embedExpanded) {
    collapseViaParent();
    _embedExpanded = false;
    document.getElementById('ss-fs-btn').textContent = '⤢';
  }
  // ?fs mode = slideshow-only escape from an embed. Closing the overlay would
  // leave the user on a blank page, so route them back: window.close handles
  // popup-opened tabs (window.open path), history.back returns to the article
  // (window.top.location fallback path), and if neither works we drop to the
  // standard album URL so they at least see the grid.
  if (new URLSearchParams(location.search).has('fs')) {
    const fallback = setTimeout(() => {
      const u = new URL(window.location.href);
      u.searchParams.delete('fs');
      window.location.replace(u.toString());
    }, 250);
    window.addEventListener('pagehide', () => clearTimeout(fallback), { once: true });
    try { window.close(); } catch(e) {}
    try { history.back(); } catch(e) {}
  }
}
// Ask the parent page to expand this iframe to viewport-fill. Works only when
// the host has the darkroom helper script installed (postMessage listener).
// Returns true if the parent acknowledged within 200ms. When this path wins,
// the slideshow document never reloads — audio keeps playing seamlessly.
function expandViaParent(){
  return new Promise(resolve => {
    if (window.parent === window) { resolve(false); return; }
    let done = false;
    const onMsg = e => {
      if (e.data && e.data.type === 'darkroom-expanded' && !done) {
        done = true;
        window.removeEventListener('message', onMsg);
        resolve(true);
      }
    };
    window.addEventListener('message', onMsg);
    try { window.parent.postMessage({ type: 'darkroom-expand', slug: slug }, '*'); } catch(e) {}
    setTimeout(() => {
      if (!done) { done = true; window.removeEventListener('message', onMsg); resolve(false); }
    }, 200);
  });
}
function collapseViaParent(){
  if (window.parent === window) return;
  try { window.parent.postMessage({ type: 'darkroom-collapse', slug: slug }, '*'); } catch(e) {}
}
// Escape an iframe embed to a new tab on the standalone URL with ?fs so the
// slideshow runs full-bleed there. Falls back to navigating the top frame
// if the browser blocks the popup. Closing the tab returns to the article.
function escapeEmbedToStandalone(){
  const u = new URL(window.location.href);
  u.searchParams.delete('embed');
  u.searchParams.set('fs', '1');
  const w = window.open(u.toString(), '_blank', 'noopener');
  if (!w) {
    try { window.top.location.href = u.toString(); }
    catch(e) { window.location.href = u.toString(); }
  }
  ssClose();
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

  // Already expanded via the parent helper — tap to collapse.
  if (_embedExpanded) {
    collapseViaParent();
    _embedExpanded = false;
    document.getElementById('ss-fs-btn').textContent = '⤢';
    return;
  }

  // Embed fallback chain when real fullscreen rejects:
  //   1. Ask the parent page to expand the iframe (music keeps playing)
  //   2. Pop the standalone ?fs URL in a new tab (last resort, music restarts)
  const onRealFsFail = async () => {
    if (isEmbed) {
      if (await expandViaParent()) {
        _embedExpanded = true;
        document.getElementById('ss-fs-btn').textContent = '⤡';
        return;
      }
      escapeEmbedToStandalone();
    } else {
      ssClose();
    }
  };

  if (req) {
    req.call(el).then(() => {
      document.getElementById('ss-fs-btn').textContent = '⤡';
    }).catch(onRealFsFail);
  } else {
    onRealFsFail();
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
  // (Previously hid the ⤢ button on touch-primary devices in embed mode.
  // Restored 2026-05-12 — Android needs it for real fullscreen, and even
  // on iOS the request does some useful work when it succeeds via the
  // play-tap activation. iosFallbackFullscreen still handles the worst
  // case by navigating to ?autoplay if the API outright rejects.)
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

// Desktop dblclick → toggle zoom on whichever slideshow slot is currently
// active. Touch double-tap is already handled inside the slideshow's touchend
// handler above. Listener is attached once per slot's <img>; ssActiveSlot
// determines which one is interactive at any moment.
['a','b'].forEach(s => {
  const im = document.getElementById('ss-img-' + s);
  if (!im) return;
  im.addEventListener('dblclick', e => {
    if (!document.getElementById('ss-overlay').classList.contains('active')) return;
    e.preventDefault();
    if (isZoomed()) resetZoom();
    else { ssZoom = { scale: 2.5, tx: 0, ty: 0 }; applyZoomTransform(); }
  });
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
let albFs = { idx: 0 };
// Shared nav throttle — drop a 2nd prev/next within 350ms so a ghost-click,
// finger jitter, or arrow-key auto-repeat advances exactly one photo (mirrors
// the library's navigateRecent guard). Detail and fullscreen never navigate at
// the same time, so one timestamp covers both.
let _albNavLastAt = 0;
function _albNavThrottled(){
  const now = Date.now();
  if (now - _albNavLastAt < 350) return true;
  _albNavLastAt = now;
  return false;
}
// Bounce-guard + deferred-click timer for the album fullscreen viewer.
//   _albFsJustOpenedAt: stamped when albumFsOpen activates the overlay; the
//     overlay click handler ignores clicks within ALB_FS_GUARD_MS of it (those
//     are the trailing click-2 of a double-click on the underlying detail
//     image, which previously fired the center-tap-to-close path).
//   _albFsClickTimer: defers single-click prev/next/close by 280 ms so a desktop
//     dblclick on the image can cancel it (zoom toggle wins) before it fires.
//   _albFsZoomer: the `makeZoomer` instance (from /zoom.js — the same controller
//     the main app's fullscreen viewer uses). Owns pinch / wheel / drag-pan /
//     dblclick / mobile double-tap entirely. We attach on open, reset on
//     navigate (the <img> element survives), destroy on close.
const ALB_FS_GUARD_MS = 500;
let _albFsJustOpenedAt = 0;
let _albFsClickTimer = null;
let _albFsZoomer = null;
function _albFsCancelPendingClick(){ if (_albFsClickTimer) { clearTimeout(_albFsClickTimer); _albFsClickTimer = null; } }
function _albFsIsZoomed(){ return _albFsZoomer ? _albFsZoomer.isZoomed() : false; }
function _albFsResetZoom(){ if (_albFsZoomer) _albFsZoomer.reset(); }
// Two-stage progressive image load. Without this, Safari caches the
// initial-decode bitmap at layout size and zoomed views look soft no matter
// how high-res the source. Setting src twice (preview, then original) forces
// Safari to re-decode at the natural resolution.
// Coarse-pointer / small-screen / mobile-UA → treat as mobile.
function _albIsMobile(){
  if (/iPad|iPhone|iPod|Android/i.test(navigator.userAgent)) return true;
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
  if (window.innerWidth < 900) return true;
  return false;
}
function _albFsLoadProgressive(id){
  const img = document.getElementById('album-fs-img');
  if (!img) return;
  const originalUrl = '/api/public/original/' + id; // full-res for zoom
  // Only swap if this id is still the one on screen — a slow load mustn't
  // clobber the image after the user has navigated on.
  const current = () => !!album && album.assets[albFs.idx] === id &&
    document.getElementById('album-fs-overlay')?.classList.contains('active');
  // Type-agnostic fallback: the mobile first-paint is the sharp-based display
  // endpoint, which 502s on non-raster originals. Immich's thumb renders any
  // type, so fall back to it on error.
  img.onerror = () => { img.onerror = null; if (current() && img) img.src = '/api/public/thumb/' + id; };
  const loadOriginal = () => {
    const orig = new Image();
    // Only swap once the original decodes as an image — a broken original must
    // not clobber a good first paint. Defer neighbour prefetch until it lands
    // so it doesn't compete with the current photo on weak 5G.
    orig.onload = () => { if (current() && img) { img.onerror = null; img.src = originalUrl; if (_albIsMobile()) _albFsPreloadNeighbors(); } };
    orig.src = originalUrl;
  };
  if (_albIsMobile()) {
    // Mobile/cellular: lead with the adaptive display variant. It's light
    // (~200-300 KB) AND ≥ the device width, so it paints full-screen fast for
    // quick nav feedback without the small-then-grow "jump" a tiny thumbnail
    // caused.
    img.src = `/api/public/display/${id}-${ssDisplayWidth}.jpg`;
  } else {
    // Desktop: fast connection — plain ~1440px preview then original (the
    // display variant can be narrower than a big monitor → visible grow).
    img.src = '/api/public/thumb/' + id;
  }
  loadOriginal();
}
// Mobile only: prefetch the adjacent photos' display variants so the
// first-paint stage is already cached on the next prev/next tap.
function _albFsPreloadNeighbors(){
  if (!album || !album.assets || !album.assets.length) return;
  const n = album.assets.length;
  [1, -1].forEach(d => {
    const pre = new Image();
    pre.src = `/api/public/display/${album.assets[(albFs.idx + d + n) % n]}-${ssDisplayWidth}.jpg`;
  });
}
function _albFsAttachZoomer(){
  if (_albFsZoomer || typeof window.makeZoomer !== 'function') return;
  const img = document.getElementById('album-fs-img');
  if (!img) return;
  _albFsZoomer = window.makeZoomer(img, {
    // Touch double-tap detected inside zoom.js — cancel any pending
    // single-click (close/nav) so the zoom toggle wins on mobile too.
    onDoubleTap: () => _albFsCancelPendingClick()
  });
}
function albumFsOpen(idx){
  if (!album || !album.assets) return;
  // Tear down any leftover zoomer before swapping src so transform state from
  // the previous image doesn't survive on the element.
  if (_albFsZoomer) { _albFsZoomer.destroy(); _albFsZoomer = null; }
  albFs.idx = idx;
  const img = document.getElementById('album-fs-img');
  _albFsLoadProgressive(album.assets[idx]);
  document.getElementById('album-fs-overlay').classList.add('active');
  _albFsJustOpenedAt = Date.now();
  // Attach the zoomer once the image has real dimensions — clamp() inside
  // zoom.js reads clientWidth/Height which are stale until the new src loads.
  // Stage-1 (preview) load fires this first; the stage-2 (original) src swap
  // keeps the same <img> element so the zoomer survives the upgrade.
  if (img.complete && img.naturalWidth > 0) _albFsAttachZoomer();
  else img.addEventListener('load', _albFsAttachZoomer, { once: true });
}
function albumFsClose(){
  if (_albFsZoomer) { _albFsZoomer.destroy(); _albFsZoomer = null; }
  document.getElementById('album-fs-overlay').classList.remove('active');
}
function albumFsNavigate(dir){
  if (!album || !album.assets || !album.assets.length) return;
  if (_albNavThrottled()) return;
  // Reset zoom before src swap so the new image starts centered at 1×. The
  // zoomer survives navigate (same <img> element) — cheaper than destroy +
  // reattach on every prev/next.
  if (_albFsZoomer) _albFsZoomer.reset();
  albFs.idx = (albFs.idx + dir + album.assets.length) % album.assets.length;
  _albFsLoadProgressive(album.assets[albFs.idx]);
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
  if (_albNavThrottled()) return;
  albFs.idx = (albFs.idx + dir + album.assets.length) % album.assets.length;
  _albDetailRender(albFs.idx);
}
async function _albDetailRender(forIdx){
  const id = album.assets[forIdx];
  const total = album.assets.length;
  // Reset stale UI immediately so the prior photo's data doesn't linger
  const img = document.getElementById('album-detail-image');
  const titleEl = document.getElementById('album-detail-title');
  const descEl = document.getElementById('album-detail-desc');
  const tableEl = document.getElementById('album-exif-table');
  const counterEl = document.getElementById('album-detail-counter');
  // Detail view uses the lightweight display variant (sharp-resized, same path
  // the slideshow uses) so nav repaints fast on cellular. Tapping the image
  // opens true fullscreen, which still loads the full original progressively.
  // Fall back to the original if the display variant errors. (onerror set as a
  // JS property — CSP blocks inline HTML handlers, not property assigns — and
  // overwriting it each nav avoids listener buildup.)
  if (img) {
    img.onerror = () => { img.onerror = null; img.src = '/api/public/original/' + id; };
    img.src = `/api/public/display/${id}-${ssDisplayWidth}.jpg`;
  }
  if (titleEl) titleEl.textContent = '';
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
  // Dedupe camera: many cameras' EXIF Model already starts with the Make
  // (e.g. Make="OLYMPUS IMAGING CORP", Model="Olympus OM-2S Program"). If the
  // first word matches, use Model alone; otherwise concatenate.
  const camera = (() => {
    if (!m.make && !m.model) return '';
    if (!m.make) return m.model;
    if (!m.model) return m.make;
    const mkFirst = m.make.split(/\s+/)[0].toLowerCase();
    const mdFirst = m.model.split(/\s+/)[0].toLowerCase();
    return (mkFirst && mkFirst === mdFirst) ? m.model : `${m.make} ${m.model}`;
  })().trim();
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
  if (titleEl) titleEl.textContent = m.title || '';
  if (descEl) descEl.textContent = m.description || '';
  if (tableEl) tableEl.innerHTML = rows.join('');
}
function _albDetailActive(){ return document.getElementById('album-detail-view')?.classList.contains('active'); }
function _albFsActive(){ return document.getElementById('album-fs-overlay')?.classList.contains('active'); }
(function wireAlbumFs(){
  const el = document.getElementById('album-fs-overlay');
  if (!el) return;
  // Swipe-only touch handler. Pinch / pan / double-tap / wheel / dblclick are
  // all owned by zoom.js (`makeZoomer`), attached on albumFsOpen and torn
  // down on close. Only thing left for this overlay to do is route a 1-finger
  // swipe (when not zoomed) into nav/close. didSwipe suppresses the synthetic
  // click that follows a swipe so the click handler below doesn't also fire.
  let swipeX = null, swipeY = null, didSwipe = false;
  el.addEventListener('touchstart', e => {
    didSwipe = false;
    if (e.touches.length === 1 && !_albFsIsZoomed()) {
      swipeX = e.touches[0].clientX;
      swipeY = e.touches[0].clientY;
    } else {
      swipeX = swipeY = null;
    }
  }, { passive: true });
  el.addEventListener('touchend', e => {
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
  }, { passive: true });
  el.addEventListener('click', e => {
    if (didSwipe) { didSwipe = false; return; }
    if (e.target.closest('#album-fs-close')) return;
    if (_albFsIsZoomed()) return; // taps while zoomed do nothing — zoom.js owns the image
    // Bounce guard: drop click-2 of a double-click that JUST opened fullscreen
    // from the underlying detail image (click 1 = albumFsOpen on detail-left,
    // click 2 lands on this overlay and would otherwise trigger albumFsClose).
    if (Date.now() - _albFsJustOpenedAt < ALB_FS_GUARD_MS) return;
    // Defer single-click action so a desktop dblclick can win the race for a
    // zoom toggle. zoom.js's `onDoubleTap` callback (registered in
    // _albFsAttachZoomer) calls _albFsCancelPendingClick → clears this timer
    // before close fires. Touch double-taps cancel the same way via the same
    // callback (zoom.js's manual time+distance detection).
    const xPos = e.clientX;
    const vw = window.innerWidth;
    _albFsCancelPendingClick();
    _albFsClickTimer = setTimeout(() => {
      _albFsClickTimer = null;
      if (xPos < vw * 0.25) albumFsNavigate(-1);
      else if (xPos > vw * 0.75) albumFsNavigate(1);
      else albumFsClose();
    }, 280);
  });
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
