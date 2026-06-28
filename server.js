const express = require('express');
const multer = require('multer');
const musicStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = '/music';
    require('fs').mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'))
});
const uploadMusic = multer({ storage: musicStorage, limits: { fileSize: 50 * 1024 * 1024 } });
const session = require('express-session');
const bcrypt = require('bcryptjs');
const compression = require('compression');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const exifr = require('exifr');

// In-memory cache for asset titles extracted from JPEG IPTC/XMP.
// Immich's API doesn't surface a title field — LR exports title to IPTC
// ObjectName / XMP dc:title, which we have to read from the JPEG header
// directly. Key = `${assetId}|${updatedAt}` so a re-upload (Immich's
// updatedAt bumps) invalidates automatically. Worst case: cache is lost
// on container restart and we re-fetch first 64KB per detail view.
const _titleCache = new Map();

async function fetchAssetTitle(assetId, updatedAt) {
  const key = `${assetId}|${updatedAt || ''}`;
  if (_titleCache.has(key)) return _titleCache.get(key);
  let title = '';
  try {
    // Range-request the first 256KB. Initial guess was 64KB but for some
    // JPEGs (verified 2026-05-12 on a_001_mamiya6.jpg) LR pushes IPTC
    // past the 64KB mark — Photoshop IRB / XMP / thumbnail segments take
    // up the early header. 64KB returned undefined for ObjectName; 128KB
    // returned "Belay". 256KB gives us margin without fetching the full
    // 20MB original. Sub-100ms on LAN.
    const r = await fetch(`${IMMICH_URL}/assets/${assetId}/original`, {
      headers: { 'x-api-key': IMMICH_KEY, 'Range': 'bytes=0-262143' },
    });
    if (r.ok || r.status === 206) {
      const buf = await r.buffer();
      // mergeOutput:false keeps IPTC/XMP/IFD0 in separate namespaces.
      // exifr's default merge silently drops IPTC ObjectName when there's
      // no top-level conflict — verified 2026-05-12 against a JPEG that
      // had ObjectName="Lines" in IPTC: merged result had no `ObjectName`
      // key at all, but `result.iptc.ObjectName === "Lines"`.
      const meta = await exifr.parse(buf, {
        iptc: true, xmp: true, ifd0: true, mergeOutput: false
      });
      // Priority: IPTC ObjectName (where LR writes title on JPEG export)
      // → XMP dc:title → Windows XPTitle.
      let raw = (meta?.iptc?.ObjectName)
             || (meta?.xmp?.title)
             || (meta?.ifd0?.XPTitle)
             || '';
      if (typeof raw === 'object' && raw !== null) {
        // dc:title sometimes parses as a language-map { en: "..." }
        raw = raw.en || raw.value || Object.values(raw)[0] || '';
      }
      title = String(raw).trim();
    }
  } catch (e) {
    // Silent on EXIF parse failure — title is best-effort
  }
  _titleCache.set(key, title);
  return title;
}

const app = express();
// gzip/brotli compression for all responses — added v1.5.62 (app.js + index.html
// + sw.js + grid thumb JSON were shipping uncompressed).
app.use(compression());
const PORT = process.env.PORT || 3000;
const PASSWORD_HASH = process.env.PASSWORD_HASH || bcrypt.hashSync(process.env.APP_PASSWORD || 'darkroom', 10);
const IMMICH_URL = process.env.IMMICH_URL || 'http://192.168.0.199:2283/api';
const IMMICH_KEY = process.env.IMMICH_KEY || '';
const DATA_FILE = '/data/prints.json';
const ALBUMS_FILE = '/data/albums.json';
const SETTINGS_FILE = '/data/settings.json';
const TITLE_INDEX_FILE = '/data/titles.json';

// Ensure data files exist
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify([]));
if (!fs.existsSync(ALBUMS_FILE)) fs.writeFileSync(ALBUMS_FILE, JSON.stringify([]));

// ── LR title sync auth ─────────────────────────────────────────────────────
// Validates incoming LR title pushes by forwarding the caller's Immich API
// key to Immich's /users/me. Caches valid keys in-memory for 5 minutes so a
// publish batch only pays one round-trip.
const _apiKeyCache = new Map();
const API_KEY_CACHE_TTL = 5 * 60 * 1000;
async function validateImmichApiKey(apiKey) {
  if (!apiKey) return false;
  const c = _apiKeyCache.get(apiKey);
  if (c && c.exp > Date.now()) return c.ok;
  let ok = false;
  try {
    const r = await fetch(`${IMMICH_URL}/users/me`, { headers: { 'x-api-key': apiKey } });
    ok = r.ok;
  } catch (e) { ok = false; }
  _apiKeyCache.set(apiKey, { ok, exp: Date.now() + API_KEY_CACHE_TTL });
  return ok;
}

// ── Title index ────────────────────────────────────────────────────────────
// Persistent map of assetId → { title, updatedAt, indexedAt }. Lets library
// search match against IPTC ObjectName (LR's "title" field), which Immich's
// own search-metadata endpoint doesn't expose. Built by a background backfill
// that walks Immich and reads each JPEG's IPTC header via fetchAssetTitle.
let _titleIndex = new Map();
let _titleIndexSaveTimer = null;
function loadTitleIndex() {
  try {
    const obj = JSON.parse(fs.readFileSync(TITLE_INDEX_FILE, 'utf8'));
    _titleIndex = new Map(Object.entries(obj));
    console.log(`title index: loaded ${_titleIndex.size} entries`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('title index load:', e.message);
    _titleIndex = new Map();
  }
}
function saveTitleIndexSoon() {
  if (_titleIndexSaveTimer) return;
  _titleIndexSaveTimer = setTimeout(() => {
    _titleIndexSaveTimer = null;
    try { fs.writeFileSync(TITLE_INDEX_FILE, JSON.stringify(Object.fromEntries(_titleIndex))); }
    catch (e) { console.error('title index save:', e.message); }
  }, 5000);
}
function searchTitleIndex(q) {
  if (!q) return [];
  const needle = q.toLowerCase();
  const hits = [];
  for (const [id, e] of _titleIndex) {
    if (e.title && e.title.toLowerCase().includes(needle)) hits.push({ id, title: e.title });
  }
  return hits.slice(0, 50);
}
async function backfillTitleIndex() {
  console.log('title index: backfill started');
  let page = 1, scanned = 0, updated = 0;
  while (true) {
    let data;
    try {
      const r = await fetch(`${IMMICH_URL}/search/metadata`, {
        method: 'POST',
        headers: { 'x-api-key': IMMICH_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ page, size: 250, type: 'IMAGE' })
      });
      data = await r.json();
    } catch (e) { console.error('title index: page fetch failed:', e.message); break; }
    const items = data.assets?.items || [];
    if (!items.length) break;
    scanned += items.length;
    // Process in batches of 8 for some concurrency without hammering Immich
    for (let i = 0; i < items.length; i += 8) {
      const batch = items.slice(i, i + 8);
      await Promise.all(batch.map(async (a) => {
        const updatedAt = a.updatedAt || a.fileModifiedAt;
        const cached = _titleIndex.get(a.id);
        // LR plugin pushes are authoritative for their assets — don't let the
        // byte scanner clobber them with whatever it finds in the JPEG.
        if (cached && cached.source === 'lr') return;
        if (cached && cached.updatedAt === updatedAt) return;
        try {
          const title = await fetchAssetTitle(a.id, updatedAt);
          _titleIndex.set(a.id, { title: title || '', updatedAt, indexedAt: Date.now(), source: 'scan' });
          updated++;
        } catch (e) { /* skip */ }
      }));
      if (updated > 0 && updated % 50 === 0) saveTitleIndexSoon();
    }
    if (data.assets?.nextPage == null) break;
    page = parseInt(data.assets.nextPage, 10);
  }
  saveTitleIndexSoon();
  console.log(`title index: backfill done. scanned=${scanned} updated=${updated} total=${_titleIndex.size}`);
}
loadTitleIndex();
// Kick off backfill 10s after start so we don't block the boot path, then
// every 6h for incremental refresh as new photos land.
setTimeout(() => backfillTitleIndex().catch(e => console.error('backfill:', e)), 10000);
setInterval(() => backfillTitleIndex().catch(()=>{}), 6 * 60 * 60 * 1000);

const loadData = () => {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch(e) { return []; }
};

const saveData = (data) => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

const loadAlbums = () => {
  try { return JSON.parse(fs.readFileSync(ALBUMS_FILE, 'utf8')); }
  catch(e) { return []; }
};

