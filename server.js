const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const PASSWORD_HASH = process.env.PASSWORD_HASH || bcrypt.hashSync(process.env.APP_PASSWORD || 'darkroom', 10);
const IMMICH_URL = process.env.IMMICH_URL || 'http://192.168.0.199:2283/api';
const IMMICH_KEY = process.env.IMMICH_KEY || '';
const DATA_FILE = '/data/prints.json';

// Ensure data file exists
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify([]));
}

const loadData = () => {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch(e) { return []; }
};

const saveData = (data) => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'darkroom-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

const requireAuth = (req, res, next) => {
  if (req.session.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
};

// Auth endpoints
app.post('/api/login', async (req, res) => {
  const { password } = req.body;
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
      takenAt: data.fileCreatedAt,
      width: data.exifInfo?.exifImageWidth || '',
      height: data.exifInfo?.exifImageHeight || ''
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Immich proxy - thumbnail
app.get('/api/immich/thumb/:id', requireAuth, async (req, res) => {
  try {
    const response = await fetch(`${IMMICH_URL}/assets/${req.params.id}/thumbnail?size=preview`, {
      headers: { 'x-api-key': IMMICH_KEY }
    });
    res.set('Content-Type', response.headers.get('content-type'));
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

// Prints CRUD
app.get('/api/prints', requireAuth, (req, res) => {
  res.json(loadData());
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

// Serve SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Darkroom Log running on port ${PORT}`);
});
