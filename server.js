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
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const PASSWORD_HASH = process.env.PASSWORD_HASH || bcrypt.hashSync(process.env.APP_PASSWORD || 'darkroom', 10);
const IMMICH_URL = process.env.IMMICH_URL || 'http://192.168.0.10:2283/api';
const IMMICH_KEY = process.env.IMMICH_KEY || '';
const DATA_FILE = '/data/prints.json';
const ALBUMS_FILE = '/data/albums.json';
const SETTINGS_FILE = '/data/settings.json';

// Public-album branding — set via env so the repo stays generic. Leave blank to hide the brand block.
const BRAND_NAME = process.env.BRAND_NAME || '';
const BRAND_URL = process.env.BRAND_URL || '';
const BRAND_SITE_LABEL = process.env.BRAND_SITE_LABEL || '';
// Space-separated list of origins allowed to embed the public album (beyond 'self').
const CSP_FRAME_ANCESTORS = process.env.CSP_FRAME_ANCESTORS || '';

// Ensure data files exist
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify([]));
if (!fs.existsSync(ALBUMS_FILE)) fs.writeFileSync(ALBUMS_FILE, JSON.stringify([]));

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
    "frame-ancestors 'self'" + (CSP_FRAME_ANCESTORS ? ' ' + CSP_FRAME_ANCESTORS : '') + ";"
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

// Immich proxy - search photos
app.get('/api/immich/search', requireAuth, async (req, res) => {
  const { q } = req.query;
  try {
    const response = await fetch(`${IMMICH_URL}/search/metadata`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': IMMICH_KEY
      },
      body: JSON.stringify({ originalFileName: q, size: 20 })
    });
    const data = await response.json();
    const items = (data.assets?.items || []).map(a => ({
      id: a.id,
      filename: a.originalFileName,
      takenAt: a.fileCreatedAt,
      width: a.width,
      height: a.height
    }));
    res.json(items);
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
    res.json({
      id: data.id,
      filename: data.originalFileName,
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
    isArchived: a.isArchived || false
  };
}

// Immich proxy - recent uploads
app.get('/api/immich/recent', requireAuth, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const size = parseInt(req.query.size) || 500;
  const sort = req.query.sort || 'upload';
  const dir = req.query.dir || 'desc';
  try {
    let allItems = [];
    if (sort === 'taken') {
      const order = dir === 'asc' ? 'asc' : 'desc';
      const r = await fetch(`${IMMICH_URL}/search/metadata`, {
        method: 'POST',
        headers: { 'x-api-key': IMMICH_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ size, page, order })
      });
      const data = await r.json();
      allItems = (data.assets && data.assets.items) || [];
      res.json({ assets: allItems.map(mapAssetWithMeta), total: data.assets?.total || 0 });
      return;
    }
    const r = await fetch(`${IMMICH_URL}/search/metadata`, {
      method: 'POST',
      headers: { 'x-api-key': IMMICH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ size, page })
    });
    const data = await r.json();
    allItems = (data.assets && data.assets.items) || [];
    allItems.sort((a, b) => dir === 'asc'
      ? new Date(a.createdAt) - new Date(b.createdAt)
      : new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ assets: allItems.map(mapAssetWithMeta), total: data.assets?.total || 0 });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Immich proxy - thumbnail
app.get('/api/immich/thumb/:id', requireAuth, async (req, res) => {
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
          const body = { size, page };
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
  const album = { id, title, slug, assets: [], createdAt: new Date().toISOString() };
  albums.push(album);
  saveAlbums(albums);
  res.json(album);
});

// PUT update album (title, assets order)
app.put('/api/albums/:id', requireAuth, (req, res) => {
  const albums = loadAlbums();
  const idx = albums.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const { title, assets, slideshowSettings } = req.body;
  if (title !== undefined) {
    albums[idx].title = title;
    albums[idx].slug = slugify(title);
  }
  if (assets !== undefined) albums[idx].assets = assets;
  if (slideshowSettings !== undefined) albums[idx].slideshowSettings = slideshowSettings;
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
    const r = await fetch(`${IMMICH_URL}/assets/${req.params.id}/thumbnail?size=preview`, {
      headers: { 'x-api-key': IMMICH_KEY }
    });
    res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=2592000');
    r.body.pipe(res);
  } catch(e) { res.status(500).end(); }
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

// PUBLIC photo metadata (no auth) - for public album description display
app.get('/api/public/photo/:id', async (req, res) => {
  try {
    const r = await fetch(`${IMMICH_URL}/assets/${req.params.id}`, {
      headers: { 'x-api-key': IMMICH_KEY }
    });
    const data = await r.json();
    res.json({ description: data.exifInfo?.description || '' });
  } catch(e) { res.json({ description: '' }); }
});

// Serve public album page
function renderAlbumHtml(rawHtml) {
  // Swap brand placeholders or strip the brand block entirely when unconfigured.
  if (BRAND_NAME || BRAND_URL || BRAND_SITE_LABEL) {
    return rawHtml
      .replace(/<!--BRAND_START-->[\s\S]*?<!--BRAND_END-->/g, match =>
        match
          .replace(/{{BRAND_NAME}}/g, BRAND_NAME)
          .replace(/{{BRAND_URL}}/g, BRAND_URL)
          .replace(/{{BRAND_SITE_LABEL}}/g, BRAND_SITE_LABEL)
      );
  }
  return rawHtml.replace(/<!--BRAND_START-->[\s\S]*?<!--BRAND_END-->/g, '');
}

app.get('/album/:slug', (req, res) => {
  const albums = loadAlbums();
  const album = albums.find(a => a.slug === req.params.slug);
  const html = renderAlbumHtml(fs.readFileSync(path.join(__dirname, 'public', 'album.html'), 'utf8'));
  if (!album) return res.send(html);
  const base = `https://${req.get('host')}`;
  const coverId = album.cover || album.assets[0];
  const imgTag = coverId ? `<meta property="og:image" content="${base}/api/public/thumb/${coverId}">` : '';
  const tags = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${base}/album/${album.slug}">`,
    `<meta property="og:title" content="${album.title}">`,
    `<meta property="og:description" content="View the full album on Darkroom Log">`,
    imgTag,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].filter(Boolean).join('\n');
  res.send(html.replace('</head>', `${tags}\n</head>`));
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

// Archive assets — hides them from the main library (isArchived: true)
app.put('/api/immich/assets/archive', requireAuth, async (req, res) => {
  try {
    const { ids = [] } = req.body;
    const r = await fetch(`${IMMICH_URL}/assets`, {
      method: 'PUT',
      headers: { 'x-api-key': IMMICH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, isArchived: true })
    });
    if (!r.ok) return res.status(r.status).json({ error: 'Immich archive failed' });
    const data = await r.json();
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Restore assets from archive (isArchived: false)
app.put('/api/immich/assets/restore', requireAuth, async (req, res) => {
  try {
    const { ids = [] } = req.body;
    const r = await fetch(`${IMMICH_URL}/assets`, {
      method: 'PUT',
      headers: { 'x-api-key': IMMICH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, isArchived: false })
    });
    if (!r.ok) return res.status(r.status).json({ error: 'Immich restore failed' });
    const data = await r.json();
    res.json(data);
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