const saveAlbums = (data) => {
  fs.writeFileSync(ALBUMS_FILE, JSON.stringify(data, null, 2));
};

const loadSettings = () => {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
  catch(e) { return {}; }
};

const saveSettings = (data) => {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
};

const slugify = (str) => str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=15768000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), fullscreen=*');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' blob:; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: blob:; " +
    "media-src 'self' blob:; " +
    "connect-src 'self'; " +
    "object-src 'none'; " +
    "frame-ancestors 'self' https://*.squarespace.com https://lakatua.me https://*.lakatua.me https://lakatua.com https://*.lakatua.com https://substack.com https://*.substack.com https://lakatua-me.pages.dev https://*.lakatua-me.pages.dev;"
  );
  next();
});
app.use(session({
  secret: process.env.SESSION_SECRET || 'darkroom-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    const base = path.basename(filePath);
    if (base === 'sw.js') {
      res.set('Cache-Control', 'no-cache');
    } else if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.json')) {
      res.set('Cache-Control', 'no-cache, must-revalidate');
    } else {
      res.set('Cache-Control', 'public, max-age=86400');
    }
  }
}));

const requireAuth = (req, res, next) => {
  if (req.session.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
};

// Auth endpoints
// Login rate limiting - max 10 attempts per IP per 15 minutes
const loginAttempts = new Map();
function checkLoginRateLimit(ip) {
  const now = Date.now();
  const window = 15 * 60 * 1000; // 15 minutes
  const max = 10;
  const attempts = (loginAttempts.get(ip) || []).filter(t => now - t < window);
  if (attempts.length >= max) return false;
  attempts.push(now);
  loginAttempts.set(ip, attempts);
  return true;
}
// Clean up old entries every hour
setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of loginAttempts.entries()) {
    if (times.every(t => now - t > 15 * 60 * 1000)) loginAttempts.delete(ip);
  }
}, 60 * 60 * 1000);

app.post('/api/login', async (req, res) => {
  const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip;
  if (!checkLoginRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
  }
  const { password } = req.body;
  if (!password) return res.status(401).json({ error: 'Invalid password' });
  const valid = await bcrypt.compare(password, PASSWORD_HASH);
  if (valid) {
    req.session.authenticated = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/check', (req, res) => {
  res.json({ authenticated: !!req.session.authenticated });
});

// LR plugin pushes title here on every publish so title-only edits don't
// require re-rendering the JPEG. Auth: caller's Immich API key, validated
// against this Darkroom's Immich. Once accepted, entries flagged source='lr'
// are treated as authoritative — the byte-scan backfill won't overwrite them.
app.post('/api/lr-title', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'missing api key' });
  const ok = await validateImmichApiKey(apiKey);
  if (!ok) return res.status(401).json({ error: 'invalid api key' });
  const { assetId, title } = req.body || {};
  if (!assetId || typeof assetId !== 'string') return res.status(400).json({ error: 'assetId required' });
  if (typeof title !== 'string') return res.status(400).json({ error: 'title required (empty string clears)' });
  _titleIndex.set(assetId, {
    title: title.trim(),
    updatedAt: new Date().toISOString(),
    indexedAt: Date.now(),
    source: 'lr',
  });
  saveTitleIndexSoon();
  console.log(`lr-title: asset=${assetId} title=${JSON.stringify(title.trim())}`);
  res.json({ ok: true });
});

