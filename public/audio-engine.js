// darkroom-audio-engine.js
// Web Audio playback engine for the Darkroom slideshow.
//
// Why this exists: HTMLAudioElement reports `.currentTime` ~100-300ms behind
// where audio is actually outputting, which makes any beat-locked visual
// scheduling permanently drift. Web Audio's AudioContext gives a
// sample-accurate clock (`audioCtx.currentTime`) that's the same one the
// audio is generated against — so visual schedules computed from it actually
// land where they should.
//
// Lifecycle:
//   1. ensureCtx() — call from a user gesture handler before any await.
//      Creates AudioContext once, idempotent on subsequent calls.
//   2. loadTrack(file) — async; fetches /api/albums/music/<file>, decodes,
//      caches. Returns the AudioBuffer.
//   3. playMusic(file, opts) — starts/resumes playback.
//   4. pauseMusic / stopMusic — pause remembers offset, stop doesn't.
//   5. scheduleClick(ctxTime) — schedules a single tick at exact audio time.
//
// Exposed as window.DarkroomAudio.

(function() {
  let ctx = null;
  let masterGain = null;
  const trackCache = new Map();      // file -> AudioBuffer
  const analysisCache = new Map();   // file -> { bpm, beats:[seconds], confidence } | 'pending' | { error }
  const analysisPromises = new Map();// file -> Promise (so concurrent analyzeTrack calls share work)
  let essentiaWorker = null;
  let clickBuffer = null;

  // Current music source state. Sources are one-shot in Web Audio — every
  // play/resume creates a fresh AudioBufferSourceNode wired through its own
  // GainNode. We keep references so pause/stop can ramp + stop cleanly.
  let musicSource = null;
  let musicGain = null;
  let musicStartCtxTime = 0;   // ctx.currentTime when current source started
  let musicStartOffset = 0;    // position within the track when current source started
  let musicPausedAt = null;    // track-time stored at pause; null if not paused
  let musicFile = null;

  function ensureCtx() {
    if (ctx) {
      if (ctx.state === 'suspended') {
        // Re-arm on every entry point. Safari especially needs this.
        ctx.resume().catch(() => {});
      }
      return ctx;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) throw new Error('Web Audio not supported');
    ctx = new Ctor();
    masterGain = ctx.createGain();
    masterGain.gain.value = 1.0;
    masterGain.connect(ctx.destination);
    // Build the click buffer once. 40ms 2kHz sine with exponential decay —
    // short enough to feel like a click, sharp enough to cut through music.
    const sr = ctx.sampleRate;
    const dur = 0.04;
    const n = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, n, sr);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      // Dual-tone: 2.5kHz sine + 5kHz sine for a brighter, more piercing tick
      // that cuts through music. Exponential decay keeps it short.
      const env = Math.exp(-t * 60);
      ch[i] = (Math.sin(2 * Math.PI * 2500 * t) * 0.7
             + Math.sin(2 * Math.PI * 5000 * t) * 0.3) * env;
    }
    clickBuffer = buf;
    return ctx;
  }

  async function loadTrack(file) {
    if (!file) return null;
    if (trackCache.has(file)) return trackCache.get(file);
    ensureCtx();
    const resp = await fetch('/api/albums/music/' + encodeURIComponent(file));
    if (!resp.ok) throw new Error('music fetch failed: ' + resp.status);
    const arrayBuf = await resp.arrayBuffer();
    // Promise-style decodeAudioData; the callback form is required on older
    // Safari but the promise form works on everything modern.
    const audioBuf = await new Promise((resolve, reject) => {
      try {
        const p = ctx.decodeAudioData(arrayBuf, resolve, reject);
        if (p && p.then) p.then(resolve, reject);
      } catch (e) { reject(e); }
    });
    trackCache.set(file, audioBuf);
    return audioBuf;
  }

  function _startSource(buffer, offset, fadeMs, loop, targetVol) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = !!loop;
    const g = ctx.createGain();
    src.connect(g);
    g.connect(masterGain);
    const startAt = ctx.currentTime;
    const tgt = targetVol != null ? targetVol : 1;
    if (fadeMs > 0) {
      g.gain.setValueAtTime(0, startAt);
      g.gain.linearRampToValueAtTime(tgt, startAt + fadeMs / 1000);
    } else {
      g.gain.setValueAtTime(tgt, startAt);
    }
    src.start(startAt, Math.max(0, offset));
    return { src, gain: g, startCtxTime: startAt, startOffset: offset };
  }

  function _stopCurrent(fadeMs) {
    if (!musicSource) return;
    const now = ctx.currentTime;
    const src = musicSource;
    const g = musicGain;
    musicSource = null;
    musicGain = null;
    if (fadeMs > 0) {
      try {
        const cur = g.gain.value;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(cur, now);
        g.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
        src.stop(now + fadeMs / 1000 + 0.05);
      } catch (e) {
        try { src.stop(); } catch (_) {}
      }
    } else {
      try { src.stop(); } catch (e) {}
    }
  }

  async function playMusic(file, opts) {
    opts = opts || {};
    const fadeMs = opts.fadeMs != null ? opts.fadeMs : 0;
    const loop = opts.loop !== false;
    ensureCtx();
    const buffer = await loadTrack(file);
    if (!buffer) return;
    if (musicSource) _stopCurrent(0);
    musicFile = file;
    const offset = (musicPausedAt != null && musicPausedAt < buffer.duration) ? musicPausedAt : 0;
    musicPausedAt = null;
    const volume = opts.volume != null ? opts.volume : 1;
    const r = _startSource(buffer, offset, fadeMs, loop, volume);
    musicSource = r.src;
    musicGain = r.gain;
    musicStartCtxTime = r.startCtxTime;
    musicStartOffset = r.startOffset;
  }

  function pauseMusic(opts) {
    opts = opts || {};
    if (!musicSource) return;
    musicPausedAt = getMusicTime();
    _stopCurrent(opts.fadeMs != null ? opts.fadeMs : 0);
  }

  function stopMusic(opts) {
    opts = opts || {};
    musicPausedAt = null;
    _stopCurrent(opts.fadeMs != null ? opts.fadeMs : 0);
  }

  function isMusicPlaying() { return !!musicSource; }

  function getMusicTime() {
    if (!musicSource) return musicPausedAt != null ? musicPausedAt : 0;
    return musicStartOffset + (ctx.currentTime - musicStartCtxTime);
  }

  function getMusicFile() { return musicFile; }

  function scheduleClick(ctxTime, opts) {
    opts = opts || {};
    ensureCtx();
    // Use OscillatorNode + envelope on a GainNode — proven to produce audio
    // on this user's browser (diagnostic confirmed sine path works, buffer
    // path didn't). Sample-accurate scheduling via start(when) is still
    // intact; only the source type changes.
    const gain = opts.gain != null ? opts.gain : 0.8;
    const startAt = Math.max(ctx.currentTime, ctxTime);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 2500;
    // Short attack-decay envelope for a "click" perception
    g.gain.setValueAtTime(0, startAt);
    g.gain.linearRampToValueAtTime(gain, startAt + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, startAt + 0.08);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(startAt);
    osc.stop(startAt + 0.1);
  }

  function now() { return ctx ? ctx.currentTime : 0; }

  // ── Beat analysis (essentia.js, off-thread) ──────────────────────────────
  function _ensureWorker() {
    if (essentiaWorker) return essentiaWorker;
    essentiaWorker = new Worker('/essentia-worker.js?v=4');
    return essentiaWorker;
  }

  // Mix to mono and resample to 44.1k (essentia's RhythmExtractor2013 assumes
  // 44100 Hz internally; browsers commonly run AudioContext at 48000 Hz).
  async function _toMono44100(audioBuffer) {
    const sr = audioBuffer.sampleRate;
    const ch = audioBuffer.numberOfChannels;
    const n = audioBuffer.length;
    const mono = new Float32Array(n);
    for (let c = 0; c < ch; c++) {
      const data = audioBuffer.getChannelData(c);
      for (let i = 0; i < n; i++) mono[i] += data[i] / ch;
    }
    if (sr === 44100) return mono;
    // OfflineAudioContext resamples for us
    const targetLen = Math.floor(n * 44100 / sr);
    const oac = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, targetLen, 44100);
    const srcBuf = oac.createBuffer(1, n, sr);
    srcBuf.copyToChannel(mono, 0);
    const node = oac.createBufferSource();
    node.buffer = srcBuf;
    node.connect(oac.destination);
    node.start();
    const rendered = await oac.startRendering();
    const out = rendered.getChannelData(0).slice();
    // Safari counts each unclosed (Offline)AudioContext against a per-document
    // quota. Without explicit close(), accumulated OACs from repeated track
    // selections can silently mute all Web Audio output on the page even
    // though new contexts still report state=running.
    try { if (typeof oac.close === 'function') await oac.close(); } catch (e) {}
    return out;
  }

  async function analyzeTrack(file) {
    if (!file) return null;
    // Cached result?
    const cached = analysisCache.get(file);
    if (cached && cached !== 'pending' && !cached.error) return cached;
    if (analysisPromises.has(file)) return analysisPromises.get(file);

    const p = (async () => {
      analysisCache.set(file, 'pending');
      const buffer = await loadTrack(file);
      if (!buffer) { analysisCache.set(file, { error: 'no buffer' }); return null; }
      const samples = await _toMono44100(buffer);
      const w = _ensureWorker();
      return new Promise((resolve, reject) => {
        const onMsg = (e) => {
          const d = e.data || {};
          if (d.file && d.file !== file && d.type !== 'progress' && d.type !== 'error') return;
          if (d.type === 'progress') {
            console.log('[beat-detect]', d.stage || '', d.message || '');
            // Bubble progress up via a status notifier so the modal can update
            if (typeof window.onBeatAnalysisProgress === 'function') {
              try { window.onBeatAnalysisProgress(file, d.stage, d.message); } catch (_) {}
            }
            return;
          }
          if (d.type === 'done') {
            w.removeEventListener('message', onMsg);
            w.removeEventListener('error', onErr);
            const result = { bpm: d.bpm, beats: d.beats, confidence: d.confidence };
            analysisCache.set(file, result);
            resolve(result);
          } else if (d.type === 'error') {
            w.removeEventListener('message', onMsg);
            w.removeEventListener('error', onErr);
            const err = { error: (d.stage ? d.stage + ': ' : '') + (d.error || 'analyze failed') };
            analysisCache.set(file, err);
            console.warn('[essentia]', file, err.error);
            resolve(null);
          }
        };
        const onErr = (e) => {
          w.removeEventListener('message', onMsg);
          w.removeEventListener('error', onErr);
          const err = { error: 'worker error: ' + (e.message || 'unknown') };
          analysisCache.set(file, err);
          console.error('[essentia worker]', e);
          resolve(null);
        };
        w.addEventListener('message', onMsg);
        w.addEventListener('error', onErr);
        // Transfer the underlying ArrayBuffer so we don't pay copy cost
        w.postMessage({ type: 'analyze', file, samples }, [samples.buffer]);
      });
    })().finally(() => { analysisPromises.delete(file); });

    analysisPromises.set(file, p);
    return p;
  }

  function getTrackAnalysis(file) {
    const r = analysisCache.get(file);
    if (!r || r === 'pending' || r.error) return null;
    return r;
  }

  function getAnalysisStatus(file) {
    const r = analysisCache.get(file);
    if (!r) return 'idle';
    if (r === 'pending') return 'analyzing';
    if (r.error) return 'failed';
    return 'ready';
  }

  function setMasterVolume(v) {
    ensureCtx();
    masterGain.gain.value = Math.max(0, Math.min(1, v));
  }

  function destroy() {
    stopMusic();
    if (ctx) { try { ctx.close(); } catch (e) {} ctx = null; }
    masterGain = null;
    clickBuffer = null;
    trackCache.clear();
    musicFile = null;
    musicPausedAt = null;
  }

  window.DarkroomAudio = {
    ensureCtx,
    loadTrack,
    playMusic,
    pauseMusic,
    stopMusic,
    isMusicPlaying,
    getMusicTime,
    getMusicFile,
    scheduleClick,
    now,
    setMasterVolume,
    analyzeTrack,
    getTrackAnalysis,
    getAnalysisStatus,
    destroy,
  };
})();