// Immich proxy - search photos. Queries Immich's filename index AND the
// local title index in parallel; merges results so a search for "curtains"
// finds the photo whose IPTC title is Curtains even if the filename is
// 2024-05-13_M7_036.jpg. Title index is built by background backfill.
app.get('/api/immich/search', requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q || !q.trim()) return res.json([]);
  try {
    const [immichData, titleHits] = await Promise.all([
      fetch(`${IMMICH_URL}/search/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': IMMICH_KEY },
        body: JSON.stringify({ originalFileName: q, size: 20 })
      }).then(r => r.json()).catch(() => ({ assets: { items: [] } })),
      Promise.resolve(searchTitleIndex(q))
    ]);
    const immichItems = (immichData.assets?.items || []).map(a => ({
      id: a.id,
      filename: a.originalFileName,
      title: _titleIndex.get(a.id)?.title || '',
      takenAt: a.fileCreatedAt,
      width: a.width,
      height: a.height
    }));
    const seenIds = new Set(immichItems.map(i => i.id));
    const titleOnly = titleHits.filter(t => !seenIds.has(t.id)).slice(0, 30);
    // Fetch full asset data for title-only matches so the UI gets thumbs etc.
    const titleAssets = await Promise.all(
      titleOnly.map(t =>
        fetch(`${IMMICH_URL}/assets/${t.id}`, { headers: { 'x-api-key': IMMICH_KEY } })
          .then(r => r.ok ? r.json() : null).catch(() => null)
      )
    );
    const titleItems = titleAssets.filter(Boolean).map(a => ({
      id: a.id,
      filename: a.originalFileName,
      title: _titleIndex.get(a.id)?.title || '',
      takenAt: a.fileCreatedAt,
      width: a.width,
      height: a.height
    }));
    res.json([...immichItems, ...titleItems]);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Immich proxy - get photo info
app.get('/api/immich/photo/:id', requireAuth, async (req, res) => {
  try {
    const response = await fetch(`${IMMICH_URL}/assets/${req.params.id}`, {
      headers: { 'x-api-key': IMMICH_KEY }
    });
    const data = await response.json();
    // Title isn't in Immich's API. Prefer the title index (which is
    // authoritative when populated by the lr-immich plugin's POST
    // /api/lr-title — source: 'lr'). Fall back to scanning JPEG bytes
    // for assets the plugin never touched (older uploads, non-LR sources).
    let title = '';
    const indexed = _titleIndex.get(req.params.id);
    if (indexed && indexed.source === 'lr') {
      title = indexed.title || '';
    } else {
      title = await fetchAssetTitle(req.params.id, data.updatedAt || data.fileModifiedAt);
    }
    res.json({
      id: data.id,
      filename: data.originalFileName,
      title: title || '',
      description: data.exifInfo?.description || '',
      make: data.exifInfo?.make || '',
      model: data.exifInfo?.model || '',
      lens: data.exifInfo?.lensModel || '',
      fNumber: data.exifInfo?.fNumber || '',
      shutterSpeed: data.exifInfo?.exposureTime || '',
      iso: data.exifInfo?.iso || '',
      takenAt: data.localDateTime || data.fileCreatedAt,
      latitude: data.exifInfo?.latitude || null,
      longitude: data.exifInfo?.longitude || null,
      city: data.exifInfo?.city || data.city || '',
      state: data.exifInfo?.state || data.state || '',
      country: data.exifInfo?.country || data.country || '',
      width: data.exifInfo?.exifImageWidth || '',
      height: data.exifInfo?.exifImageHeight || '',
      // Tag names from Immich (synced from LR keywords by the lr-immich plugin)
      tags: Array.isArray(data.tags) ? data.tags.map(t => t.name).filter(Boolean) : [],
      isArchived: data.isArchived || false
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Map Immich asset → client payload with folded exif metadata
function mapAssetWithMeta(a) {
  const exif = a.exifInfo || {};
  return {
    id: a.id,
    originalFileName: a.originalFileName,
    fileCreatedAt: a.fileCreatedAt,
    createdAt: a.createdAt,
    localDateTime: a.localDateTime,
    description: exif.description || '',
    make: exif.make || '',
    model: exif.model || '',
    lens: exif.lensModel || '',
    fNumber: exif.fNumber || '',
    shutterSpeed: exif.exposureTime || '',
    iso: exif.iso || '',
    takenAt: a.localDateTime || a.fileCreatedAt || '',
    city: exif.city || a.city || '',
    state: exif.state || a.state || '',
    country: exif.country || a.country || '',
    width: exif.exifImageWidth || '',
    height: exif.exifImageHeight || '',
    // Tags come from Immich directly — `tags` is an array of {id,name,value,...}.
    // We forward just the names since that's all the UI needs.
    // No title here — that requires a JPEG-header EXIF read per asset which
    // would be way too expensive for a 500-item grid. Title is fetched
    // lazily in /api/immich/photo/:id (detail view) where the cost is fine.
    tags: Array.isArray(a.tags) ? a.tags.map(t => t.name).filter(Boolean) : [],
    isArchived: a.isArchived || false,
    // Forwarded so the client can version thumbnail URLs (?v=updatedAt) — a
    // republish/replace bumps updatedAt, which auto-busts stale browser/SW
    // thumbnail caches. See thumbSrc() in app.js.
    updatedAt: a.updatedAt || ''
  };
}

// Immich proxy - recent uploads
// Upload sort uses windowed createdAfter by default (fast). Mode=full pages
// through everything and caches the sorted list (5 min) so users can find old
// photos uploaded recently — Immich's metadata search only sorts by
// fileCreatedAt, so a window-by-upload-time was the only way to surface fresh
// uploads of historical scans.
let _uploadSweepCache = null;
let _uploadSweepCachedAt = 0;
const UPLOAD_SWEEP_TTL_MS = 5 * 60 * 1000;
async function _fetchAllTimelineAssets() {
  const all = [];
  const pageSize = 1000;
  for (let p = 1; p <= 50; p++) {
    const r = await fetch(`${IMMICH_URL}/search/metadata`, {
      method: 'POST',
      headers: { 'x-api-key': IMMICH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ size: pageSize, page: p, visibility: 'timeline' })
    });
    const data = await r.json();
    const items = (data.assets && data.assets.items) || [];
    all.push(...items);
    if (items.length < pageSize) break;
  }
  return all;
}
async function _fetchTimelineSince(sinceIso) {
  const all = [];
  const pageSize = 1000;
  for (let p = 1; p <= 10; p++) {
    const r = await fetch(`${IMMICH_URL}/search/metadata`, {
      method: 'POST',
      headers: { 'x-api-key': IMMICH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ size: pageSize, page: p, visibility: 'timeline', createdAfter: sinceIso })
    });
    const data = await r.json();
    const items = (data.assets && data.assets.items) || [];
    all.push(...items);
    if (items.length < pageSize) break;
  }
  return all;
}
app.get('/api/immich/recent', requireAuth, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const size = parseInt(req.query.size) || 500;
  const sort = req.query.sort || 'upload';
  const dir = req.query.dir || 'desc';
  try {
    if (sort === 'taken') {
      const order = dir === 'asc' ? 'asc' : 'desc';
      const r = await fetch(`${IMMICH_URL}/search/metadata`, {
        method: 'POST',
        headers: { 'x-api-key': IMMICH_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ size, page, order, visibility: 'timeline', type: 'IMAGE' })
      });
      const data = await r.json();
      const items = (data.assets && data.assets.items) || [];
      res.json({ assets: items.map(mapAssetWithMeta), total: data.assets?.total || 0 });
      return;
    }
    // sort === 'upload' — window (default) or full sweep
    const mode = req.query.mode === 'full' ? 'full' : 'window';
    const windowDays = Math.max(1, Math.min(365, parseInt(req.query.windowDays) || 7));
    let pool;
    if (mode === 'full') {
      const now = Date.now();
      if (!_uploadSweepCache || (now - _uploadSweepCachedAt) > UPLOAD_SWEEP_TTL_MS) {
        _uploadSweepCache = await _fetchAllTimelineAssets();
        _uploadSweepCachedAt = now;
      }
      pool = _uploadSweepCache;
    } else {
      const since = new Date(Date.now() - windowDays * 86400e3).toISOString();
      pool = await _fetchTimelineSince(since);
    }
    pool = pool.slice().sort((a, b) => dir === 'asc'
      ? new Date(a.createdAt) - new Date(b.createdAt)
      : new Date(b.createdAt) - new Date(a.createdAt));
    const startIdx = (page - 1) * size;
    const slice = pool.slice(startIdx, startIdx + size);
    res.json({
      assets: slice.map(mapAssetWithMeta),
      total: pool.length,
      mode,
      windowDays: mode === 'window' ? windowDays : null
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Immich proxy - thumbnail
app.get('/api/immich/thumb/:id', requireAuth, async (req, res) => {
  // Mid-size: server-resized 1200px / q80 (~150-300 KB), disk-cached.
  // Used as the second tier of the detail-view progressive chain.
  if (req.query.size === 'small') {
    const tag = await _shareCacheTagFor(req.params.id);
    const cachePath = tag
      ? path.join(THUMB_CACHE_DIR, `${req.params.id}-small-${tag}.jpg`)
      : null;
    if (cachePath && fs.existsSync(cachePath)) {
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'private, max-age=86400');
      res.set('X-Cache', 'HIT');
      return res.sendFile(cachePath);
    }
    try {
      const upstream = await fetch(`${IMMICH_URL}/assets/${req.params.id}/thumbnail?size=preview`, {
        headers: { 'x-api-key': IMMICH_KEY }
      });
      if (!upstream.ok) {
        return res.status(upstream.status).send('upstream ' + upstream.status);
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      const out = await sharp(buf, { failOn: 'none' })
        .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
        .withMetadata()
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer();
      // Atomic write: tmp + rename — survives concurrent generations.
      if (cachePath) {
        try {
          const tmp = cachePath + '.tmp';
          fs.writeFileSync(tmp, out);
          fs.renameSync(tmp, cachePath);
        } catch (e) {
          console.warn('thumb-small cache write failed:', e.message);
        }
      }
      res.set('Content-Type', 'image/jpeg');
      res.set('Content-Length', out.length);
      res.set('Cache-Control', 'private, max-age=86400');
      res.set('X-Cache', 'MISS');
      res.send(out);
    } catch (e) {
      console.error('thumb-small resize error:', e);
      res.status(500).json({ error: e.message });
    }
    return;
  }

  // Default: pass through Immich's native thumbnail / preview.
  try {
    const size = req.query.size === 'preview' ? 'preview' : 'thumbnail';
    const response = await fetch(`${IMMICH_URL}/assets/${req.params.id}/thumbnail?size=${size}`, {
      headers: { 'x-api-key': IMMICH_KEY }
    });
    res.set('Content-Type', response.headers.get('content-type'));
    res.set('Cache-Control', 'private, max-age=86400');
    response.body.pipe(res);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Immich proxy - full image
app.get('/api/immich/original/:id', requireAuth, async (req, res) => {
  try {
    const response = await fetch(`${IMMICH_URL}/assets/${req.params.id}/original`, {
      headers: { 'x-api-key': IMMICH_KEY }
    });
    res.set('Content-Type', response.headers.get('content-type'));
    response.body.pipe(res);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Immich proxy - preview-size JPEG (~1440px long edge, <1 MB).
// Used for the Web Share button so we don't try to share a multi-MB hi-res original
// (which iOS Safari rejects under navigator.canShare).
app.get('/api/immich/preview/:id', requireAuth, async (req, res) => {
  try {
    const size = req.query.size === 'thumbnail' ? 'thumbnail' : 'preview';
    const response = await fetch(`${IMMICH_URL}/assets/${req.params.id}/thumbnail?size=${size}`, {
      headers: { 'x-api-key': IMMICH_KEY }
    });
    res.set('Content-Type', response.headers.get('content-type') || 'image/jpeg');
    response.body.pipe(res);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Immich proxy — sized download / share. Fetches the original from Immich on
// the local network (fast), then sharp-resizes + iterates JPEG quality to land
// in a target byte range per size preset. The Leica forum has a 2.7 MB upload
// limit, so 'large' is treated as a hard ceiling: the encoder retries with
// lower quality until output <= ceiling.
const SHARE_CACHE_DIR = '/data/share-cache';
const THUMB_CACHE_DIR = '/data/thumb-cache';
try { fs.mkdirSync(SHARE_CACHE_DIR, { recursive: true }); } catch(e) {}
try { fs.mkdirSync(THUMB_CACHE_DIR, { recursive: true }); } catch(e) {}

// Returns the asset's updatedAt as a compact filename-safe string (or null on error).
async function _shareCacheTagFor(assetId) {
  try {
    const r = await fetch(`${IMMICH_URL}/assets/${assetId}`, {
      headers: { 'x-api-key': IMMICH_KEY }
    });
    if (!r.ok) return null;
    const a = await r.json();
    if (!a || !a.updatedAt) return null;
    return String(a.updatedAt).replace(/[-:.TZ]/g, '');
  } catch (e) {
    return null;
  }
}

const SHARE_TARGETS = {
  small:  { maxBytes:   500000, maxDim: 1200 },
  medium: { maxBytes:  1500000, maxDim: 2400 },
  large:  { maxBytes:  2700000, maxDim: 4200 },
  // Leica Forum: the forum fits uploads to 2480px then rejects anything still
  // over ~5 MP — so a full-size SQUARE (2480²=6.15 MP) fails while landscapes
  // (~4 MP) pass. Capping the long edge at 2048px keeps a square at 2048²=4.2 MP,
  // safely under that ceiling AND under the 2,500 kB size limit, for ANY aspect.
  forum:  { maxBytes:  2400000, maxDim: 2048 },
};

app.get('/api/immich/download/:id', requireAuth, async (req, res) => {
  const target = SHARE_TARGETS[req.query.size];
  if (!target) {
    // unknown size or 'xlarge' — stream the full original. (not cached)
    try {
      const r = await fetch(`${IMMICH_URL}/assets/${req.params.id}/original`, {
        headers: { 'x-api-key': IMMICH_KEY }
      });
      res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg');
      r.body.pipe(res);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  // Cache lookup. Cache key includes the asset's updatedAt so byte-changes in
  // Immich (LR republishes etc.) auto-invalidate. Old entries become orphans.
  const tag = await _shareCacheTagFor(req.params.id);
  const cachePath = tag
    ? path.join(SHARE_CACHE_DIR, `${req.params.id}-${req.query.size}-${tag}.jpg`)
    : null;

  if (cachePath && fs.existsSync(cachePath)) {
    res.set('Content-Type', 'image/jpeg');
    res.set('X-Cache', 'HIT');
    return res.sendFile(cachePath);
  }

  try {
    const upstream = await fetch(`${IMMICH_URL}/assets/${req.params.id}/original`, {
      headers: { 'x-api-key': IMMICH_KEY }
    });
    if (!upstream.ok) {
      return res.status(upstream.status).send('upstream ' + upstream.status);
    }
    const buf = Buffer.from(await upstream.arrayBuffer());

    const base = sharp(buf, { failOn: 'none' }).resize({
      width: target.maxDim,
      height: target.maxDim,
      fit: 'inside',
      withoutEnlargement: true,
    });

    // Quality-first encode: start at q=95 (highest sane quality with mozjpeg) and
    // only drop if the result exceeds the ceiling. No artificial lower bound — if a
    // smooth image lands well under target, that's the correct answer for that image.
    let q = 95, attempts = 0, out;
    while (attempts++ < 6) {
      out = await base.clone().withMetadata().jpeg({ quality: q, mozjpeg: true }).toBuffer();
      if (out.length <= target.maxBytes) break;
      if (q <= 50) break;
      q = Math.max(50, q - 5);
    }

    // Atomic write to cache (write tmp, rename) — survives concurrent generations.
    if (cachePath) {
      try {
        const tmp = cachePath + '.tmp';
        fs.writeFileSync(tmp, out);
        fs.renameSync(tmp, cachePath);
      } catch (e) {
        console.warn('share cache write failed:', e.message);
      }
    }

    res.set('Content-Type', 'image/jpeg');
    res.set('Content-Length', out.length);
    res.set('X-Encode-Quality', String(q));
    res.set('X-Encode-Attempts', String(attempts));
    res.set('X-Cache', 'MISS');
    res.send(out);
  } catch (e) {
    console.error('share resize error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Filter options cache
const FILTER_CACHE_FILE = '/data/filter-cache.json';

let filterCacheBuilding = false;

function loadFilterCache() {
  try { return JSON.parse(fs.readFileSync(FILTER_CACHE_FILE, 'utf8')); }
  catch(e) { return null; }
}

async function buildFilterCache() {
  if (filterCacheBuilding) return;
  filterCacheBuilding = true;
  console.log('Building filter cache...');
  const cameras = new Set();
  const lenses = new Set();
  const cities = new Set();
  let page = 1;
  while (true) {
    try {
      const r = await fetch(`${IMMICH_URL}/search/metadata`, {
        method: 'POST',
        headers: { 'x-api-key': IMMICH_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ size: 250, page })
      });
      const data = await r.json();
      const items = data.assets?.items || [];
      if (!items.length) break;
      for (const item of items) {
        try {
          const ar = await fetch(`${IMMICH_URL}/assets/${item.id}`, {
            headers: { 'x-api-key': IMMICH_KEY }
          });
          const asset = await ar.json();
          if (asset.exifInfo?.model) cameras.add(asset.exifInfo.model);
          if (asset.exifInfo?.lensModel) lenses.add(asset.exifInfo.lensModel);
          if (asset.exifInfo?.city) cities.add(asset.exifInfo.city);
        } catch(e) {}
        await new Promise(res => setTimeout(res, 20));
      }
      if (items.length < 250) break;
      page++;
    } catch(e) { break; }
  }
  // Fetch people from Immich
  let people = [];
  try {
    const pr = await fetch(`${IMMICH_URL}/people?withHidden=false&size=500`, {
      headers: { 'x-api-key': IMMICH_KEY }
    });
    const pd = await pr.json();
    people = (pd.people || []).filter(p => p.name).map(p => ({ name: p.name, id: p.id }));
  } catch(e) { console.log('People fetch failed:', e.message); }

  const cache = {
    cameras: [...cameras].filter(Boolean).sort(),
    lenses: [...lenses].filter(Boolean).sort(),
    cities: [...cities].filter(Boolean).sort(),
    people,
    builtAt: new Date().toISOString()
  };
  fs.writeFileSync(FILTER_CACHE_FILE, JSON.stringify(cache));
  filterCacheBuilding = false;
  console.log('Filter cache built:', cache.cameras.length, 'cameras,', cache.lenses.length, 'lenses,', cache.cities.length, 'cities,', people.length, 'people');
}

// Refresh just the people list from Immich (fast — single API call).
// Used by the Library "Full sweep" button to surface newly-tagged faces
// without a full filter-cache rebuild. Camera/lens/city stays cached.
app.post('/api/filters/refresh-people', requireAuth, async (req, res) => {
  try {
    const cache = loadFilterCache() || { cameras: [], lenses: [], cities: [], people: [], builtAt: new Date().toISOString() };
    const pr = await fetch(`${IMMICH_URL}/people?withHidden=false&size=500`, {
      headers: { 'x-api-key': IMMICH_KEY }
    });
    const pd = await pr.json();
    cache.people = (pd.people || []).filter(p => p.name).map(p => ({ name: p.name, id: p.id }));
    fs.writeFileSync(FILTER_CACHE_FILE, JSON.stringify(cache));
    console.log('People refreshed:', cache.people.length);
    res.json({ ok: true, count: cache.people.length });
  } catch (e) {
    console.log('refresh-people failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/immich/filter-options', requireAuth, async (req, res) => {
  const cache = loadFilterCache();
  if (!cache) {
    buildFilterCache();
    res.json({ cameras: [], lenses: [], cities: [], people: [], building: true });
  } else {
    const age = Date.now() - new Date(cache.builtAt).getTime();
    if (age > 24 * 60 * 60 * 1000 && !filterCacheBuilding) buildFilterCache();
    // If cache has no people, fetch them now and return with cache
    if (!cache.people) {
      try {
        const pr = await fetch(`${IMMICH_URL}/people?withHidden=false&size=500`, {
          headers: { 'x-api-key': IMMICH_KEY }
        });
        const pd = await pr.json();
        cache.people = (pd.people || []).filter(p => p.name).map(p => ({ name: p.name, id: p.id }));
      } catch(e) { cache.people = []; }
    }
    res.json(cache);
  }
});

// Server-side text search across metadata
app.post('/api/immich/text-search', requireAuth, async (req, res) => {
  const { query, size = 60, page = 1, model, lensModel, city, personId = null } = req.body;
  try {
    const chips = {};
    if (model) chips.model = model;
    if (lensModel) chips.lensModel = lensModel;
    if (city) chips.city = city;
    if (personId) chips.personIds = [personId];
    const meta = (fields) => fetch(`${IMMICH_URL}/search/metadata`, {
      method: 'POST',
      headers: { 'x-api-key': IMMICH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ size, page, ...chips, ...fields })
    });
    // Search across fields — skip fields already occupied by a chip filter
    const searches = [
      !chips.lensModel && meta({ lensModel: query }),
      meta({ make: query }),
      !chips.model && meta({ model: query }),
      !chips.city && meta({ city: query }),
      meta({ description: query }),
      meta({ originalFileName: query }),
    ].filter(Boolean);

    const results = await Promise.all(searches.map(p => p.then(r => r.json()).catch(() => ({assets:{items:[]}}))));

    // Merge and deduplicate by id
    const seen = new Set();
    const items = [];
    for (const r of results) {
      for (const a of (r.assets?.items || [])) {
        if (!seen.has(a.id)) {
          seen.add(a.id);
          items.push(mapAssetWithMeta(a));
        }
      }
    }

    // Also match the local title index — IPTC ObjectName lives only in JPEG
    // headers and Immich's API doesn't expose it. The title index is built
    // by a background backfill in fetchAssetTitle.
    const titleHits = searchTitleIndex(query).filter(t => !seen.has(t.id));
    if (titleHits.length) {
      const titleAssets = await Promise.all(
        titleHits.slice(0, 30).map(t =>
          fetch(`${IMMICH_URL}/assets/${t.id}`, { headers: { 'x-api-key': IMMICH_KEY } })
            .then(r => r.ok ? r.json() : null).catch(() => null)
        )
      );
      for (const a of titleAssets) {
        if (a && !seen.has(a.id)) {
          seen.add(a.id);
          items.push(mapAssetWithMeta(a));
        }
      }
    }

    // Match tag names — find any tag whose name contains the query
    // (case-insensitive substring), then search by those tagIds. Lets
    // "trestle" find photos tagged "Trestle" or "trestle-railroad".
    try {
      const tagsR = await fetch(`${IMMICH_URL}/tags`, { headers: { 'x-api-key': IMMICH_KEY } });
      const allTags = await tagsR.json();
      const needle = query.toLowerCase();
      const matched = (Array.isArray(allTags) ? allTags : [])
        .filter(t => t.name && t.name.toLowerCase().includes(needle));
      if (matched.length) {
        const tagR = await fetch(`${IMMICH_URL}/search/metadata`, {
          method: 'POST',
          headers: { 'x-api-key': IMMICH_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ tagIds: matched.map(t => t.id), size, page })
        });
        const tagData = await tagR.json();
        for (const a of (tagData.assets?.items || [])) {
          if (!seen.has(a.id)) {
            seen.add(a.id);
            items.push(mapAssetWithMeta(a));
          }
        }
      }
    } catch(e) { /* tag search is additive — failure is non-fatal */ }

    res.json({ assets: items, total: items.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Smart search (CLIP)
app.post('/api/immich/smart-search', requireAuth, async (req, res) => {
  const { query, size = 60, page = 1, model, lensModel, city, personId = null } = req.body;
  try {
    const body = { query, size, page };
    if (model) body.model = model;
    if (lensModel) body.lensModel = lensModel;
    if (city) body.city = city;
    if (personId) body.personIds = [personId];
    const r = await fetch(`${IMMICH_URL}/search/smart`, {
      method: 'POST',
      headers: { 'x-api-key': IMMICH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    const items = (data.assets && data.assets.items) || [];
    res.json({ assets: items.map(mapAssetWithMeta)});
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Multi-field combined search (for filter chips AND logic)
app.post('/api/immich/combined-search', requireAuth, async (req, res) => {
  const { cameras = [], lenses = [], cities = [], unknowns = [], personId = null, size = 60, page = 1 } = req.body;
  try {
    // For unknown chips, detect category by trying each field and seeing which returns results
    let resolvedCameras = [...cameras];
    let resolvedLenses = [...lenses];
    let resolvedCities = [...cities];

    if (unknowns.length) {
      await Promise.all(unknowns.map(async chip => {
        const searches = [
          { field: 'model', body: { size: 1, page: 1, model: chip } },
          { field: 'lensModel', body: { size: 1, page: 1, lensModel: chip } },
          { field: 'city', body: { size: 1, page: 1, city: chip } },
        ];
        for (const s of searches) {
          const r = await fetch(`${IMMICH_URL}/search/metadata`, {
            method: 'POST',
            headers: { 'x-api-key': IMMICH_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify(s.body)
          });
          const d = await r.json();
          if ((d.assets?.items || []).length > 0) {
            if (s.field === 'model') resolvedCameras.push(chip);
            else if (s.field === 'lensModel') resolvedLenses.push(chip);
            else if (s.field === 'city') resolvedCities.push(chip);
            break;
          }
        }
      }));
    }

    const cameraList = resolvedCameras.length ? resolvedCameras : [null];
    const lensList = resolvedLenses.length ? resolvedLenses : [null];
    const cityList = resolvedCities.length ? resolvedCities : [null];

    const searches = [];
    for (const cam of cameraList) {
      for (const lens of lensList) {
        for (const city of cityList) {
          const body = { size, page, type: 'IMAGE' };
          if (cam) body.model = cam;
          if (lens) body.lensModel = lens;
          if (city) body.city = city;
          if (personId) body.personIds = [personId];
          searches.push(body);
        }
      }
    }

    const results = await Promise.all(searches.map(body =>
      fetch(`${IMMICH_URL}/search/metadata`, {
        method: 'POST',
        headers: { 'x-api-key': IMMICH_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(r => r.json()).then(d => (d.assets && d.assets.items) || []).catch(() => [])
    ));

    const seen = new Set();
    const items = [];
    for (const result of results) {
      for (const a of result) {
        if (!seen.has(a.id)) {
          seen.add(a.id);
          items.push(mapAssetWithMeta(a));
        }
      }
    }
    res.json({ assets: items, total: items.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Tag search — find all Immich assets carrying a given tag (by name).
// LR keywords sync to Immich tags via the lr-immich plugin; clicking a
// tag chip in the library detail view hits this endpoint to filter the
// library grid to other photos sharing that tag.
//
// Two-step on the Immich side:
//   1. GET /api/tags to resolve name → tagId
//   2. POST /search/metadata with tagIds:[tagId]
app.post('/api/immich/tag-search', requireAuth, async (req, res) => {
  const { tag, size = 60, page = 1 } = req.body;
  if (!tag) return res.json({ assets: [], total: 0 });
  try {
    const tagsR = await fetch(`${IMMICH_URL}/tags`, {
      headers: { 'x-api-key': IMMICH_KEY }
    });
    const allTags = await tagsR.json();
    const match = (Array.isArray(allTags) ? allTags : []).find(t => t.name === tag);
    if (!match) return res.json({ assets: [], total: 0 });

    const r = await fetch(`${IMMICH_URL}/search/metadata`, {
      method: 'POST',
      headers: { 'x-api-key': IMMICH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tagIds: [match.id], size, page })
    });
    const data = await r.json();
    const items = (data.assets && data.assets.items) || [];
    res.json({
      assets: items.map(mapAssetWithMeta),
      total: data.assets?.total || items.length
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Person/face search
app.post('/api/immich/person-search', requireAuth, async (req, res) => {
  const { personId, size = 60, page = 1 } = req.body;
  try {
    const r = await fetch(`${IMMICH_URL}/search/metadata`, {
      method: 'POST',
      headers: { 'x-api-key': IMMICH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ personIds: [personId], size, page })
    });
    const data = await r.json();
    const items = (data.assets && data.assets.items) || [];
    res.json({ assets: items.map(mapAssetWithMeta), total: data.assets?.total || 0 });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Reverse geocode
app.get('/api/geocode', requireAuth, async (req, res) => {
  const { lat, lon } = req.query;
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`, {
      headers: { 'User-Agent': 'darkroom-log/1.0' }
    });
    const data = await r.json();
    const addr = data.address || {};
    const location = [addr.suburb || addr.neighbourhood || addr.city_district, addr.city || addr.town || addr.village, addr.state].filter(Boolean).join(', ');
    res.json({ location });
  } catch(e) {
    res.json({ location: '' });
  }
});

// Prints CRUD
app.get('/api/prints', requireAuth, (req, res) => {
  const data = loadData();
  data.forEach(p => {
    if (p.sessions && p.sessions.length > 1) {
      p.sessions.sort((a, b) => Number(b.id) - Number(a.id));
    }
  });
  res.json(data);
});

app.get('/api/prints/:immichId', requireAuth, (req, res) => {
  const data = loadData();
  const prints = data.filter(p => p.immichId === req.params.immichId);
  res.json(prints);
});

app.post('/api/prints', requireAuth, (req, res) => {
  const data = loadData();
  const print = {
    id: Date.now().toString(),
    immichId: req.body.immichId,
    filename: req.body.filename,
    title: req.body.title,
    date: req.body.date || new Date().toISOString().split('T')[0],
    sessions: req.body.sessions || [],
    createdAt: new Date().toISOString()
  };
  data.push(print);
  saveData(data);
  res.json(print);
});

app.put('/api/prints/:id', requireAuth, (req, res) => {
  const data = loadData();
  const idx = data.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  data[idx] = { ...data[idx], ...req.body, id: req.params.id };
  saveData(data);
  res.json(data[idx]);
});

app.post('/api/prints/:id/sessions', requireAuth, (req, res) => {
  const data = loadData();
  const idx = data.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const session = {
    id: Date.now().toString(),
    date: req.body.date || new Date().toISOString().split('T')[0],
    enlarger: req.body.enlarger,
    lens: req.body.lens,
    paper: req.body.paper,
    printSize: req.body.printSize,
    technique: req.body.technique,
    grade: req.body.grade,
    gradeOO: req.body.gradeOO,
    grade5: req.body.grade5,
    fStop: req.body.fStop,
    time: req.body.time,
    dodgeBurn: req.body.dodgeBurn,
    notes: req.body.notes
  };
  data[idx].sessions = data[idx].sessions || [];
  data[idx].sessions.push(session);
  saveData(data);
  res.json(session);
});

app.delete('/api/prints/:id/sessions/:sessionId', requireAuth, (req, res) => {
  const data = loadData();
  const idx = data.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  data[idx].sessions = data[idx].sessions.filter(s => s.id !== req.params.sessionId);
  saveData(data);
  res.json({ success: true });
});

app.delete('/api/prints/:id', requireAuth, (req, res) => {
  let data = loadData();
  data = data.filter(p => p.id !== req.params.id);
  saveData(data);
  res.json({ success: true });
});

// ── ALBUMS ──────────────────────────────────────────────────────────────────

// GET all albums
app.get('/api/albums', requireAuth, (req, res) => res.json(loadAlbums()));

// POST create album
app.post('/api/albums', requireAuth, (req, res) => {
  const albums = loadAlbums();
  const { title } = req.body;
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
  let slug = slugify(title);
  // ensure unique slug
  if (albums.find(a => a.slug === slug)) slug = slug + '-' + id.slice(-4);
  const now = new Date().toISOString();
  const album = { id, title, slug, assets: [], createdAt: now, updatedAt: now };
  albums.push(album);
  saveAlbums(albums);
  res.json(album);
});

// PUT update album (title, assets order)
app.put('/api/albums/:id', requireAuth, (req, res) => {
  const albums = loadAlbums();
  const idx = albums.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const { title, assets, slideshowSettings, updateSlug } = req.body;
  if (title !== undefined) {
    albums[idx].title = title;
    // The slug is the public /album/<slug> URL (also used by the lakatua.me
    // embed), so a rename must NOT change it unless the caller explicitly opts
    // in — otherwise existing share links/embeds silently 404.
    if (updateSlug) {
      let slug = slugify(title);
      if (albums.find((a, i) => i !== idx && a.slug === slug)) slug = slug + '-' + req.params.id.slice(-4);
      albums[idx].slug = slug;
    }
  }
  if (assets !== undefined) albums[idx].assets = assets;
  if (slideshowSettings !== undefined) albums[idx].slideshowSettings = slideshowSettings;
  // Bump updatedAt on any edit (rename, reorder, add/remove photos, slideshow
  // settings) so the Albums tab can sort by "recently updated".
  albums[idx].updatedAt = new Date().toISOString();
  saveAlbums(albums);
  res.json(albums[idx]);
});

// DELETE album
app.delete('/api/albums/:id', requireAuth, (req, res) => {
  let albums = loadAlbums();
  albums = albums.filter(a => a.id !== req.params.id);
  saveAlbums(albums);
  res.json({ success: true });
});

// Permanently delete assets (bypass trash) — must be before /:id to avoid Express param shadowing
app.delete('/api/immich/assets/permanent', requireAuth, async (req, res) => {
  try {
    const { ids = [] } = req.body;
    const r = await fetch(`${IMMICH_URL}/assets`, {
      method: 'DELETE',
      headers: { 'x-api-key': IMMICH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, force: true })
    });
    if (!r.ok) return res.status(r.status).json({ error: 'Immich permanent delete failed' });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Move Immich asset to trash (force: false = 30-day soft delete)
app.delete('/api/immich/assets/:id', requireAuth, async (req, res) => {
  try {
    const r = await fetch(`${IMMICH_URL}/assets`, {
      method: 'DELETE',
      headers: { 'x-api-key': IMMICH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [req.params.id], force: false })
    });
    if (!r.ok) return res.status(r.status).json({ error: 'Immich delete failed' });
    // Also remove from any local albums
    const albums = loadAlbums();
    albums.forEach(a => { a.assets = a.assets.filter(id => id !== req.params.id); });
    saveAlbums(albums);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUBLIC album view (no auth)
app.get('/api/public/album/:slug', (req, res) => {
  const albums = loadAlbums();
  const album = albums.find(a => a.slug === req.params.slug);
  if (!album) return res.status(404).json({ error: 'Not found' });
  res.json({ id: album.id, title: album.title, slug: album.slug, assets: album.assets, cover: album.cover || album.assets[0] || null, slideshowSettings: album.slideshowSettings || {} });
});

// PUBLIC thumbnail proxy (no auth) - needed for public album view
app.get('/api/public/thumb/:id', async (req, res) => {
  try {
    // Grid cells request ?size=thumbnail (small WebP, ~10-40 KB) so the shared
    // album view doesn't pull ~600 KB previews per cell on cellular. Default
    // stays preview — the slideshow bg, lightbox preview stage and embed-hero
    // all rely on the larger ~1440px image.
    const size = req.query.size === 'thumbnail' ? 'thumbnail' : 'preview';
    const r = await fetch(`${IMMICH_URL}/assets/${req.params.id}/thumbnail?size=${size}`, {
      headers: { 'x-api-key': IMMICH_KEY }
    });
    res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=2592000');
    r.body.pipe(res);
  } catch(e) { res.status(500).end(); }
});

// PUBLIC forum-embed proxy — clean .jpg URL for BBCode [img] tags (Fred
// Miranda, etc.). Filename pattern is <assetId>.jpg so any forum's image
// detector recognizes it. Stable across Immich share-key rotations because
// the proxy holds the admin API key server-side; only Immich asset_id needs
// to stay constant for the URL to survive. Built to replace Flickr embeds
// that were being broken by platform-side secret rotations.
app.get('/embed/:filename', async (req, res) => {
  // Accept both <id>.jpg and <id>-<width>.jpg. Filename-based sizing avoids
  // forum BBCode parsers that truncate URLs at "?" (Fred Miranda does this:
  // ?w=800 leaks outside the [img] tag). Query string still works as backup.
  const m = req.params.filename.match(/^([0-9a-f-]{32,36})(?:-(\d{3,4}))?\.jpe?g$/i);
  if (!m) return res.status(400).send('bad filename');
  const id = m[1];
  // Default 1600px. The old Flickr "_b" 1024 came from a 2048px LR export
  // (2× downscale → minimal blur). Our pipeline pulls 6800+px originals, so
  // 1024 = 6.7× downscale, soft. 1600 = 4.3× downscale, retains detail
  // naturally with only invisible sharpening. Override via filename suffix
  // (<id>-1024.jpg, <id>-2048.jpg) or ?w= query. Capped at 2400.
  let width = parseInt(m[2] || req.query.w, 10);
  if (!Number.isFinite(width) || width < 100 || width > 2400) width = 1600;
  try {
    // Fetch the ORIGINAL from Immich, not /thumbnail?size=preview. Immich's
    // preview is itself a downscaled lossy JPEG (~1440px); resizing that to
    // 1024 compounds two rounds of resampling + recompression and the embed
    // ends up soft. Pulling the original means sharp does a single high-
    // quality downscale. Cache-Control headers below mean the cost is paid
    // once per asset; subsequent forum hits are CDN-served.
    const r = await fetch(`${IMMICH_URL}/assets/${id}/original`, {
      headers: { 'x-api-key': IMMICH_KEY }
    });
    if (!r.ok) return res.status(r.status).end();
    const buf = Buffer.from(await r.arrayBuffer());
    // Size-conditional output sharpening (three tiers). Source ~6800px:
    //   - width ≤ 1200 → 5.7×+ downscale. Apply max USM (sigma=0.9, m1=0,
    //     m2=3). Closest LR analog: "Sharpen for Screen — Standard." Picked
    //     0.9 over 1.0 after side-by-side: 1.0 just edged into "processed"
    //     territory on high-contrast edges; 0.9 holds the line.
    //   - 1200 < width ≤ 1280 → 5.3× downscale. Flickr-style mild USM
    //     (sigma=0.5, m1=0, m2=2). Same recipe Flickr uses on its "_b" 1024
    //     size — visible edges, no halos. Keeps existing 1280 renders stable.
    //   - width > 1280 (1400, 1600, 2048, 2400) → ≤4.9× downscale; lanczos3
    //     produces clean edges naturally and any USM reads as "processed."
    // m1=0 across both sharpening tiers means flat areas (skies, OOF foliage)
    // are not sharpened, so no grain crunch. Quality 95 + mozjpeg + 4:4:4
    // chroma preserve post-resize detail. sRGB ICC for color-accurate view.
    let pipeline = sharp(buf, { failOn: 'none' })
      .resize({ width, withoutEnlargement: true, kernel: 'lanczos3' });
    if (width <= 1200) {
      pipeline = pipeline.sharpen({ sigma: 0.9, m1: 0, m2: 3 });
    } else if (width <= 1280) {
      pipeline = pipeline.sharpen({ sigma: 0.5, m1: 0, m2: 2 });
    }
    const out = await pipeline
      .withMetadata({ icc: 'srgb' })
      .jpeg({ quality: 95, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toBuffer();
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.end(out);
  } catch(e) { res.status(502).end(); }
});

// PUBLIC original proxy (no auth)
app.get('/api/public/original/:id', async (req, res) => {
  try {
    const r = await fetch(`${IMMICH_URL}/assets/${req.params.id}/original`, {
      headers: { 'x-api-key': IMMICH_KEY }
    });
    res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    r.body.pipe(res);
  } catch(e) { res.status(500).end(); }
});

// PUBLIC display-sized variant (no auth) — for slideshow body. Pulls the
// Immich original and downscales via sharp. Default 1920px; width can be
// encoded in the filename as <uuid>-<width>.jpg (preferred — keeps the URL
// extension `.jpg` so Cloudflare edge-caches it) or as ?w= query (fallback).
// Slideshow JS adapts width to network conditions, so good wifi → 1920
// (~600KB), poor wifi → 1280 or 960 (~150-300KB). Originals stay on
// /api/public/original/:id for the lightbox + zoom view where pixel-peeping
// matters.
//
// Cache-key matters here: Cloudflare's default cacheable-asset rules key off
// file extension. A path like /api/public/display/<uuid>-1920.jpg gets a CF
// edge HIT after the first viewer warms it; /api/public/display/<uuid>?w=
// would bypass CF cache and re-run sharp on every request.
//
// Quality/chroma tuned slightly looser than /embed (q88, 4:2:0) since slide
// duration is too short for pixel-peeping and bytes-on-wire is the constraint.
//
// v1.5.70: in-memory LRU variant cache + in-flight dedupe. Without it, every
// cache-missing client (new browser, CF edge miss, incognito) paid the full
// original-fetch + sharp resize (~1.1s solo, ~3.5s when the slideshow's
// look-ahead preloads run concurrently) PER IMAGE — first-pass slideshows
// looked lumpy because each swap arrived late by a different amount. Now the
// pipeline runs once per id+width per 24h; everyone else gets buffer replay.
const _dispCache = new Map();      // key "id-width" -> { buf, ts } (Map = insertion-ordered, oldest first)
const _dispInFlight = new Map();   // key -> Promise<Buffer> (dedupes concurrent generation)
let _dispCacheBytes = 0;
const DISP_CACHE_MAX_BYTES = 128 * 1024 * 1024;  // ~200 variants at 1920px
const DISP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;   // matches Cache-Control max-age

function _dispCacheGet(key) {
  const e = _dispCache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > DISP_CACHE_TTL_MS) {
    _dispCache.delete(key);
    _dispCacheBytes -= e.buf.length;
    return null;
  }
  // LRU bump: re-insert so eviction walks true least-recently-used order
  _dispCache.delete(key);
  _dispCache.set(key, e);
  return e.buf;
}
function _dispCachePut(key, buf) {
  const old = _dispCache.get(key);
  if (old) { _dispCacheBytes -= old.buf.length; _dispCache.delete(key); }
  _dispCache.set(key, { buf, ts: Date.now() });
  _dispCacheBytes += buf.length;
  while (_dispCacheBytes > DISP_CACHE_MAX_BYTES && _dispCache.size > 1) {
    const k = _dispCache.keys().next().value;
    _dispCacheBytes -= _dispCache.get(k).buf.length;
    _dispCache.delete(k);
  }
}

app.get('/api/public/display/:filename', async (req, res) => {
  const m = req.params.filename.match(/^([0-9a-f-]{32,36})(?:-(\d{3,4}))?\.jpe?g$/i);
  if (!m) return res.status(400).send('bad filename');
  const id = m[1];
  let width = parseInt(m[2] || req.query.w, 10);
  if (!Number.isFinite(width) || width < 480 || width > 2400) width = 1920;
  const key = `${id}-${width}`;
  try {
    let out = _dispCacheGet(key);
    const hit = !!out;
    if (!out) {
      let p = _dispInFlight.get(key);
      if (!p) {
        p = (async () => {
          const r = await fetch(`${IMMICH_URL}/assets/${id}/original`, {
            headers: { 'x-api-key': IMMICH_KEY }
          });
          if (!r.ok) { const err = new Error('immich ' + r.status); err.status = r.status; throw err; }
          const buf = Buffer.from(await r.arrayBuffer());
          let pipeline = sharp(buf, { failOn: 'none' })
            .resize({ width, withoutEnlargement: true, kernel: 'lanczos3' });
          if (width <= 1200) {
            pipeline = pipeline.sharpen({ sigma: 0.8, m1: 0, m2: 3 });
          } else if (width <= 1600) {
            pipeline = pipeline.sharpen({ sigma: 0.5, m1: 0, m2: 2 });
          }
          return pipeline
            .withMetadata({ icc: 'srgb' })
            .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: '4:2:0' })
            .toBuffer();
        })();
        _dispInFlight.set(key, p);
        p.finally(() => _dispInFlight.delete(key)).catch(() => {});
      }
      out = await p;
      if (!_dispCache.has(key)) _dispCachePut(key, out);
    }
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.set('X-Disp-Cache', hit ? 'hit' : 'miss');
    res.end(out);
  } catch(e) { res.status(e.status || 502).end(); }
});

// PUBLIC photo metadata (no auth) - for public album description display
app.get('/api/public/photo/:id', async (req, res) => {
  try {
    const r = await fetch(`${IMMICH_URL}/assets/${req.params.id}`, {
      headers: { 'x-api-key': IMMICH_KEY }
    });
    const data = await r.json();
    const exif = data.exifInfo || {};
    // Title comes from JPEG IPTC ObjectName (Immich's API doesn't expose it).
    // fetchAssetTitle is cached by id+updatedAt so subsequent slideshow
    // ticks across the same asset hit cache.
    const title = await fetchAssetTitle(req.params.id, data.updatedAt || data.fileModifiedAt);
    res.json({
      title: title || '',
      description: exif.description || '',
      make: exif.make || '',
      model: exif.model || '',
      lens: exif.lensModel || '',
      fNumber: exif.fNumber || '',
      shutterSpeed: exif.exposureTime || '',
      iso: exif.iso || '',
      focalLength: exif.focalLength || '',
      takenAt: data.localDateTime || data.fileCreatedAt || '',
      city: exif.city || '',
      state: exif.state || '',
      country: exif.country || ''
    });
  } catch(e) { res.json({ description: '', title: '' }); }
});

// Serve public album page
app.get('/album/:slug', async (req, res) => {
  // Tell Cloudflare + browsers not to edge-cache the HTML so meta-tag /
  // script-tag updates land immediately. The JS/CSS files referenced
  // FROM this HTML are still cache-busted via ?v=N suffixes.
  res.set('Cache-Control', 'no-cache, must-revalidate');
  const albums = loadAlbums();
  const album = albums.find(a => a.slug === req.params.slug);
  const html = fs.readFileSync(path.join(__dirname, 'public', 'album.html'), 'utf8');
  if (!album) return res.send(html);
  const base = `https://${req.get('host')}`;
  const coverId = album.cover || album.assets[0];

  const imgTags = [];
  if (coverId) {
    const url = `${base}/api/public/thumb/${coverId}`;
    imgTags.push(`<meta property="og:image" content="${url}">`);
    imgTags.push(`<meta property="og:image:secure_url" content="${url}">`);
    imgTags.push(`<meta property="og:image:type" content="image/jpeg">`);
    try {
      const r = await fetch(`${IMMICH_URL}/assets/${coverId}`, {
        headers: { 'x-api-key': IMMICH_KEY },
        signal: AbortSignal.timeout(2000)
      });
      const data = await r.json();
      const w = data.exifInfo?.exifImageWidth;
      const h = data.exifInfo?.exifImageHeight;
      if (w && h) {
        imgTags.push(`<meta property="og:image:width" content="${w}">`);
        imgTags.push(`<meta property="og:image:height" content="${h}">`);
        imgTags.push(`<meta property="og:image:alt" content="${album.title}">`);
      }
    } catch(e) {}
  }

  const tags = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${base}/album/${album.slug}">`,
    `<meta property="og:title" content="${album.title}">`,
    `<meta property="og:description" content="View the full album on Darkroom Log">`,
    ...imgTags,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].filter(Boolean).join('\n');
  res.send(html.replace('</head>', `${tags}\n</head>`));
});

// Sitemap for search engines
app.get('/sitemap.xml', (req, res) => {
  const base = `https://${req.get('host')}`;
  const albums = loadAlbums();
  let lastmod;
  try { lastmod = fs.statSync(ALBUMS_FILE).mtime.toISOString().slice(0, 10); } catch(e) {}
  const urls = [
    { loc: `${base}/`, priority: '1.0' },
    ...albums.map(a => ({ loc: `${base}/album/${a.slug}`, priority: '0.8' }))
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;
  res.set('Content-Type', 'application/xml');
  res.send(xml);
});



// List music files
app.get('/api/albums/music-list', requireAuth, (req, res) => {
  const dir = '/music';
  try {
    fs.mkdirSync(dir, { recursive: true });
    const files = [];
    const scan = (d, prefix) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        const rel = prefix ? prefix + '/' + entry.name : entry.name;
        if (entry.isDirectory()) scan(full, rel);
        else if (entry.name.match(/\.(mp3|m4a|ogg|wav|flac)$/i)) files.push(rel);
      }
    };
    scan(dir, '');
    res.json({ files: files.sort() });
  } catch(e) { res.json({ files: [] }); }
});

// Upload music for slideshow
app.post('/api/albums/music', requireAuth, uploadMusic.single('music'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ filename: req.file.filename });
});

// Serve music file (public - needed for shared slideshows)
app.get('/api/albums/music/*', (req, res) => {
  const filename = req.params[0];
  const file = path.join('/music', filename);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});

// ── IMMICH ALBUMS (browse Immich albums including archived assets) ──────────

app.get('/api/immich/immich-albums', requireAuth, async (req, res) => {
  try {
    const r = await fetch(`${IMMICH_URL}/albums`, { headers: { 'x-api-key': IMMICH_KEY } });
    const data = await r.json();
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/immich/immich-albums/:id', requireAuth, async (req, res) => {
  try {
    const r = await fetch(`${IMMICH_URL}/albums/${req.params.id}`, {
      headers: { 'x-api-key': IMMICH_KEY }
    });
    const data = await r.json();
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Create a new Immich album and optionally add assets to it
app.post('/api/immich/immich-albums', requireAuth, async (req, res) => {
  try {
    const { albumName, assetIds = [] } = req.body;
    const r = await fetch(`${IMMICH_URL}/albums`, {
      method: 'POST',
      headers: { 'x-api-key': IMMICH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ albumName, assetIds })
    });
    if (!r.ok) return res.status(r.status).json({ error: 'Immich create album failed' });
    const data = await r.json();
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Fetch all archived assets
app.get('/api/immich/archived', requireAuth, async (req, res) => {
  try {
    const r = await fetch(`${IMMICH_URL}/search/metadata`, {
      method: 'POST',
      headers: { 'x-api-key': IMMICH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility: 'archive', size: 1000, page: 1 })
    });
    const data = await r.json();
    res.json({ assets: data.assets?.items || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Fetch trashed assets via timeline API (search/metadata doesn't support trash visibility)
app.get('/api/immich/trash', requireAuth, async (req, res) => {
  try {
    const bucketsR = await fetch(`${IMMICH_URL}/timeline/buckets?isTrashed=true&size=1000`, {
      headers: { 'x-api-key': IMMICH_KEY }
    });
    const buckets = await bucketsR.json();
    const assetArrays = await Promise.all(buckets.map(async bucket => {
      const r = await fetch(`${IMMICH_URL}/timeline/bucket?isTrashed=true&timeBucket=${bucket.timeBucket}&size=1000`, {
        headers: { 'x-api-key': IMMICH_KEY }
      });
      const data = await r.json();
      const ids = data.id || [];
      const createdAts = data.fileCreatedAt || [];
      return ids.map((id, i) => ({ id, fileCreatedAt: createdAts[i], createdAt: createdAts[i] }));
    }));
    res.json({ assets: assetArrays.flat() });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Restore assets from trash
app.post('/api/immich/assets/restore-trash', requireAuth, async (req, res) => {
  try {
    const { ids = [] } = req.body;
    const r = await fetch(`${IMMICH_URL}/trash/restore/assets`, {
      method: 'POST',
      headers: { 'x-api-key': IMMICH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    if (!r.ok) return res.status(r.status).json({ error: 'Immich restore from trash failed' });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// Delete an Immich album (does not delete assets from library)
app.delete('/api/immich/immich-albums/:id', requireAuth, async (req, res) => {
  try {
    const r = await fetch(`${IMMICH_URL}/albums/${req.params.id}`, {
      method: 'DELETE',
      headers: { 'x-api-key': IMMICH_KEY }
    });
    if (!r.ok) return res.status(r.status).json({ error: 'Immich delete album failed' });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Add assets to an existing Immich album
app.put('/api/immich/immich-albums/:id/assets', requireAuth, async (req, res) => {
  try {
    const { ids = [] } = req.body;
    const r = await fetch(`${IMMICH_URL}/albums/${req.params.id}/assets`, {
      method: 'PUT',
      headers: { 'x-api-key': IMMICH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    if (!r.ok) return res.status(r.status).json({ error: 'Immich add assets failed' });
    const data = await r.json();
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Remove assets from an Immich album (does not delete assets from library)
app.delete('/api/immich/immich-albums/:id/assets', requireAuth, async (req, res) => {
  try {
    const { ids = [] } = req.body;
    const r = await fetch(`${IMMICH_URL}/albums/${req.params.id}/assets`, {
      method: 'DELETE',
      headers: { 'x-api-key': IMMICH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    if (!r.ok) return res.status(r.status).json({ error: 'Immich remove assets failed' });
    const data = await r.json();
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Archive assets — hides them from the main library (isArchived: true).
// Immich's bulk-update endpoint returns 204 No Content with an empty body, so
// calling r.json() on it throws "Unexpected end of JSON input" — that was
// landing us in the catch → 500, which the client surfaced as "Archive failed"
// even though the archive on the Immich side actually succeeded. End the
// response with 204 instead of trying to parse a body that isn't there.
app.put('/api/immich/assets/archive', requireAuth, async (req, res) => {
  try {
    const { ids = [] } = req.body;
    const r = await fetch(`${IMMICH_URL}/assets`, {
      method: 'PUT',
      headers: { 'x-api-key': IMMICH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, isArchived: true })
    });
    if (!r.ok) return res.status(r.status).json({ error: 'Immich archive failed' });
    res.status(204).end();
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Restore assets from archive (isArchived: false). Same 204-no-body shape as
// archive above — don't try to parse the response.
app.put('/api/immich/assets/restore', requireAuth, async (req, res) => {
  try {
    const { ids = [] } = req.body;
    const r = await fetch(`${IMMICH_URL}/assets`, {
      method: 'PUT',
      headers: { 'x-api-key': IMMICH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, isArchived: false })
    });
    if (!r.ok) return res.status(r.status).json({ error: 'Immich restore failed' });
    res.status(204).end();
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Settings: get configured Immich album IDs (UI overrides env var IMMICH_ALBUMS)
app.get('/api/settings/immich-albums', requireAuth, (req, res) => {
  const settings = loadSettings();
  const envAlbums = process.env.IMMICH_ALBUMS
    ? process.env.IMMICH_ALBUMS.split(',').map(s => s.trim()).filter(Boolean)
    : [];
  res.json({ albums: settings.immichAlbums !== undefined ? settings.immichAlbums : envAlbums });
});

app.post('/api/settings/immich-albums', requireAuth, (req, res) => {
  const settings = loadSettings();
  settings.immichAlbums = req.body.albums || [];
  saveSettings(settings);
  res.json({ success: true });
});

// Serve SPA
app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Darkroom Log running on port ${PORT}`);
});
