
// Darkroom Log - Main Application
// Auto-extracted from index.html


let state = {
  prints: [],
  currentPrintId: null,
  selectedImmich: null,
  technique: 'single',
  editingSessionId: null,
  sessionPrintId: null,
  immichSearchTimeout: null,
  sort: 'recent',
  activeTag: null,
  currentTab: 'prints',
  recentPage: 1,
  recentItems: [],
  recentLoaded: false,
  // Render-generation token. Bumped on any navigation away from the live Library
  // grid (tab switch, opening an album, opening a photo detail). Async grid
  // loaders capture it at call time and skip their repaint if it changed — so a
  // slow fetch (e.g. during heavy concurrent album edits) can't paint a stale
  // grid over the view you've since navigated back to. See `recentGen` guards.
  recentGen: 0,
  currentRecentId: null,
  currentRecentIndex: -1,
  fullscreenOpen: false,
  recentMeta: {},
  filterOptions: null,
  librarySort: 'upload',
  librarySortDir: 'desc',
  recentMode: 'full', // upload-sort default: 'full' (all uploads, paginated w/ Load More) | 'window' (last N days, fast)
  recentWindowDays: 7,
  displayedItems: [],
  previousView: 'recent-view',
  recentActivePerson: null,
  recentActiveChips: new Set(),
  searchMode: 'smart',
  recentSmartResults: [],
  searchPage: 1,
  searchQuery: '',
  searchTotal: 0,
  albums: [],
  currentAlbumId: null,
  albumSelectMode: false,
  albumSelected: new Set(),
  selectMode: false,
  selectedAssets: new Set(),
  currentAlbum: null,
  viewingFromAlbum: false,
  albumEditMode: false,
  albumSort: (() => { try { return localStorage.getItem('albumSort') || 'updated'; } catch (e) { return 'updated'; } })(),
  pendingAddAssetId: null,
  slideshow: { active: false, index: 0, timer: null, paused: false },
  immichAlbumsLoaded: false,
  immichAlbums: [],
  viewingArchived: false,
  viewingTrash: false,
  currentImmichAlbumId: null,
  currentImmichAlbumAssets: [],
  immichSelectMode: false,
  immichSelected: new Set(),
  immichConfiguredIds: [],
  immichDisplayedAssets: [],
  immichSort: 'taken',
  immichSortDir: 'desc',
  immichActiveChips: new Set(),
  immichSearchQuery: '',
};

async function login() {
  const pw = document.getElementById('login-password').value;
  const r = await fetch('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({password: pw}) });
  if (r.ok) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    loadGallery();
  } else {
    document.getElementById('login-error').textContent = 'Incorrect password';
  }
}

async function logout() { await fetch('/api/logout', {method:'POST'}); location.reload(); }

// TAB SWITCHING
function switchTab(tab) {
  state.recentGen++; // invalidate any in-flight Library grid loader for the prior view
  state.currentTab = tab;
  ['prints','recent','albums','immich'].forEach(t => {
    document.getElementById('tab-' + t).classList.toggle('active', t === tab);
  });
  document.getElementById('gallery-view').classList.toggle('active', tab === 'prints');
  document.getElementById('recent-view').classList.toggle('active', tab === 'recent');
  document.getElementById('albums-view').classList.toggle('active', tab === 'albums');
  document.getElementById('immich-view').classList.toggle('active', tab === 'immich');
  document.getElementById('album-detail-view').classList.remove('active');
  document.getElementById('immich-album-view').classList.remove('active');
  document.getElementById('detail-view').classList.remove('active');
  document.getElementById('recent-detail-view').classList.remove('active');
  document.getElementById('back-btn').style.display = 'none';
  state.albumSelectMode = false;
  state.albumSelected = new Set();
  lastSelectedIdx = -1;
  if (state.immichSelectMode) exitImmichSelectMode();
  if (tab !== 'recent' && state.recentActivePerson) {
    state.recentActivePerson = null;
    state.recentSmartResults = [];
    const _rs = document.getElementById('recent-search');
    if (_rs) _rs.value = '';
    updateRecentFilterChips();
    updateActiveChipLabel();
  }
  document.getElementById('add-print-btn').style.display = tab === 'prints' ? 'inline-block' : 'none';
  document.getElementById('header-title').textContent = 'Darkroom Log';
  if (tab === 'recent' && !state.recentLoaded) loadRecent();
  else if (tab === 'recent') applyRecentFilters();
  if (tab === 'albums') loadAlbumsTab();
  if (tab === 'immich' && !state.immichAlbumsLoaded) loadImmichTab();
}

// RECENT UPLOADS

// When a tile/chip or person filter is active, the filtered results live in
// state.recentSmartResults (server-side combined-search). Those items come from
// Immich's /search/metadata, which omits exifInfo — so a client-side chip
// re-filter can't match lens/model/city and would wipe the grid ("no photos").
// So the sort toggles re-sort the already-loaded results client-side (Option B)
// instead of refetching the unfiltered /recent endpoint + re-filtering. See the
// darkroom CHANGELOG v1.5.57 write-up.
function isRecentFilterActive() {
  const q = (document.getElementById('recent-search')?.value || '').trim();
  return !!(state.recentSmartResults?.length && (q || state.recentActiveChips.size || state.recentActivePerson));
}

// Sort asset objects by the current library sort/dir using fields that ARE
// present in /search/metadata responses: createdAt (upload time), updatedAt
// (last-edited time — bumped by a v3 copy-based replace, same as a
// republish always has), and takenAt/localDateTime/fileCreatedAt (capture
// time).
function sortRecentResults(arr) {
  const dir = state.librarySortDir === 'asc' ? 1 : -1;
  const ts = a => {
    const v = state.librarySort === 'upload' ? (a.createdAt || a.fileCreatedAt)
      : state.librarySort === 'edited' ? (a.updatedAt || a.createdAt || a.fileCreatedAt)
      : (a.takenAt || a.localDateTime || a.fileCreatedAt || a.createdAt);
    const t = v ? new Date(v).getTime() : 0;
    return Number.isNaN(t) ? 0 : t;
  };
  return arr.slice().sort((x, y) => (ts(x) - ts(y)) * dir);
}

// If a filter is active, re-sort the loaded results client-side and render;
// returns true so callers skip the unfiltered /recent refetch.
function resortActiveFilterIfPresent() {
  if (!isRecentFilterActive()) return false;
  state.recentSmartResults = sortRecentResults(state.recentSmartResults);
  renderRecentGrid(state.recentSmartResults);
  return true;
}

function setLibrarySort(sort) {
  state.librarySort = sort;
  // Only clear `active` from actual sort buttons (upload/taken/edited).
  // lib-sort-mode and lib-sort-dir are toggle buttons with their own visual
  // state, not sorts.
  document.querySelectorAll('#lib-sort-upload, #lib-sort-taken, #lib-sort-edited').forEach(b => b.classList.remove('active'));
  document.getElementById('lib-sort-' + sort).classList.add('active');
  if (typeof updateRecentModeButton === 'function') updateRecentModeButton();
  if (resortActiveFilterIfPresent()) return;
  state.recentPage = 1;
  state.recentItems = [];
  fetchRecentPage();
}

function toggleLibrarySortDir() {
  state.librarySortDir = state.librarySortDir === 'desc' ? 'asc' : 'desc';
  const btn = document.getElementById('lib-sort-dir');
  if (btn) btn.textContent = state.librarySortDir === 'desc' ? '↓ Newest' : '↑ Oldest';
  if (resortActiveFilterIfPresent()) return;
  state.recentPage = 1;
  state.recentItems = [];
  fetchRecentPage();
}

// Upload-Date and Last-Edited sorts both have two modes:
//   window: query Immich with createdAfter/updatedAfter = now-7d, fast (default)
//   full:   page through every timeline asset, server caches for 5 min,
//           surfaces freshly-uploaded/edited film scans whose fileCreatedAt
//           buries them deep in the chronological timeline
// The toggle also fires /api/filters/refresh-people so newly-tagged faces
// from Immich's face-recognition appear in the people filter without a
// full filter-cache rebuild.
function toggleRecentMode() {
  state.recentMode = state.recentMode === 'window' ? 'full' : 'window';
  updateRecentModeButton();
  // Fire-and-forget: pull fresh face tags from Immich. Don't await — the
  // grid reload below shouldn't wait on this. Fires regardless of the filtered
  // path so newly-tagged faces still surface in the people filter.
  fetch('/api/filters/refresh-people', { method: 'POST' })
    .then(r => r.json())
    .then(d => { if (d && d.ok) console.log('People refreshed:', d.count); })
    .catch(() => {});
  // window/full only affects the unfiltered upload fetch; with a filter active
  // there's nothing to refetch, so just re-sort the current results in place.
  if (resortActiveFilterIfPresent()) return;
  state.recentPage = 1;
  state.recentItems = [];
  fetchRecentPage();
}

function updateRecentModeButton() {
  const btn = document.getElementById('lib-sort-mode');
  if (!btn) return;
  const visible = state.librarySort === 'upload' || state.librarySort === 'edited';
  btn.style.display = visible ? '' : 'none';
  if (!visible) return;
  const label = state.librarySort === 'edited' ? 'edits' : 'uploads';
  btn.textContent = state.recentMode === 'window'
    ? `Last ${state.recentWindowDays}d · Full sweep →`
    : `Full sweep ✓ · Last ${state.recentWindowDays}d →`;
  btn.title = state.recentMode === 'window'
    ? `Showing ${label} from the last ${state.recentWindowDays} days. Click for a full sweep of all ${label} (slower, 5-min cache). Also refreshes face tags.`
    : `Showing all ${label}, sorted by ${state.librarySort === 'edited' ? 'last-edited' : 'upload'} date. Click to return to the fast window view.`;
}

async function loadRecent() {
  state.recentPage = 1;
  state.recentItems = [];
  state.recentLoaded = true;
  // Default sort is now 'upload' — make the window/full-sweep toggle reflect
  // the initial mode on first load (it's otherwise only updated via setLibrarySort).
  if (typeof updateRecentModeButton === 'function') updateRecentModeButton();
  await fetchRecentPage();
  fetchFilterOptions();
}

let filterOptionsFetching = false;
async function fetchFilterOptions() {
  if (filterOptionsFetching) return;
  filterOptionsFetching = true;
  try {
    const r = await fetch('/api/immich/filter-options');
    const data = await r.json();
    state.filterOptions = data;
    updateRecentFilterChips();
    if (data.building) {
      filterOptionsFetching = false;
      setTimeout(fetchFilterOptions, 5000);
    }
  } catch(e) { filterOptionsFetching = false; }
}

async function loadMoreRecent() {
  const btn = document.getElementById('load-more-btn');
  if (btn) btn.blur();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  state.recentPage++;
  await fetchRecentPage();
}

function absorbAssetMeta(items) {
  // Server folds exif metadata into list responses; populate state.recentMeta in one pass.
  for (const a of items) {
    if (!a || !a.id) continue;
    state.recentMeta[a.id] = {
      description: a.description || '',
      model: a.model || '',
      lens: a.lens || '',
      city: a.city || '',
      state: a.state || '',
      filename: a.originalFileName || '',
      takenAt: a.takenAt || a.localDateTime || a.fileCreatedAt || '',
      // Tags from Immich (synced from LR keywords by lr-immich plugin).
      // Title is NOT here — server doesn't include it in list responses
      // (would need a JPEG-header read per asset, too expensive for 500-item
      // grids). Title is fetched lazily by renderRecentDetail.
      tags: Array.isArray(a.tags) ? a.tags : []
    };
  }
}

async function fetchRecentPage() {
  const gen = state.recentGen; // skip the repaint below if the user navigates away mid-fetch
  // On Load More (page > 1) we want to keep the user's visual position. Three layers:
  //   1. Snapshot scrollTop on every plausible scroll container — Android Chrome may scroll
  //      the document while desktop scrolls #recent-view; we restore whichever moved.
  //   2. Anchor on the topmost-visible item (id + offset from viewport top) so we can
  //      correct any residual delta after layout settles, even if the wrong element got
  //      restored above.
  //   3. Multi-frame restoration: now + 2× rAF — survives address bar collapse/expand,
  //      lazy-image decoding, and font-swap reflow.
  // First-page loads and sort changes still scroll to top via the natural innerHTML replace.
  const isLoadMore = state.recentPage > 1;
  const recentView = document.getElementById('recent-view');
  const beforeRecentY = recentView ? recentView.scrollTop : 0;
  const beforeDocY = window.pageYOffset || document.documentElement.scrollTop || 0;
  let anchor = null;
  if (isLoadMore) {
    const grid = document.getElementById('recent-grid');
    if (grid) {
      for (const child of grid.children) {
        const rect = child.getBoundingClientRect();
        if (rect.bottom > 0 && child.dataset.id) {
          anchor = { id: child.dataset.id, offset: rect.top };
          break;
        }
      }
    }
  }
  const size = 250;
  const url = `/api/immich/recent?page=${state.recentPage}&size=${size}&sort=${state.librarySort}&dir=${state.librarySortDir}`
    + ((state.librarySort === 'upload' || state.librarySort === 'edited') ? `&mode=${state.recentMode}&windowDays=${state.recentWindowDays}` : '');
  const r = await fetch(url);
  const data = await r.json();
  const items = data.assets || [];
  absorbAssetMeta(items);
  state.recentItems = [...state.recentItems, ...items];
  // Navigated away (album/detail/other tab) while this was in flight — keep the
  // fetched data in recentItems but don't repaint; the grid self-heals on return.
  if (state.recentGen !== gen) return;
  applyRecentFilters();
  if (isLoadMore) {
    // Defense in depth: with no client-side sort, the append-only fast path in
    // renderRecentGrid should fire and the DOM above the fold won't change. But if
    // for any reason a full rebuild happens, restore scroll on whichever element
    // actually scrolls, then anchor-correct so the topmost-visible item lands back
    // at its prior viewport offset.
    const pinScroll = () => {
      if (recentView && recentView.scrollTop !== beforeRecentY) recentView.scrollTop = beforeRecentY;
      const curDocY = window.pageYOffset || document.documentElement.scrollTop || 0;
      if (curDocY !== beforeDocY) window.scrollTo(0, beforeDocY);
    };
    const fineCorrect = () => {
      if (!anchor) return;
      const el = document.getElementById('sel-' + anchor.id);
      if (!el) return;
      const delta = el.getBoundingClientRect().top - anchor.offset;
      if (Math.abs(delta) < 1) return;
      let node = el.parentElement;
      while (node && node !== document.body) {
        const cs = getComputedStyle(node);
        if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
          node.scrollTop += delta;
          return;
        }
        node = node.parentElement;
      }
      window.scrollBy(0, delta);
    };
    pinScroll();
    requestAnimationFrame(() => {
      pinScroll();
      fineCorrect();
      requestAnimationFrame(() => { pinScroll(); fineCorrect(); });
    });
  }
  document.getElementById('load-more-btn').style.display = (items.length === size && !document.getElementById('recent-search').value) ? 'block' : 'none';
  document.getElementById('load-more-btn').onclick = loadMoreRecent;
}

// Fallback for any asset list whose server endpoint hasn't been updated to fold meta.
async function loadRecentMetaBatch(ids) {
  const missing = ids.filter(id => id && !state.recentMeta[id]);
  if (!missing.length) return;
  for (const id of missing) {
    try {
      const r = await fetch('/api/immich/photo/' + id);
      const meta = await r.json();
      state.recentMeta[id] = {
        description: meta.description || '',
        model: meta.model || '',
        lens: meta.lens || '',
        city: meta.city || '',
        state: meta.state || '',
        filename: meta.filename || '',
        takenAt: meta.takenAt || '',
        tags: Array.isArray(meta.tags) ? meta.tags : []
      };
    } catch(e) {}
  }
}

let smartSearchTimer = null;

function setSearchMode(mode) {
  state.searchMode = mode;
  document.getElementById('search-mode-text').classList.toggle('active', mode === 'text');
  document.getElementById('search-mode-smart').classList.toggle('active', mode === 'smart');
  state.recentActiveChips = new Set();
  state.recentActivePerson = null;
  state.recentSmartResults = [];
  updateRecentFilterChips();
  updateActiveChipLabel();
  const q = document.getElementById('recent-search').value;
  if (q) handleRecentSearch(q);
  else applyRecentFilters();
}

function handleRecentSearch(q) {
  clearTimeout(smartSearchTimer);
  if (!q.trim()) {
    state.recentSmartResults = [];
    if (state.recentActivePerson) {
      runMultiChipSearch([...state.recentActiveChips], state.recentActivePerson);
    } else {
      applyRecentFilters();
    }
    return;
  }
  if (q.trim().length > 1) {
    smartSearchTimer = setTimeout(() => {
      if (state.searchMode === 'smart') runSmartSearch(q);
      else runTextSearch(q);
    }, 600);
  }
}

async function runMultiChipSearch(chips, personId = null) {
  const gen = state.recentGen;
  const grid = document.getElementById('recent-grid');
  grid.innerHTML = '<div class="loading">Searching...</div>';
  try {
    // Categorize chips using filterOptions if available, otherwise send all as unknown
    const opts = state.filterOptions || {};
    const cameraSet = new Set(opts.cameras || []);
    const lensSet = new Set(opts.lenses || []);
    const citySet = new Set(opts.cities || []);
    const stateSet = new Set(opts.states || []);
    const filmSet = new Set(opts.films || []);
    // If filterOptions not loaded, categorize by trying all fields on server
    const cameras = cameraSet.size ? chips.filter(c => cameraSet.has(c)) : [];
    const lenses = lensSet.size ? chips.filter(c => lensSet.has(c)) : [];
    const cities = citySet.size ? chips.filter(c => citySet.has(c)) : [];
    const states = stateSet.size ? chips.filter(c => stateSet.has(c)) : [];
    const films = filmSet.size ? chips.filter(c => filmSet.has(c)) : [];
    // For uncategorized chips (when filterOptions not loaded), pass as unknowns
    const known = new Set([...cameras, ...lenses, ...cities, ...states, ...films]);
    const unknowns = chips.filter(c => !known.has(c));
    const r = await fetch('/api/immich/combined-search', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ cameras, lenses, cities, states, films, unknowns, personId, size: 250, page: 1 })
    });
    const data = await r.json();
    const items = data.assets || [];
    absorbAssetMeta(items);
    // Sort the filtered set by the current library sort/dir so the chosen sort
    // applies to filtered views too (Option B — these items lack exifInfo, so
    // we sort on createdAt/takenAt which are present).
    state.recentSmartResults = sortRecentResults(items);
    state.searchPage = 1;
    if (state.recentGen !== gen) return; // navigated away mid-search; don't repaint
    renderRecentGrid(state.recentSmartResults);
    loadRecentMetaBatch(items.map(a => a.id));
    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.style.display = items.length === 250 ? 'block' : 'none';
      loadMoreBtn.onclick = async () => {
        state.searchPage++;
        const r2 = await fetch('/api/immich/combined-search', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ cameras, lenses, cities, states, films, personId, size: 250, page: state.searchPage })
        });
        const d2 = await r2.json();
        absorbAssetMeta(d2.assets || []);
        // Keep the active sort consistent as more pages append.
        state.recentSmartResults = sortRecentResults([...state.recentSmartResults, ...(d2.assets || [])]);
        renderRecentGrid(state.recentSmartResults);
        loadMoreBtn.style.display = (d2.assets || []).length === 250 ? 'block' : 'none';
      };
    }
  } catch(e) {
    grid.innerHTML = '<div class="loading">Search failed.</div>';
  }
}

async function runTextSearch(q, append = false) {
  const gen = state.recentGen;
  const grid = document.getElementById('recent-grid');
  if (!append) {
    state.searchPage = 1;
    state.searchQuery = q;
    state.recentSmartResults = [];
    grid.innerHTML = '<div class="loading">Searching...</div>';
  }
  try {
    const r = await fetch('/api/immich/text-search', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ query: q, size: 250, page: state.searchPage, personId: state.recentActivePerson, ...categorizeChips() })
    });
    const data = await r.json();
    const newItems = data.assets || [];
    state.searchTotal = data.total || newItems.length;
    absorbAssetMeta(newItems);
    state.recentSmartResults = append ? [...state.recentSmartResults, ...newItems] : newItems;
    if (state.recentGen !== gen) return; // navigated away mid-search; don't repaint
    renderRecentGrid(state.recentSmartResults);
    loadRecentMetaBatch(newItems.map(a => a.id));
    // Show load more if we got a full page (likely more results)
    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.style.display = newItems.length === 250 ? 'block' : 'none';
      loadMoreBtn.onclick = () => {
        state.searchPage++;
        runTextSearch(state.searchQuery, true);
      };
    }
  } catch(e) {
    grid.innerHTML = '<div class="loading">Search failed.</div>';
  }
}

async function runSmartSearch(q, append = false) {
  const gen = state.recentGen;
  const grid = document.getElementById('recent-grid');
  if (!append) {
    state.searchPage = 1;
    state.searchQuery = q;
    state.recentSmartResults = [];
    grid.innerHTML = '<div class="loading">Searching...</div>';
  }
  try {
    const r = await fetch('/api/immich/smart-search', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ query: q, size: 250, page: state.searchPage, personId: state.recentActivePerson, ...categorizeChips() })
    });
    const data = await r.json();
    const newItems = data.assets || [];
    state.searchTotal = data.total || newItems.length;
    absorbAssetMeta(newItems);
    state.recentSmartResults = append ? [...state.recentSmartResults, ...newItems] : newItems;
    if (state.recentGen !== gen) return; // navigated away mid-search; don't repaint
    renderRecentGrid(state.recentSmartResults);
    loadRecentMetaBatch(newItems.map(a => a.id));
    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.style.display = newItems.length === 250 ? 'block' : 'none';
      loadMoreBtn.onclick = () => {
        state.searchPage++;
        runSmartSearch(state.searchQuery, true);
      };
    }
  } catch(e) {
    grid.innerHTML = '<div class="loading">Smart search failed.</div>';
  }
}

function applyRecentFilters() {
  const q = (document.getElementById('recent-search')?.value || '').toLowerCase();
  const chips = state.recentActiveChips;
  // Use smart/text results if we have them and there's a query or active chips
  const hasResults = state.recentSmartResults?.length && (q.trim() || chips.size);
  let items = hasResults ? state.recentSmartResults : state.recentItems;

  if ((q && !hasResults) || chips.size) {
    items = items.filter(a => {
      const meta = state.recentMeta[a.id] || {};
      const searchable = [
        a.originalFileName,
        meta.description,
        meta.model,
        meta.lens,
        meta.city,
        meta.state
      ].join(' ').toLowerCase();
      const matchesQ = !q || searchable.includes(q);
      // AND logic — must match ALL active chips
      const matchesChips = chips.size === 0 || [...chips].every(c => searchable.includes(c.toLowerCase()));
      return matchesQ && matchesChips;
    });
  }
  // No client-side sort. The server already sorts by `sort` and `dir` query params,
  // and `setLibrarySort` / `toggleLibrarySortDir` both reset state and re-fetch.
  // A redundant client sort was rearranging items at page boundaries when timestamps
  // weren't strictly monotonic across pages (e.g. minute-resolution `createdAt`
  // where page-1's tail items overlap page-2's head items) — every Load More then
  // invalidated the page-1 prefix in the grid, forcing a full innerHTML rebuild and
  // breaking the append-only fast path.
  renderRecentGrid(items);
}

// Search-reveal panel (Search Mode/Select/Camera/Lens/State/City/People) —
// opens when the search input is focused ("tap the search bar"), closes via
// its backdrop or the Done button. A backdrop <div> handles both mouse and
// touch taps reliably (unlike the old document-level mousedown+touchstart
// listener pattern, which this replaces).
function openRecentFilterPopup() {
  const popup = document.getElementById('recent-filter-popup');
  if (popup.style.display !== 'none') return; // already open
  popup.style.display = 'block';
  document.getElementById('recent-filter-backdrop').style.display = 'block';
  updateRecentFilterChips();
}
function closeRecentFilterPopup() {
  document.getElementById('recent-filter-popup').style.display = 'none';
  document.getElementById('recent-filter-backdrop').style.display = 'none';
}
function toggleFiltersPopup() {
  const popup = document.getElementById('recent-filter-popup');
  if (popup.style.display === 'none') openRecentFilterPopup();
  else closeRecentFilterPopup();
}

// Sort-reveal panel (Sort options on top, Full Sweep/Thumbnails maintenance
// below) — opens/closes via the Sort chip, same backdrop-close pattern.
function openSortPopup() {
  const popup = document.getElementById('sort-popup');
  if (popup.style.display !== 'none') return;
  popup.style.display = 'block';
  document.getElementById('sort-backdrop').style.display = 'block';
}
function closeSortPopup() {
  document.getElementById('sort-popup').style.display = 'none';
  document.getElementById('sort-backdrop').style.display = 'none';
}
function toggleSortPopup() {
  const popup = document.getElementById('sort-popup');
  if (popup.style.display === 'none') openSortPopup();
  else closeSortPopup();
}

function updateRecentFilterChips() {
  const opts = state.filterOptions || {};
  const cameras = opts.cameras || [];
  const lenses = opts.lenses || [];
  const cities = opts.cities || [];
  const states = opts.states || [];
  const films = opts.films || [];
  const people = opts.people || [];
  const building = opts.building;
  // Camera/Lens/State/City are single-select dropdowns (Immich-style) — each
  // category holds at most one active value in state.recentActiveChips, so
  // picking a new value just swaps out any prior value from that category.
  const populateDropdown = (id, values, label) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (!values.length) {
      el.innerHTML = `<option value="">${building ? 'Building index…' : 'None found'}</option>`;
      el.disabled = true;
      return;
    }
    el.disabled = false;
    const known = new Set(values);
    const current = [...state.recentActiveChips].find(v => known.has(v)) || '';
    const optsHtml = values.map(v => {
      const safe = String(v).replace(/"/g, '&quot;');
      return `<option value="${safe}"${v === current ? ' selected' : ''}>${v}</option>`;
    }).join('');
    el.innerHTML = `<option value="">All ${label}</option>${optsHtml}`;
  };
  populateDropdown('filter-camera', cameras, 'cameras');
  populateDropdown('filter-lens', lenses, 'lenses');
  populateDropdown('filter-state', states, 'states');
  populateDropdown('filter-city', cities, 'cities');
  populateDropdown('filter-film', films, 'films');
  // Avatar-grid person picker (mirrors Immich's People search panel) — face
  // thumbnail via the /api/immich/person-thumb proxy, with an initials
  // fallback shown until the image loads (or if the person has no face
  // thumbnail yet, in which case onerror just removes the broken <img>).
  const personChip = (p) => {
    const hasName = !!p.name;
    const name = String(p.name).replace(/"/g, '&quot;');
    const pname = String(p.name).toLowerCase().replace(/"/g, '&quot;');
    // Unnamed (not-yet-tagged in Immich) faces have no text to derive an
    // initial from — show "?" instead, and label them so it's clear why.
    const initial = hasName ? String(p.name).trim().charAt(0).toUpperCase() : '?';
    const labelText = hasName ? name : 'Unnamed';
    return `<button class="person-avatar-item${!hasName ? ' person-avatar-unnamed' : ''}${state.recentActivePerson === p.id ? ' active' : ''}" data-action="searchByPerson" data-id="${p.id}" data-name="${name}" data-pname="${pname}">
      <span class="person-avatar-fallback">${initial}</span>
      <img class="person-avatar-img" src="/api/immich/person-thumb/${p.id}" alt="">
      <span class="person-avatar-name">${labelText}</span>
    </button>`;
  };
  const peopleEl = document.getElementById('chip-people');
  const loadingMsg = building ? '<span style="color:var(--text-dim);font-size:11px">Building index...</span>' : '<span style="color:var(--text-dim);font-size:11px">None found</span>';
  if (peopleEl) {
    peopleEl.innerHTML = people.map(p => personChip(p)).join('') || loadingMsg;
    // CSP is script-src 'self' with no 'unsafe-inline', so image load/error
    // handlers must be attached via addEventListener, not inline onload/onerror
    // (see darkroom-csp-no-inline-handlers memory — inline handlers are
    // silently dropped, not just warned about).
    peopleEl.querySelectorAll('.person-avatar-img').forEach(img => {
      const showImg = () => {
        img.style.display = 'block';
        const fallback = img.previousElementSibling;
        if (fallback) fallback.style.display = 'none';
      };
      if (img.complete && img.naturalWidth > 0) {
        showImg();
      } else {
        img.addEventListener('load', showImg);
        img.addEventListener('error', () => img.remove());
      }
    });
  }
  filterPeopleChips();

}

// Live-filters the People avatar grid by name substring as the user types
// in #people-filter-input. Purely client-side — all people chips are already
// rendered by updateRecentFilterChips, this just toggles visibility so we
// don't refetch/re-render (and don't lose scroll position) on every keystroke.
function filterPeopleChips() {
  const input = document.getElementById('people-filter-input');
  const q = (input?.value || '').trim().toLowerCase();
  document.querySelectorAll('#chip-people .person-avatar-item').forEach(el => {
    const match = !q || (el.dataset.pname || '').includes(q);
    el.style.display = match ? '' : 'none';
  });
}

// Filter the Library grid to all assets carrying a specific Immich tag.
// Hits /api/immich/tag-search which resolves the name → tagId on the
// server side and runs Immich's metadata search.
//
// Triggered when the user clicks a tag chip inside the photo detail view
// — we close the detail overlay, switch to the Recent (Library) tab if
// needed, and show the filtered grid.
async function searchByImmichTag(tagName) {
  if (!tagName) return;

  // Close the detail overlay (mirrors goBackFromDetail's overlay-fade).
  const overlay = document.getElementById('recent-detail-view');
  if (overlay && overlay.classList.contains('active')) {
    overlay.classList.add('dismissing');
    setTimeout(() => overlay.classList.remove('active', 'dismissing'), 230);
    document.getElementById('back-btn').style.display = 'none';
  }

  // Ensure we're on the Recent tab.
  if (typeof switchTab === 'function') {
    try { switchTab('recent'); } catch (e) { /* tab may already be active */ }
  }

  // Clear other filters so the tag search isn't intersected unexpectedly.
  state.recentActiveChips = new Set();
  state.recentActivePerson = null;
  if (typeof updateRecentFilterChips === 'function') updateRecentFilterChips();
  const searchBox = document.getElementById('recent-search');
  if (searchBox) searchBox.value = '';

  const grid = document.getElementById('recent-grid');
  if (grid) grid.innerHTML = `<div class="loading">Searching tag "${tagName}"…</div>`;

  state.recentActiveImmichTag = tagName;
  state.searchPage = 1;
  // Captured AFTER the switchTab('recent') above (which bumps recentGen) so the
  // guard reflects navigation that happens during the fetch, not the tab switch.
  const gen = state.recentGen;

  try {
    const r = await fetch('/api/immich/tag-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: tagName, size: 250, page: 1 }),
    });
    const data = await r.json();
    const items = data.assets || [];
    state.recentSmartResults = items;
    absorbAssetMeta(items);
    if (state.recentGen !== gen) return; // navigated away mid-search; don't repaint
    renderRecentGrid(items);
    loadRecentMetaBatch(items.map(a => a.id));

    // Header strip: show the active tag with a clear-button. Reuses any
    // existing "active-chip-label" pill the chip system uses.
    const headerTitle = document.getElementById('header-title');
    if (headerTitle) headerTitle.textContent = `Tag: ${tagName}`;

    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.style.display = items.length === 250 ? 'block' : 'none';
      loadMoreBtn.onclick = async () => {
        state.searchPage++;
        const r2 = await fetch('/api/immich/tag-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tag: tagName, size: 250, page: state.searchPage }),
        });
        const d2 = await r2.json();
        state.recentSmartResults = [...state.recentSmartResults, ...(d2.assets || [])];
        renderRecentGrid(state.recentSmartResults);
        loadMoreBtn.style.display = (d2.assets || []).length === 250 ? 'block' : 'none';
      };
    }
  } catch (e) {
    if (grid) grid.innerHTML = '<div class="loading">Tag search failed.</div>';
  }
}

async function searchByPerson(personId, name) {
  state.recentActivePerson = state.recentActivePerson === personId ? null : personId;
  updateRecentFilterChips();
  updateActiveChipLabel();
  const q = (document.getElementById('recent-search')?.value || '').trim();
  if (!state.recentActivePerson) {
    state.recentSmartResults = [];
    if (q) {
      if (state.searchMode === 'smart') runSmartSearch(q);
      else runTextSearch(q);
    } else if (state.recentActiveChips.size > 0) {
      runMultiChipSearch([...state.recentActiveChips]);
    } else {
      applyRecentFilters();
    }
    return;
  }
  // Person just activated; intersect with query first, then chips, else person-only search
  if (q) {
    if (state.searchMode === 'smart') runSmartSearch(q);
    else runTextSearch(q);
    return;
  }
  if (state.recentActiveChips.size > 0) {
    runMultiChipSearch([...state.recentActiveChips], state.recentActivePerson);
    return;
  }
  const gen = state.recentGen;
  const grid = document.getElementById('recent-grid');
  grid.innerHTML = '<div class="loading">Searching...</div>';
  try {
    const r = await fetch('/api/immich/person-search', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ personId, size: 250 })
    });
    const data = await r.json();
    state.recentSmartResults = data.assets || [];
    absorbAssetMeta(state.recentSmartResults);
    if (state.recentGen !== gen) return; // navigated away mid-search; don't repaint
    renderRecentGrid(state.recentSmartResults);
    loadRecentMetaBatch(state.recentSmartResults.map(a => a.id));
    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.style.display = (data.assets || []).length === 250 ? 'block' : 'none';
      loadMoreBtn.onclick = () => {
        state.searchPage++;
        fetch('/api/immich/person-search', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ personId, size: 250, page: state.searchPage })
        }).then(r => r.json()).then(d => {
          state.recentSmartResults = [...state.recentSmartResults, ...(d.assets || [])];
          renderRecentGrid(state.recentSmartResults);
        });
      };
    }
  } catch(e) {
    grid.innerHTML = '<div class="loading">Search failed.</div>';
  }
}



function categorizeChips() {
  const chips = [...state.recentActiveChips];
  const opts = state.filterOptions || {};
  const cameraSet = new Set(opts.cameras || []);
  const lensSet = new Set(opts.lenses || []);
  const citySet = new Set(opts.cities || []);
  const stateSet = new Set(opts.states || []);
  const filmSet = new Set(opts.films || []);
  return {
    model: chips.find(c => cameraSet.has(c)),
    lensModel: chips.find(c => lensSet.has(c)),
    city: chips.find(c => citySet.has(c)),
    state: chips.find(c => stateSet.has(c)),
    film: chips.find(c => filmSet.has(c))
  };
}

// Camera/Lens/State/City filter dropdowns (single-select per category) —
// picking a new value replaces any prior value from that same category in
// state.recentActiveChips, then re-runs the same search dispatch the old
// multi-toggle chips used.
// category matches a state.filterOptions key: 'cameras'|'lenses'|'states'|'cities'.
function setFilterDropdown(category, val) {
  const known = new Set((state.filterOptions || {})[category] || []);
  for (const v of [...state.recentActiveChips]) {
    if (known.has(v)) state.recentActiveChips.delete(v);
  }
  if (val) state.recentActiveChips.add(val);
  updateActiveChipLabel();
  updateRecentFilterChips();
  const chips = [...state.recentActiveChips];
  const q = (document.getElementById('recent-search')?.value || '').trim();
  if (q) {
    // Query present — smart/text search composes personId + chips via categorizeChips
    if (state.searchMode === 'smart') runSmartSearch(q);
    else runTextSearch(q);
  } else if (chips.length === 0 && !state.recentActivePerson) {
    state.recentSmartResults = [];
    applyRecentFilters();
  } else {
    // Chips and/or person (no query) — combined search
    runMultiChipSearch(chips, state.recentActivePerson);
  }
}

function updateActiveChipLabel() {
  const label = document.getElementById('active-chip-label');
  if (!label) return;
  const parts = [];
  if (state.recentActivePerson) {
    const people = (state.filterOptions && state.filterOptions.people) || [];
    const p = people.find(x => x.id === state.recentActivePerson);
    if (p) parts.push('👤 ' + (p.name || 'Unnamed'));
  }
  parts.push(...[...state.recentActiveChips]);
  label.textContent = parts.join(' · ');
}

function clearRecentChip() {
  state.recentActiveChips = new Set();
  state.recentActivePerson = null;
  state.recentSmartResults = [];
  updateActiveChipLabel();
  updateRecentFilterChips();
  const searchEl = document.getElementById('recent-search');
  if (searchEl) searchEl.value = '';
  applyRecentFilters();
}

function clearRecentSearch() {
  const searchEl = document.getElementById('recent-search');
  if (searchEl) searchEl.value = '';
  const clearBtn = document.getElementById('btn-clear-recent-search');
  if (clearBtn) clearBtn.style.display = 'none';
  state.recentActivePerson = null;
  state.recentActiveChips = new Set();
  state.recentSmartResults = [];
  updateRecentFilterChips();
  updateActiveChipLabel();
  applyRecentFilters();
}

// --- Thumbnail URL builder + manual refresh ------------------------------
// Darkroom proxies Immich's thumbnails verbatim, so it inherits whatever
// Immich generated — and stale ones linger behind the 24h browser cache and
// the SW's stale-while-revalidate (darkroom-thumbs-v1). We version the URL to
// beat that:
//   • `v`  = the asset's Immich updatedAt → a republish/replace auto-busts it.
//   • `_r` = a session epoch set by the "⟳ Thumbnails" button → forces a full
//            refetch across every view (covers prints/albums that have no `v`).
let _thumbEpoch = '';
function thumbSrc(id, opts = {}) {
  const p = new URLSearchParams();
  if (opts.size) p.set('size', opts.size);
  if (opts.ver) p.set('v', String(opts.ver).replace(/[-:.TZ]/g, ''));
  if (_thumbEpoch) p.set('_r', _thumbEpoch);
  const qs = p.toString();
  return '/api/immich/thumb/' + id + (qs ? '?' + qs : '');
}
async function refreshThumbnails(btn) {
  const label = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = '⟳ …'; }
  _thumbEpoch = String(Date.now());
  let cleared = 0;
  try {
    // Drop the service-worker thumb cache so SWR refetches from the network.
    if (window.caches) {
      const names = (await caches.keys()).filter(n => /thumb/i.test(n));
      for (const n of names) {
        try { cleared += (await (await caches.open(n)).keys()).length; } catch (e) {}
      }
      await Promise.all(names.map(n => caches.delete(n)));
    }
  } catch (e) { /* non-fatal */ }
  // Re-point every on-screen thumbnail at the busted URL (later renders pick up
  // _thumbEpoch automatically via thumbSrc()). Briefly dim them so the refetch
  // is visible even when the new bytes are identical to the old.
  const imgs = document.querySelectorAll('img[src*="/api/immich/thumb/"]');
  imgs.forEach(img => {
    try {
      const u = new URL(img.getAttribute('src'), location.origin);
      u.searchParams.set('_r', _thumbEpoch);
      img.style.transition = 'opacity 0.15s';
      img.style.opacity = '0.35';
      img.addEventListener('load', () => { img.style.opacity = '1'; }, { once: true });
      img.src = u.pathname + u.search;
    } catch (e) {}
  });
  console.log(`[darkroom] thumbnail refresh: re-fetched ${imgs.length} on-screen, cleared ${cleared} SW-cached`);
  // Transient confirmation so it's obvious the click did something — even when
  // there were no wonky thumbnails to visibly change.
  if (btn) {
    btn.disabled = false;
    btn.textContent = imgs.length ? `✓ ${imgs.length} refreshed` : '✓ cache cleared';
    setTimeout(() => { btn.textContent = label; }, 1800);
  }
}

function renderRecentGrid(items) {
  state.displayedItems = items; // track what's currently shown for navigation
  const grid = document.getElementById('recent-grid');
  if (!items.length) { grid.innerHTML = '<div class="loading">No recent uploads.</div>'; return; }
  const renderItem = a => `
    <div class="gallery-item ${state.selectMode ? 'selectable' : ''} ${state.selectedAssets && state.selectedAssets.has(a.id) ? 'selected' : ''}"
         id="sel-${a.id}"
         data-action="recentItemClick" data-id="${a.id}">
      <img src="${thumbSrc(a.id, {ver:a.updatedAt})}" alt="${a.originalFileName}" loading="lazy" decoding="async" fetchpriority="low" width="300" height="300" onerror="this.style.background='#1a1a1a'">
      ${state.selectMode ? `<div class="select-check ${state.selectedAssets && state.selectedAssets.has(a.id) ? 'checked' : ''}">✓</div>` : ''}
    </div>
  `;
  // Append-only fast path: if the existing grid's children are a strict prefix of `items`
  // (i.e. Load More just appended new tiles to a stable head), insert the new tiles at the
  // end instead of rewriting innerHTML. The DOM nodes the user is looking at don't move at
  // all, scroll position is preserved naturally, and already-decoded <img>s aren't torn down
  // and re-fetched. Falls back to full rebuild for sort changes / filter changes / etc.
  const existing = grid.children;
  let canAppend = existing.length > 0 && items.length > existing.length;
  if (canAppend) {
    for (let i = 0; i < existing.length; i++) {
      if (!items[i] || existing[i].dataset.id !== items[i].id) { canAppend = false; break; }
    }
  }
  if (canAppend) {
    grid.insertAdjacentHTML('beforeend', items.slice(existing.length).map(renderItem).join(''));
  } else {
    grid.innerHTML = items.map(renderItem).join('');
  }
}

function goBackFromDetail() {
  state.viewingFromAlbum = false;
  const prev = state.previousView || 'recent-view';
  // Fade overlay out — absorbs touch inertia before revealing grid
  const overlay = document.getElementById('recent-detail-view');
  overlay.classList.add('dismissing');
  setTimeout(() => overlay.classList.remove('active', 'dismissing'), 230);
  document.getElementById('back-btn').style.display = 'none';
  if (prev === 'album-detail-view') {
    document.getElementById('header-title').textContent = (state.currentAlbum?.title || 'Album').toUpperCase();
  } else if (prev === 'immich-album-view') {
    document.getElementById('header-title').textContent = document.getElementById('immich-album-name').textContent;
    document.getElementById('back-btn').style.display = 'flex';
    document.getElementById('back-btn').onclick = () => {
      document.getElementById('immich-album-view').classList.remove('active');
      document.getElementById('immich-view').classList.add('active');
      document.getElementById('back-btn').style.display = 'none';
      document.getElementById('header-title').textContent = 'Darkroom Log';
    };
  } else {
    document.getElementById('header-title').textContent = 'Darkroom Log';
    document.getElementById('back-btn').onclick = showGallery;
  }
  disablePinchZoom();
  state.previousView = 'recent-view';
}

async function showRecentDetail(assetId) {
  // Opening the detail overlay pages via state.displayedItems; bump the gen so a
  // pending Library fetch can't resolve underneath and clobber displayedItems
  // (which would break prev/next) or repaint the hidden grid with a stale set.
  state.recentGen++;
  state.currentRecentId = assetId;
  state.currentRecentIndex = (state.displayedItems || state.recentItems).findIndex(a => a.id === assetId);

  // Track which view is underneath the overlay (for header state on back)
  const viewMap = { 'album-detail-view': 'album-detail-view', 'immich-album-view': 'immich-album-view' };
  const fromView = Object.keys(viewMap).find(id => document.getElementById(id)?.classList.contains('active'));
  state.previousView = fromView ? viewMap[fromView] : 'recent-view';

  // Show the fixed overlay — underlying view stays active and keeps its scroll
  document.getElementById('recent-detail-view').classList.add('active');
  document.getElementById('recent-detail-view').scrollTop = 0;
  document.getElementById('back-btn').style.display = 'flex';
  document.getElementById('header-title').textContent = 'Recent';
  enablePinchZoom();
  document.getElementById('back-btn').onclick = goBackFromDetail;

  await renderRecentDetail(assetId);
}

async function renderRecentDetail(assetId, navGen) {
  // Bump the nav generation on a fresh open (no navGen passed) so any in-flight
  // render from a prior photo is invalidated — matches showDetail (prints).
  const myGen = navGen != null ? navGen : ++_navGen;
  const content = document.getElementById('recent-detail-content');

  // Nav position needs no metadata — compute it up front so the image can paint
  // immediately, in parallel with (not gated behind) the metadata fetch.
  const idx = state.currentRecentIndex;
  const displayedItems = state.displayedItems || state.recentItems;
  const total = displayedItems.length;
  const hasPrev = idx > 0;
  const hasNext = idx < total - 1;

  // Attach load/error handlers AFTER innerHTML write — CSP (script-src 'self')
  // blocks inline `onload=""` / `onerror=""` attributes silently.
  const _attachDetailImgHandlers = () => {
    const dimg = content.querySelector('.detail-image');
    if (!dimg) return;
    dimg.addEventListener('error', () => { dimg.style.opacity = '0.2'; dimg.alt = 'Image unavailable'; });
    const onLoad = () => scheduleDetailUpgrade(dimg);
    if (dimg.complete && dimg.naturalWidth > 0) onLoad();
    else dimg.addEventListener('load', onLoad);
  };

  // Phase 1 — paint the image immediately with a placeholder info panel. The
  // photo now starts downloading right away instead of waiting on the metadata
  // JSON; on slow 5G it's viewable in parallel and a metadata stall no longer
  // blanks or fails the photo. (Previously the <img> wasn't written to the DOM
  // until /api/immich/photo returned, so a slow or timed-out meta fetch showed
  // "Failed to load photo" even though the image itself was fine.)
  content.innerHTML = `
    <div class="detail-layout">
      <div class="detail-left">
        <div style="position:relative;width:100%;height:100%;display:flex;align-items:flex-start;justify-content:center">
          <img class="detail-image"
               src="${thumbSrc(assetId, {size:_isMobileUA() ? 'thumbnail' : 'preview'})}"
               ${_isMobileUA() ? `data-next="${thumbSrc(assetId, {size:'preview'})}"` : ''}
               alt=""
               data-action="openFullscreen" data-url="/api/immich/original/${assetId}"
               style="cursor:zoom-in;background:#1a1a1a;min-height:200px">
          <div data-action="navPrev" style="position:absolute;left:0;top:0;width:25%;height:100%;cursor:pointer;z-index:10"></div>
          <div data-action="navNext" style="position:absolute;right:0;top:0;width:25%;height:100%;cursor:pointer;z-index:10"></div>
        </div>
      </div>
      <div class="detail-right">
        <div style="padding:0.5rem 1rem;display:flex;gap:0.4rem;align-items:center;border-bottom:1px solid var(--border)">
          ${hasPrev ? `<button class="nav-arrow" data-action="navPrev">‹</button>` : `<div style="width:28px"></div>`}
          ${hasNext ? `<button class="nav-arrow" data-action="navNext">›</button>` : ''}
          <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text-dim)">${idx+1} / ${total}</div>
        </div>
        <div class="loading" style="padding:1.5rem;font-size:12px">Loading details…</div>
      </div>
    </div>`;
  _attachDetailImgHandlers();

  // Phase 2 — fetch metadata in parallel and patch only the info panel when it
  // lands; the (already loading) image element is left untouched. 15s abort —
  // a stalled connection no longer zombies the nav, and now a meta failure only
  // costs the EXIF sidebar, not the photo.
  let meta = {};
  let metaFailed = false;
  try {
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), 15000);
    const r = await fetch(`/api/immich/photo/${assetId}`, { signal: ac.signal });
    clearTimeout(tid);
    meta = await r.json();
  } catch(e) {
    metaFailed = true;
  }

  // Stale-result guard: a newer nav has already happened, drop this result.
  if (myGen !== _navGen) return;

  if (metaFailed) {
    const rp = content.querySelector('.detail-right');
    if (rp) rp.innerHTML = '<div class="loading" style="padding:1.5rem;font-size:12px">Details unavailable — connection is slow. The photo above is still viewable; navigate or reopen to retry.</div>';
    return;
  }

  // Lazy-load Darkroom albums so the "In albums" row works even when the
  // user opened Recent first and never visited the Albums tab.
  if (!Array.isArray(state.albums)) {
    try {
      const ac = new AbortController();
      const tid = setTimeout(() => ac.abort(), 15000);
      const r = await fetch('/api/albums', { signal: ac.signal });
      clearTimeout(tid);
      const data = await r.json();
      if (Array.isArray(data)) state.albums = data;
    } catch (e) { /* leave for other loaders */ }
    if (myGen !== _navGen) return; // stale-result guard
  }
  const assetAlbums = (state.albums || []).filter(a => (a.assets || []).includes(assetId));

  // Format date
  const takenDate = meta.takenAt ? new Date(meta.takenAt).toLocaleDateString('en-US', {weekday:'short', year:'numeric', month:'short', day:'numeric'}) : '';
  const takenTime = meta.takenAt ? new Date(meta.takenAt).toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit'}) : '';

  // Map
  const hasGPS = meta.latitude && meta.longitude;
  const mapUrl = hasGPS ? `https://www.openstreetmap.org/export/embed.html?bbox=${meta.longitude-0.01},${meta.latitude-0.01},${meta.longitude+0.01},${meta.latitude+0.01}&layer=mapnik&marker=${meta.latitude},${meta.longitude}` : '';
  const immichLocation = [meta.city, meta.state].filter(Boolean).join(', ');

  // Patch only the right-hand info panel; the image element keeps loading.
  const rightPanel = content.querySelector('.detail-right');
  if (!rightPanel) return;
  rightPanel.outerHTML = `
      <div class="detail-right">
        <div style="padding:0.5rem 1rem;display:flex;flex-direction:column;gap:0.4rem;border-bottom:1px solid var(--border)">
          <div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap">
            ${hasPrev ? `<button class="nav-arrow" data-action="navPrev">‹</button>` : `<div style="width:28px"></div>`}
            ${hasNext ? `<button class="nav-arrow" data-action="navNext">›</button>` : ''}
            <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text-dim);margin-right:0.25rem">${idx+1} / ${total}</div>
            <button class="btn btn-ghost btn-sm" data-action="openAddToAlbumModal" data-id="${assetId}">+ Album</button>
            ${state.viewingFromAlbum ? `<button class="btn btn-ghost btn-sm" data-action="removeFromAlbum" data-id="${assetId}">− Remove</button>` : ''}
            ${state.previousView === 'immich-album-view' && !state.viewingArchived && !state.viewingTrash ? `<button class="btn btn-ghost btn-sm" data-action="removeFromImmichAlbumDetail" data-id="${assetId}">− Remove</button>` : ''}
            ${state.viewingTrash ? `
              <button class="btn btn-ghost btn-sm" data-action="restoreFromTrashDetail" data-id="${assetId}">Restore</button>
              <button class="btn btn-danger btn-sm" data-action="permanentDeleteDetail" data-id="${assetId}" data-filename="${meta.filename}">🗑 Delete Forever</button>
            ` : `
              <button class="${meta.isArchived ? 'btn btn-ghost btn-sm' : 'btn btn-danger btn-sm'}" data-action="${meta.isArchived ? 'restoreFromDetail' : 'archiveFromDetail'}" data-id="${assetId}">${meta.isArchived ? 'Restore' : 'Archive'}</button>
              <button class="btn btn-danger btn-sm" data-action="deleteImmichAsset" data-id="${assetId}" data-filename="${meta.filename}">🗑</button>
            `}
          </div>
          ${!state.viewingTrash ? `
          <div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap">
            <select id="share-size" class="btn btn-ghost btn-sm" title="Share size — S=300-500KB · M=1-1.5MB SMS · L=2-2.7MB · LeicaForum=2048px/≤2.4MB (forum-safe, any aspect) · XL=full original ~9.7MB"><option value="small">S</option><option value="medium" selected>M</option><option value="large">L</option><option value="forum">LeicaForum</option><option value="xlarge">XL</option></select>
            <button class="btn btn-ghost btn-sm" data-action="shareSelected" data-id="${assetId}" data-filename="${meta.filename}" data-desc="${(meta.description||'').replace(/'/g, '&apos;')}" title="Share at selected size">↑ Share</button>
            <select id="embed-size" class="btn btn-ghost btn-sm" title="Embed width (px)"><option value="1024">1024</option><option value="1200">1200</option><option value="1280">1280</option><option value="1400" selected>1400</option><option value="1600">1600</option><option value="2048">2048</option><option value="2400">2400</option></select>
            <button class="btn btn-ghost btn-sm" data-action="copyEmbedUrl" data-id="${assetId}" title="Copy forum [img] BBCode at selected width">⧉ Embed</button>
          </div>` : ''}
        </div>
        <div class="detail-meta">
          ${meta.title ? `<div class="detail-title" style="margin-bottom:0.5rem;font-weight:600;color:var(--text);font-size:18px;line-height:1.3">${meta.title}</div>` : ''}
          ${meta.description ? `<div class="detail-film" style="margin-bottom:0.75rem;font-weight:500;color:var(--text);font-size:16px">${meta.description}</div>` : ''}
          <div class="exif-table">
            ${takenDate ? `
            <div class="exif-row-item">
              <div class="exif-row-icon">📅</div>
              <div class="exif-row-label">Date</div>
              <div class="exif-row-value">${takenDate}<div class="exif-row-sub">${takenTime}</div></div>
            </div>` : ''}
            ${meta.filename ? `
            <div class="exif-row-item">
              <div class="exif-row-icon">🖼</div>
              <div class="exif-row-label">File</div>
              <div class="exif-row-value" style="font-size:11px;word-break:break-all">${meta.filename}</div>
            </div>` : ''}
            ${meta.model ? `
            <div class="exif-row-item">
              <div class="exif-row-icon">📷</div>
              <div class="exif-row-label">Camera</div>
              <div class="exif-row-value">${meta.model}
                <div class="exif-row-sub">${[meta.shutterSpeed, meta.fNumber ? 'f/'+meta.fNumber : '', meta.iso ? 'ISO '+meta.iso : ''].filter(Boolean).join('  ')}</div>
              </div>
            </div>` : ''}
            ${meta.lens ? `
            <div class="exif-row-item">
              <div class="exif-row-icon">🔭</div>
              <div class="exif-row-label">Lens</div>
              <div class="exif-row-value">${meta.lens}</div>
            </div>` : ''}
            ${hasGPS ? `
            <div class="exif-row-item" id="gps-row">
              <div class="exif-row-icon">📍</div>
              <div class="exif-row-label">Location</div>
              <div class="exif-row-value">
                <a href="https://www.openstreetmap.org/?mlat=${meta.latitude}&mlon=${meta.longitude}&zoom=15" target="_blank" style="color:var(--safe);text-decoration:none" id="gps-link">${meta.latitude.toFixed(4)}, ${meta.longitude.toFixed(4)}</a>
                <div class="exif-row-sub">${immichLocation}</div>
              </div>
            </div>` : ''}
            ${assetAlbums.length ? `
            <div class="exif-row-item">
              <div class="exif-row-icon">📁</div>
              <div class="exif-row-label">Albums</div>
              <div class="exif-row-value">
                <div class="print-albums-row" style="margin-top:0">
                  ${assetAlbums.map(a => `<button class="album-chip" data-action="openAlbum" data-id="${a.id}" title="Open album">${a.title}</button>`).join('')}
                </div>
              </div>
            </div>` : ''}
            ${(Array.isArray(meta.tags) && meta.tags.length) ? `
            <div class="exif-row-item">
              <div class="exif-row-icon">🏷</div>
              <div class="exif-row-label">Tags</div>
              <div class="exif-row-value">
                <div style="display:flex;gap:0.25rem;flex-wrap:wrap">
                  ${meta.tags.map(t => `<button class="immich-tag" data-action="searchByImmichTag" data-tag="${t.replace(/"/g,'&quot;')}" title="Show all photos tagged &quot;${t.replace(/"/g,'&quot;')}&quot;" style="background:var(--bg-elev,#222);color:var(--text);padding:2px 8px;border-radius:10px;font-size:11px;font-family:'IBM Plex Mono',monospace;border:1px solid var(--border);cursor:pointer">${t}</button>`).join('')}
                </div>
              </div>
            </div>` : ''}
          </div>
        </div>
      </div>
  `;
}

// Downscale a JPEG/PNG blob via canvas, returning a JPEG blob with longest edge ≤ maxPx.
// Used for the Small / Medium share sizes — gives us message-app-friendly file sizes
// without round-tripping through the server.
async function _downscaleBlob(blob, maxPx, quality = 0.85) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('image decode failed'));
      i.src = url;
    });
    const ratio = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
    if (ratio === 1) return blob;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * ratio);
    canvas.height = Math.round(img.naturalHeight * ratio);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('canvas toBlob null')), 'image/jpeg', quality);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Share preset table — see the ↑ S / M / L / XL buttons in the detail view.
// Server-side endpoint /api/immich/download/:id?size=... returns a sharp-encoded
// JPEG sized to a target byte range. XL bypasses the resize and streams the full
// Q100 original. Targets: S=300-500KB, M=1.0-1.5MB, L=2.0-2.7MB (hard ceiling for
// the Leica forum's 2.7MB upload limit).
const SHARE_PRESETS = {
  small:  { url: 'download', size: 'small'  },
  medium: { url: 'download', size: 'medium' },
  large:  { url: 'download', size: 'large'  },
  forum:  { url: 'download', size: 'forum'  },
  xlarge: { url: 'original' },
};

// In-flight guard for the Web Share API — if the user double-taps a size button (or
// the click fires twice in mobile WebKit), navigator.share rejects the second call
// with "InvalidStateError: share() is already in progress". Without this, the share
// sheet still opens fine for the first call but the user sees a misleading alert.
let _shareInFlight = false;
let _shareReady = null;

// Two-step share UX: phase 1 fetches the image and stashes the prepared shareData,
// phase 2 (a fresh user tap on the modal's "Tap to share" button) calls
// navigator.share(). Required because Safari iOS revokes transient activation if
// share() is awaited too long after the original button tap (e.g., during a
// multi-MB fetch on a slow connection), which surfaces as NotAllowedError.
async function shareRecent(assetId, filename, description, size) {
  if (_shareInFlight) return;
  _shareInFlight = true;
  const preset = SHARE_PRESETS[size] || SHARE_PRESETS.medium;

  // Desktop: Mac share sheet has no Save-to-Disk option, so we fetch the file
  // ourselves (with a spinner for visual feedback during the ~1-30s sharp pass)
  // and trigger a Blob-URL download. Browser saves to Downloads natively.
  const isMobile = /iPad|iPhone|iPod|Android/i.test(navigator.userAgent);
  if (!isMobile || !navigator.share) {
    document.getElementById('share-prep-overlay').classList.add('active');
    document.getElementById('share-prep-state-loading').style.display = '';
    document.getElementById('share-prep-state-ready').style.display = 'none';
    document.getElementById('share-prep-status').textContent = 'Preparing ' + String(size || 'medium').toUpperCase() + '…';
    // Force a paint frame before the fetch — without this Safari can batch the
    // class addition with the network microtask and the spinner never visibly appears.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const url = preset.url === 'original'
        ? '/api/immich/original/' + assetId
        : '/api/immich/download/' + assetId + '?size=' + preset.size;
      const baseName = (filename || assetId).replace(/\.[^.]+$/, '');
      const r = await fetch(url);
      if (!r.ok) throw new Error('download fetch ' + r.status);
      const blob = await r.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = baseName + '.jpg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function() { URL.revokeObjectURL(blobUrl); }, 1000);
      closeShareModal();
    } catch (e) {
      alert('Download failed: ' + e.message);
      closeShareModal();
    } finally {
      _shareInFlight = false;
    }
    return;
  }

  document.getElementById('share-prep-overlay').classList.add('active');
  document.getElementById('share-prep-state-loading').style.display = '';
  document.getElementById('share-prep-state-ready').style.display = 'none';
  document.getElementById('share-prep-status').textContent = 'Preparing ' + String(size || 'medium').toUpperCase() + '…';

  try {
    if (!navigator.share) { alert('Sharing not supported in this browser'); closeShareModal(); return; }
    const url = preset.url === 'original'
      ? '/api/immich/original/' + assetId
      : '/api/immich/download/' + assetId + '?size=' + preset.size;
    const imgRes = await fetch(url);
    if (!imgRes.ok) throw new Error('share fetch ' + imgRes.status);
    const blob = await imgRes.blob();
    const baseName = (filename || assetId).replace(/\.[^.]+$/, '');
    const file = new File([blob], baseName + '.jpg', { type: blob.type || 'image/jpeg' });
    const shareData = { files: [file] };
    if (description) shareData.text = description;
    if (!navigator.canShare || !navigator.canShare(shareData)) {
      alert('This browser cannot share this image. Try the Download button instead.');
      closeShareModal();
      return;
    }

    // Stash and flip modal to "ready" — user taps the button to invoke share().
    _shareReady = shareData;
    document.getElementById('share-prep-state-loading').style.display = 'none';
    document.getElementById('share-prep-state-ready').style.display = '';
  } catch(e) {
    alert('Share failed: ' + e.message);
    closeShareModal();
  } finally {
    _shareInFlight = false;
  }
}

async function executeShare() {
  if (!_shareReady) return;
  const data = _shareReady;
  _shareReady = null;
  closeShareModal();
  try {
    await navigator.share(data);
  } catch(e) {
    if (e.name !== 'AbortError' && e.name !== 'InvalidStateError') {
      alert('Share failed: ' + e.message);
    }
  }
}

function closeShareModal() {
  document.getElementById('share-prep-overlay').classList.remove('active');
  _shareReady = null;
}

async function downloadSelectedAssets() {
  const ids = [...(state.selectedAssets || [])];
  if (!ids.length) { alert('Select at least one photo first.'); return; }
  for (const id of ids) {
    let filename = state.recentMeta[id]?.filename || null;
    if (!filename) {
      try {
        const m = await fetch('/api/immich/photo/' + id).then(r => r.json());
        filename = m.filename || (id + '.jpg');
        if (!state.recentMeta[id]) state.recentMeta[id] = {};
        state.recentMeta[id].filename = filename;
      } catch(e) { filename = id + '.jpg'; }
    }
    const r = await fetch('/api/immich/original/' + id);
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    await new Promise(r => setTimeout(r, 400));
  }
}

async function deleteImmichAsset(assetId, filename) {
  const label = filename || assetId;
  if (!confirm(`Move "${label}" to trash?\n\nImmich keeps items in trash for 30 days before permanent removal.`)) return;
  const r = await fetch('/api/immich/assets/' + assetId, { method: 'DELETE' });
  if (!r.ok) { alert('Delete failed. Please try again.'); return; }
  try {
    if (Array.isArray(state.recentItems)) state.recentItems = state.recentItems.filter(a => a.id !== assetId);
    if (Array.isArray(state.displayedItems)) state.displayedItems = state.displayedItems.filter(a => a.id !== assetId);
    if (Array.isArray(state.recentSmartResults)) state.recentSmartResults = state.recentSmartResults.filter(a => a.id !== assetId);
    delete state.recentMeta[assetId];
    if (typeof applyRecentFilters === 'function') applyRecentFilters();
  } catch(e) { console.warn('Delete UI refresh hit a snag (server DELETE was OK):', e); }
  if (Array.isArray(state.displayedItems) && state.displayedItems.length > 0) {
    const nextIdx = Math.min(state.currentRecentIndex, state.displayedItems.length - 1);
    await showRecentDetail(state.displayedItems[nextIdx].id);
  } else {
    goBackFromDetail();
  }
}

function shareSelected(assetId, filename, description) {
  const sel = document.getElementById('share-size');
  const size = sel ? sel.value : 'medium';
  return shareRecent(assetId, filename, description, size);
}

function enablePinchZoom() {
  const meta = document.querySelector('meta[name=viewport]');
  if (meta) meta.content = 'width=device-width, initial-scale=1.0';
}

function disablePinchZoom() {
  const meta = document.querySelector('meta[name=viewport]');
  if (meta) meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0';
}

let _detailUpgradeTimer = null;
let _detailUpgradeLoader = null;
// Multi-signal mobile detection: ANY of these means treat as mobile and use
// the thumbnail→preview progressive chain instead of loading preview directly.
function _isMobileUA() {
  if (/iPad|iPhone|iPod|Android/i.test(navigator.userAgent)) return true;
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
  if (window.innerWidth < 900) return true;
  return false;
}

function scheduleDetailUpgrade(img) {
  // Generic progressive-upgrade: when img loads, schedule preload of the
  // higher-tier source from data-next; on successful load, swap img.src to
  // it. The browser then fires onload again, this function runs again, and
  // if data-next is set anew, the next upgrade fires — chains naturally.
  if (_detailUpgradeTimer) { clearTimeout(_detailUpgradeTimer); _detailUpgradeTimer = null; }
  if (_detailUpgradeLoader) { _detailUpgradeLoader.onload = null; _detailUpgradeLoader.src = ''; _detailUpgradeLoader = null; }
  const next = img.dataset.next;
  if (!next) return;
  _detailUpgradeTimer = setTimeout(() => {
    _detailUpgradeLoader = new Image();
    _detailUpgradeLoader.onload = () => {
      if (!document.body.contains(img)) return;
      if (img.dataset.next !== next) return; // user navigated; stale upgrade
      img.src = next;
      delete img.dataset.next;
      _detailUpgradeLoader = null;
    };
    _detailUpgradeLoader.src = next;
  }, 400);
}

// Nav generation counter. Each nav bumps it; async work captures the value
// at start and bails if a newer nav has happened (prevents stale-result races
// when fetches return out of order on slow connections).
let _navGen = 0;
let _navPrintLastAt = 0;
function navigatePrint(dir) {
  // Throttle: drop calls within 400ms of the previous one.
  const now = Date.now();
  if (now - _navPrintLastAt < 400) return;
  _navPrintLastAt = now;
  const prints = state.displayedPrints || state.prints;
  const idx = prints.findIndex(p => p.id === state.currentPrintId);
  if (idx === -1) return;
  const next = prints[idx + dir];
  if (!next) return;
  const myGen = ++_navGen;
  if (state.fullscreenOpen) {
    if (_fsZoomer) _fsZoomer.reset();
    _fsLoadProgressive('/api/immich/original/' + next.immichId, myGen);
  }
  showDetail(next.id, myGen);
}

let _navRecentLastAt = 0;
async function navigateRecent(dir) {
  // Throttle: drop calls within 400ms of the previous one.
  const now = Date.now();
  if (now - _navRecentLastAt < 400) return;
  _navRecentLastAt = now;
  const displayedItems = state.displayedItems || state.recentItems;
  const newIdx = state.currentRecentIndex + dir;
  if (newIdx < 0 || newIdx >= displayedItems.length) return;
  state.currentRecentIndex = newIdx;
  state.currentRecentId = displayedItems[newIdx].id;
  const myGen = ++_navGen;
  if (state.fullscreenOpen) {
    if (_fsZoomer) _fsZoomer.reset();
    _fsLoadProgressive('/api/immich/original/' + state.currentRecentId, myGen);
  }
  await renderRecentDetail(state.currentRecentId, myGen);
}

// Fullscreen zoom controller — owned by zoom.js (see public/zoom.js, ported
// from ContactSheet's src/lib/zoom.ts on 2026-04-27). Wraps pinch / pan /
// dblclick / ctrl+wheel / drag on the <img>; the overlay still owns the
// 1-finger swipe-to-page / swipe-to-close / tap-zone gestures and gates them
// on _fsIsZoomed() so a pan doesn't get re-interpreted.
let _fsZoomer = null;
function _fsIsZoomed() { return _fsZoomer ? _fsZoomer.isZoomed() : false; }

// Two-stage progressive image load. Without this, Safari caches the
// initial-decode bitmap at layout size and zoomed views look soft no matter
// how high-res the source. Setting src twice (once for the preview, once
// for the original) forces Safari to re-decode at the natural resolution,
// matching ContactSheet's behavior. Also adds a visible "sharpening" cue
// as the high-res tier swaps in.
function _fsLoadProgressive(originalUrl, navGen) {
  // Gen guard: if a newer nav has happened by the time a stage finishes, don't
  // swap in the now-stale image — would render the wrong photo after a slow
  // connection's preload finally lands.
  const myGen = navGen != null ? navGen : _navGen;
  const img = document.getElementById('fullscreen-img');
  const m = originalUrl.match(/\/immich\/original\/([0-9a-f-]+)/i);
  if (!m) { img.src = originalUrl; return; }
  const id = m[1];
  const current = () => myGen === _navGen && img &&
    document.getElementById('fullscreen-overlay').classList.contains('active');
  // Type-agnostic fallback: the mobile first-paint uses the sharp-based display
  // endpoint, which 502s on video / RAW / TIFF originals. Immich's own thumb
  // renders a frame for any asset type, so fall back to it if the first paint
  // errors. (onerror as a JS property — CSP allows property assigns.)
  img.onerror = () => { img.onerror = null; if (current()) img.src = thumbSrc(id, {size:'preview'}); };
  const loadOriginal = () => {
    const orig = new Image();
    // Only swap once the original actually decodes as an image — a video/RAW
    // original must not replace a good first paint with a broken <img>. Defer
    // neighbour prefetch until it lands so the prefetch doesn't compete with
    // the current photo's load on weak 5G.
    orig.onload = () => { if (current()) { img.onerror = null; img.src = originalUrl; if (_isMobileUA()) _fsPreloadNeighbors(); } };
    orig.src = originalUrl;
  };
  if (_isMobileUA()) {
    // Mobile/cellular: lead with the adaptive display variant — light
    // (~200-300 KB) AND ≥ the device width, so it paints full-screen fast for
    // quick nav feedback without the small-then-grow "jump".
    img.src = _dispUrl(id);
  } else {
    // Desktop: fast connection — plain ~1440px preview then original (the
    // display variant can be narrower than a big monitor → visible grow).
    img.src = thumbSrc(id, {size:'preview'});
  }
  loadOriginal();
}
// Mobile only: prefetch adjacent photos' display variants so the first-paint
// stage is already cached on the next prev/next tap (recent/library fullscreen).
function _fsPreloadNeighbors() {
  const items = state.displayedItems || state.recentItems;
  const i = state.currentRecentIndex;
  if (!Array.isArray(items) || typeof i !== 'number') return;
  [1, -1].forEach(d => {
    const it = items[i + d];
    if (it && it.id) { const pre = new Image(); pre.src = _dispUrl(it.id); }
  });
}

function openFullscreen(src) {
  // Tear down any leftover zoomer before swapping src so transform state from
  // the previous image doesn't survive on the element.
  if (_fsZoomer) { _fsZoomer.destroy(); _fsZoomer = null; }
  const img = document.getElementById('fullscreen-img');
  _fsLoadProgressive(src);
  document.getElementById('fullscreen-overlay').classList.add('active');
  state.fullscreenOpen = true;
  // Wait until the image has real dimensions before attaching — clamp() reads
  // clientWidth/Height, which are stale until the new src loads. Attach on
  // the FIRST stage's load so zoom is responsive even before the original
  // tier swaps in. The zoomer survives the stage-2 src swap (same element).
  const attach = () => {
    if (_fsZoomer) return;
    _fsZoomer = window.makeZoomer(img, {
      onDoubleTap: () => {
        if (typeof window._fsCancelPendingClick === 'function') window._fsCancelPendingClick();
        // iOS fires synthetic click events ~300ms AFTER touchend. zoom.js
        // detects the double-tap touch-side and toggles zoom first, so by
        // the time the click arrives _fsIsZoomed() is already false and the
        // click handler's "bail if zoomed" guard doesn't catch it. Suppress
        // any clicks that land within 600ms of the double-tap.
        window._fsIgnoreClicksUntil = Date.now() + 600;
      }
    });
  };
  if (img.complete && img.naturalWidth > 0) {
    attach();
  } else {
    img.addEventListener('load', attach, { once: true });
  }
}

function closeFullscreen() {
  if (_fsZoomer) { _fsZoomer.destroy(); _fsZoomer = null; }
  document.getElementById('fullscreen-overlay').classList.remove('active');
  state.fullscreenOpen = false;
}

let _fsLastNavAt = 0;
function fullscreenNavigate(dir) {
  // Cooldown: drop any nav that lands within 400ms of the previous one.
  // Prevents a stray click + swipe (or two queued clicks) from skipping
  // an image when the user only meant to advance once.
  const now = Date.now();
  if (now - _fsLastNavAt < 400) return;
  _fsLastNavAt = now;
  // Reset before src change so the new image starts at 1× / centered. The
  // zoomer survives across navigate (same <img> element), which is cheaper
  // than destroy + reattach on every prev/next.
  if (_fsZoomer) _fsZoomer.reset();
  if (document.getElementById('detail-view').classList.contains('active')) {
    navigatePrint(dir);
  } else {
    navigateRecent(dir);
  }
}



// Keyboard navigation
document.addEventListener('keydown', e => {
  // When any modal is open, don't run the page-level nav handlers (otherwise
  // arrow keys leak through to navigatePrint/navigateRecent and silently
  // change state.currentPrintId while the user is filling in a session form).
  if (document.querySelector('.modal-overlay.active')) return;
  const ssOverlay = document.getElementById('slideshow-overlay');
  if (ssOverlay && ssOverlay.classList.contains('active')) {
    if (e.key === 'ArrowLeft') slideshowPrev();
    if (e.key === 'ArrowRight') slideshowNext();
    if (e.key === 'Escape') closeSlideshow();
    if (e.key === ' ') { e.preventDefault(); toggleSlideshow(); }
    return;
  }
  if (document.getElementById('recent-detail-view').classList.contains('active')) {
    if (e.key === 'ArrowLeft') navigateRecent(-1);
    if (e.key === 'ArrowRight') navigateRecent(1);
    if (e.key === 'Escape') {
      if (state.fullscreenOpen) {
        closeFullscreen();
      } else {
        goBackFromDetail();
      }
    }
  }
  if (document.getElementById('detail-view').classList.contains('active')) {
    if (e.key === 'ArrowLeft') navigatePrint(-1);
    if (e.key === 'ArrowRight') navigatePrint(1);
    if (e.key === 'Escape') { state.fullscreenOpen ? closeFullscreen() : closePrintDetail(); }
  }
});

// Trackpad two-finger swipe up to go back
let wheelAccum = 0;
document.addEventListener('wheel', e => {
  const inRecent = document.getElementById('recent-detail-view').classList.contains('active');
  const inPrintDetail = document.getElementById('detail-view').classList.contains('active');
  if (!inRecent && !inPrintDetail) return;
  if (state.fullscreenOpen) return;
  // Only trigger on the image side (detail-left), not the scrollable right panel
  const left = document.querySelector('.detail-left');
  if (left && left.contains(e.target)) {
    wheelAccum += e.deltaY;
    if (wheelAccum < -80 && Math.abs(e.deltaX) < 40) {
      wheelAccum = 0;
      inPrintDetail ? closePrintDetail() : goBackFromDetail();
    }
  } else {
    wheelAccum = 0;
  }
}, {passive: true});

// Touch swipe navigation
let touchStartX = null;
let touchStartY = null;
document.addEventListener('touchstart', e => {
  const inRecent = document.getElementById('recent-detail-view').classList.contains('active');
  const inPrintDetail = document.getElementById('detail-view').classList.contains('active');
  if (inRecent || inPrintDetail) {
    // Only track swipes that start on the image side — leave the info text free to scroll
    if (!e.target.closest('.detail-left')) { touchStartX = null; return; }
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }
}, {passive: true});
document.addEventListener('touchend', e => {
  const inRecent = document.getElementById('recent-detail-view').classList.contains('active');
  const inPrintDetail = document.getElementById('detail-view').classList.contains('active');
  if (!touchStartX || (!inRecent && !inPrintDetail)) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (inPrintDetail && dy > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) {
    closePrintDetail();
  } else if (inPrintDetail && Math.abs(dx) > 70 && Math.abs(dy) < 50) {
    dx < 0 ? navigatePrint(1) : navigatePrint(-1);
  } else if (inRecent && dy > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) {
    goBackFromDetail();
  } else if (inRecent && Math.abs(dx) > 70 && Math.abs(dy) < 50) {
    dx < 0 ? navigateRecent(1) : navigateRecent(-1);
  }
  touchStartX = null;
  touchStartY = null;
}, {passive: true});
// ── ALBUMS ───────────────────────────────────────────────────────────────────

async function loadAlbumsTab() {
  const r = await fetch('/api/albums');
  state.albums = await r.json();
  renderAlbumsGrid();
}

// Sort albums for display (non-mutating — returns a sorted copy). ISO date
// strings compare lexicographically = chronologically, so localeCompare works.
function sortAlbums(albums, sort) {
  const arr = albums.slice();
  const name = a => (a.title || '').toLowerCase();
  const upd = a => a.updatedAt || a.createdAt || '';
  switch (sort) {
    case 'created': arr.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')); break;
    case 'name':    arr.sort((a, b) => name(a).localeCompare(name(b))); break;
    case 'count':   arr.sort((a, b) => (b.assets?.length || 0) - (a.assets?.length || 0) || name(a).localeCompare(name(b))); break;
    case 'updated':
    default:        arr.sort((a, b) => upd(b).localeCompare(upd(a))); break;
  }
  return arr;
}

function renderAlbumsGrid() {
  const grid = document.getElementById('albums-grid');
  if (!state.albums.length) {
    grid.innerHTML = '<div class="album-empty" style="grid-column:1/-1">No albums yet.<br>Tap + Album to create one.</div>';
    return;
  }
  grid.innerHTML = sortAlbums(state.albums, state.albumSort).map(a => `
    <div class="album-item" data-action="openAlbum" data-id="${a.id}">
      ${a.assets.length ? `<img src="${thumbSrc(a.assets[0])}" loading="lazy" onerror="this.style.background='#1a1a1a'">` : '<div class="album-item-empty" style="width:100%;height:100%"></div>'}
      <div class="album-item-info">
        <div class="album-item-title">${a.title}</div>
        <div class="album-item-count">${a.assets.length} photo${a.assets.length !== 1 ? 's' : ''}</div>
      </div>
    </div>
  `).join('');
}

function openAlbum(albumId) {
  state.recentGen++; // leaving the live Library grid — stop stale loaders repainting it
  state.currentAlbum = state.albums.find(a => a.id === albumId);
  state.albumEditMode = false;
  state.albumSelectMode = false;
  state.albumSelected = new Set();
  lastSelectedIdx = -1;
  // Explicitly hide all views
  ['gallery-view','recent-view','recent-detail-view','albums-view','album-detail-view'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  document.getElementById('album-detail-view').classList.add('active');
  document.getElementById('back-btn').style.display = 'flex';
  document.getElementById('back-btn').onclick = () => {
    document.getElementById('album-detail-view').classList.remove('active');
    document.getElementById('albums-view').classList.add('active');
    document.getElementById('back-btn').style.display = 'none';
    document.getElementById('back-btn').onclick = showGallery;
    document.getElementById('header-title').textContent = 'Darkroom Log';
    loadAlbumsTab();
  };
  document.getElementById('header-title').textContent = state.currentAlbum.title;
  renderAlbumDetail();
}

function renderAlbumDetail() {
  const album = state.currentAlbum;
  const editMode = state.albumEditMode;
  const grid = document.getElementById('album-photo-grid');
  const toolbar = document.getElementById('album-toolbar');
  const shareUrl = window.location.origin + '/album/' + album.slug;

  toolbar.innerHTML = `
    <div style="max-width:1200px;margin:0 auto;width:100%;display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" data-action="openSlideshowSettings">▶ Slideshow</button>
      <button class="btn btn-ghost btn-sm" data-action="toggleAlbumEdit">${editMode ? '✓ Done' : '⇄ Reorder'}</button>
      <button class="btn btn-ghost btn-sm" data-action="renameAlbum" data-id="${album.id}">✎ Rename</button>
      <button class="btn btn-danger btn-sm" data-action="deleteAlbum" data-id="${album.id}">Delete</button>
      <button class="btn btn-ghost btn-sm" data-action="toggleAlbumSelectMode">Select</button>
      <div style="flex:1"></div>
      <div class="share-link-box" data-action="copyShareLink" data-url="${shareUrl}" title="Copy share link" style="font-size:10px">🔗 ${shareUrl}</div>
    </div>
    <div id="album-select-toolbar" style="max-width:1200px;margin:0.5rem auto 0;width:100%;gap:0.5rem;align-items:center;display:${state.albumSelectMode ? 'flex' : 'none'}">
      <span id="album-select-count" style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--text-dim)">${state.albumSelected ? state.albumSelected.size : 0} selected</span>
      <button class="btn btn-ghost btn-sm" data-action="downloadSelectedAlbumPhotos">↓ Download</button>
      <button class="btn btn-danger btn-sm" data-action="removeSelectedFromAlbum">− Remove</button>
      <button class="btn btn-ghost btn-sm" data-action="toggleAlbumSelectMode">✕ Cancel</button>
    </div>
  `;

  if (!album.assets.length) {
    grid.innerHTML = '<div class="album-empty" style="grid-column:1/-1;padding:3rem;text-align:center;color:var(--text-dim);font-family:IBM Plex Mono,monospace;font-size:11px">No photos yet.<br>Add photos from the Library tab.</div>';
    grid.className = 'gallery-grid';
    return;
  }

  grid.className = 'gallery-grid' + (editMode ? ' album-edit-mode' : '');
  const inSelectMode = state.albumSelectMode;
  const selected = state.albumSelected || new Set();

  grid.innerHTML = album.assets.map((assetId, idx) => `
    <div class="gallery-item${inSelectMode && selected.has(assetId) ? ' selected' : ''}"
         draggable="${editMode}"
         data-drag-idx="${idx}"
         data-action="albumPhotoClick" data-id="${assetId}" data-idx="${idx}">
      <img src="${thumbSrc(assetId)}" loading="lazy" onerror="this.style.background='#1a1a1a'" style="cursor:pointer">
      ${editMode ? `<button class="album-photo-remove" data-action="removeFromAlbum" data-id="${assetId}">×</button>` : ''}
      ${inSelectMode ? `<div class="select-check${selected.has(assetId) ? ' active' : ''}"></div>` : ''}
      ${!editMode && !inSelectMode ? `<button class="btn btn-ghost btn-sm" style="position:absolute;bottom:0.4rem;right:0.4rem;opacity:0;transition:opacity 0.2s;font-size:10px" data-action="openAlbumSlideshow" data-idx="${idx}">▶</button>` : ''}
    </div>
  `).join('');
}

async function showAlbumPhotoDetail(assetId, idx) {
  state.previousView = 'album-detail-view';
  state.viewingFromAlbum = true;
  const album = state.currentAlbum;
  // Page the album lightbox via displayedItems ONLY. Do NOT overwrite
  // state.recentItems (the Library tab's dataset) — otherwise after viewing an
  // album photo, clicking LIBRARY renders the album's photos instead of the
  // real library. All prev/next reads fall back as `displayedItems || recentItems`,
  // and renderRecentGrid() resets displayedItems when the Library re-renders.
  state.displayedItems = album.assets.map(id => ({ id, originalFileName: '', createdAt: '' }));
  await showRecentDetail(assetId);
}

function toggleAlbumSelectMode() {
  state.albumSelectMode = !state.albumSelectMode;
  state.albumSelected = new Set();
  lastSelectedIdx = -1;
  renderAlbumDetail();
}

let lastSelectedIdx = -1;
function toggleAlbumPhotoSelect(assetId, e) {
  if (!state.albumSelected) state.albumSelected = new Set();
  const album = state.currentAlbum;
  const idx = album.assets.indexOf(assetId);
  if (e && e.shiftKey && lastSelectedIdx >= 0) {
    // Select range between lastSelectedIdx and idx
    const from = Math.min(lastSelectedIdx, idx);
    const to = Math.max(lastSelectedIdx, idx);
    for (let i = from; i <= to; i++) state.albumSelected.add(album.assets[i]);
  } else {
    if (state.albumSelected.has(assetId)) state.albumSelected.delete(assetId);
    else state.albumSelected.add(assetId);
    lastSelectedIdx = idx;
  }
  renderAlbumDetail();
}

async function downloadSelectedAlbumPhotos() {
  const ids = [...(state.albumSelected || [])];
  if (!ids.length) return;
  for (const id of ids) {
    // Get original filename from meta or fetch it
    let filename = state.recentMeta[id]?.filename || null;
    if (!filename) {
      try {
        const m = await fetch('/api/immich/photo/' + id).then(r => r.json());
        filename = m.filename || (id + '.jpg');
        if (!state.recentMeta[id]) state.recentMeta[id] = {};
        state.recentMeta[id].filename = filename;
      } catch(e) { filename = id + '.jpg'; }
    }
    const r = await fetch('/api/immich/original/' + id);
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    await new Promise(r => setTimeout(r, 400));
  }
}

function toggleAlbumEdit() {
  state.albumEditMode = !state.albumEditMode;
  renderAlbumDetail();
}

async function renameAlbum(albumId) {
  const album = (state.currentAlbum && state.currentAlbum.id === albumId)
    ? state.currentAlbum
    : (state.albums || []).find(a => a.id === albumId);
  if (!album) return;
  const name = prompt('Rename album:', album.title);
  if (name === null) return;               // cancelled
  const title = name.trim();
  if (!title || title === album.title) return;
  // "Ask me each rename": let the user decide whether the public URL changes
  // too. Default (Cancel) keeps the slug so existing share links + the
  // lakatua.me embed don't break.
  const updateSlug = confirm(
    `Rename to "${title}".\n\n` +
    `Also update the public URL to match the new name?\n\n` +
    `OK = update URL  (⚠ breaks existing share links + lakatua.me embed)\n` +
    `Cancel = keep current URL  /album/${album.slug}`
  );
  let r;
  try {
    r = await fetch('/api/albums/' + albumId, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, updateSlug })
    });
  } catch (e) { alert('Rename failed: ' + e.message); return; }
  if (!r.ok) { alert('Rename failed (' + r.status + ')'); return; }
  const updated = await r.json();
  album.title = updated.title;
  album.slug = updated.slug;
  if (state.albums) {
    state.albums = state.albums.map(a => a.id === albumId
      ? { ...a, title: updated.title, slug: updated.slug } : a);
  }
  if (state.currentAlbum && state.currentAlbum.id === albumId) {
    document.getElementById('header-title').textContent = updated.title;
    renderAlbumDetail();
  }
}

async function deleteAlbum(albumId) {
  if (!confirm('Delete this album? Photos in Immich are not affected.')) return;
  await fetch('/api/albums/' + albumId, { method: 'DELETE' });
  document.getElementById('album-detail-view').classList.remove('active');
  document.getElementById('albums-view').classList.add('active');
  document.getElementById('back-btn').style.display = 'none';
  document.getElementById('header-title').textContent = 'Darkroom Log';
  loadAlbumsTab();
}

async function removeFromAlbum(assetId) {
  const album = state.currentAlbum;
  album.assets = album.assets.filter(a => a !== assetId);
  await fetch('/api/albums/' + album.id, {
    method: 'PUT', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ assets: album.assets })
  });
  if (document.getElementById('recent-detail-view')?.classList.contains('active')) goBackFromDetail();
  renderAlbumDetail();
}

async function removeSelectedFromAlbum() {
  const album = state.currentAlbum;
  const toRemove = state.albumSelected || new Set();
  if (!toRemove.size) return;
  album.assets = album.assets.filter(a => !toRemove.has(a));
  await fetch('/api/albums/' + album.id, {
    method: 'PUT', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ assets: album.assets })
  });
  state.albumSelectMode = false;
  state.albumSelected = new Set();
  renderAlbumDetail();
}

// Drag to reorder
let dragSrcIdx = null;
function dragStart(e, idx) { dragSrcIdx = idx; e.dataTransfer.effectAllowed = 'move'; }
function dragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
async function dragDrop(e, targetIdx) {
  e.preventDefault();
  if (dragSrcIdx === null || dragSrcIdx === targetIdx) return;
  const album = state.currentAlbum;
  const assets = [...album.assets];
  const [moved] = assets.splice(dragSrcIdx, 1);
  assets.splice(targetIdx, 0, moved);
  album.assets = assets;
  dragSrcIdx = null;
  await fetch('/api/albums/' + album.id, {
    method: 'PUT', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ assets })
  });
  renderAlbumDetail();
}

// Create album modal
function openCreateAlbumModal() {
  document.getElementById('new-album-title').value = '';
  document.getElementById('create-album-modal').classList.add('active');
}

async function createAlbum() {
  const title = document.getElementById('new-album-title').value.trim();
  if (!title) return;
  const r = await fetch('/api/albums', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ title })
  });
  const album = await r.json();
  closeModal('create-album-modal');
  state.albums.push(album);
  renderAlbumsGrid();
}

// Add to album from Recent detail
function openAddToAlbumModal(assetId) {
  state.pendingAddAssetId = assetId;
  document.getElementById('quick-album-name').value = '';
  document.getElementById('quick-immich-album-name').value = '';
  renderDarkroomAlbumPickList();
  switchAlbumModalTab('darkroom');
  document.getElementById('add-to-album-modal').classList.add('active');
}

function switchAlbumModalTab(tab) {
  document.getElementById('album-panel-darkroom').style.display = tab === 'darkroom' ? '' : 'none';
  document.getElementById('album-panel-immich').style.display = tab === 'immich' ? '' : 'none';
  document.getElementById('album-tab-darkroom').classList.toggle('active', tab === 'darkroom');
  document.getElementById('album-tab-immich').classList.toggle('active', tab === 'immich');
  if (tab === 'immich') renderImmichAlbumPickList();
}

async function renderDarkroomAlbumPickList() {
  const list = document.getElementById('album-pick-list');
  // Lazy-load on demand — the boot-time fetch is fire-and-forget, so a fast
  // "+ Album" tap can hit this before state.albums is populated and falsely
  // render "No albums yet".
  if (!Array.isArray(state.albums)) {
    list.innerHTML = '<div style="color:var(--text-dim);font-family:IBM Plex Mono,monospace;font-size:11px;margin-bottom:0.5rem">Loading albums…</div>';
    try {
      const r = await fetch('/api/albums');
      const data = await r.json();
      if (Array.isArray(data)) state.albums = data;
    } catch (e) { /* fall through to empty render */ }
  }
  if (!Array.isArray(state.albums) || !state.albums.length) {
    list.innerHTML = '<div style="color:var(--text-dim);font-family:IBM Plex Mono,monospace;font-size:11px;margin-bottom:0.5rem">No albums yet</div>';
    return;
  }
  list.innerHTML = state.albums.map(a => `
    <button class="btn btn-ghost btn-sm" style="width:100%;text-align:left;margin-bottom:0.4rem" data-action="addToAlbum" data-id="${a.id}">${a.title} (${a.assets.length})</button>
  `).join('');
}

async function renderImmichAlbumPickList() {
  const list = document.getElementById('immich-album-pick-list');
  list.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const albums = await fetch('/api/immich/immich-albums').then(r => r.json());
    if (!albums || !albums.length) {
      list.innerHTML = '<div style="color:var(--text-dim);font-family:IBM Plex Mono,monospace;font-size:11px">No Immich albums found</div>';
      return;
    }
    list.innerHTML = albums.map(a => `
      <button class="btn btn-ghost btn-sm" style="width:100%;text-align:left;margin-bottom:0.4rem" data-action="addToImmichAlbum" data-id="${a.id}">${a.albumName || 'Untitled'} (${a.assetCount || 0})</button>
    `).join('');
  } catch(e) {
    list.innerHTML = '<div style="color:var(--red);font-size:11px">Error loading albums</div>';
  }
}

async function addToImmichAlbum(albumId) {
  const ids = Array.isArray(state.pendingAddAssetId) ? state.pendingAddAssetId : [state.pendingAddAssetId];
  try {
    const r = await fetch(`/api/immich/immich-albums/${albumId}/assets`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    if (!r.ok) throw new Error('Failed');
    closeModal('add-to-album-modal');
    state.pendingAddAssetId = null;
    if (state.immichSelectMode) exitImmichSelectMode();
    // Re-render the detail view so the Albums panel reflects the new membership
    // without the user having to back out and re-open the photo.
    if (state.currentRecentId && document.getElementById('recent-detail-view').classList.contains('active')) {
      await renderRecentDetail(state.currentRecentId);
    }
  } catch(e) { alert('Failed to add to Immich album.'); }
}

async function quickCreateAndAddImmich() {
  const name = document.getElementById('quick-immich-album-name').value.trim();
  if (!name) return;
  const ids = Array.isArray(state.pendingAddAssetId) ? state.pendingAddAssetId : [state.pendingAddAssetId];
  try {
    const r = await fetch('/api/immich/immich-albums', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ albumName: name, assetIds: ids })
    });
    if (!r.ok) throw new Error('Failed');
    closeModal('add-to-album-modal');
    state.pendingAddAssetId = null;
    if (state.immichSelectMode) exitImmichSelectMode();
    if (state.currentRecentId && document.getElementById('recent-detail-view').classList.contains('active')) {
      await renderRecentDetail(state.currentRecentId);
    }
  } catch(e) { alert('Failed to create Immich album.'); }
}

async function removeFromImmichAlbum(assetId) {
  if (!state.currentImmichAlbumId) return;
  const ids = Array.isArray(assetId) ? assetId : [assetId];
  const count = ids.length;
  if (!confirm(`Remove ${count} photo${count !== 1 ? 's' : ''} from this album?\n\nThe photo${count !== 1 ? 's' : ''} will stay in your Immich library.`)) return;
  try {
    const r = await fetch(`/api/immich/immich-albums/${state.currentImmichAlbumId}/assets`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    if (!r.ok) throw new Error('Failed');
    state.currentImmichAlbumAssets = state.currentImmichAlbumAssets.filter(a => !ids.includes(a.id));
    applyImmichFiltersAndSort();
    if (state.immichSelectMode) exitImmichSelectMode();
    if (document.getElementById('recent-detail-view').classList.contains('active')) goBackFromDetail();
  } catch(e) { alert('Failed to remove from album.'); }
}

async function archiveImmichAssets(assetIds) {
  const ids = Array.isArray(assetIds) ? assetIds : [assetIds];
  const count = ids.length;
  if (!confirm(`Archive ${count} photo${count !== 1 ? 's' : ''}?\n\nThey will be hidden from the main Immich library. You can restore them later.`)) return;
  let serverOk = false;
  try {
    const r = await fetch('/api/immich/assets/archive', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    if (!r.ok) throw new Error('Failed');
    serverOk = true;
  } catch(e) {
    alert('Archive failed.');
    return;
  }
  // PUT succeeded — UI updates from here on must NOT bubble back as "Archive failed".
  // The detail view is reachable from contexts (search, recent feed) where
  // currentImmichAlbumAssets isn't populated, so guard each step.
  try {
    if (Array.isArray(state.currentImmichAlbumAssets)) {
      state.currentImmichAlbumAssets = state.currentImmichAlbumAssets.filter(a => !ids.includes(a.id));
      applyImmichFiltersAndSort();
    }
    // Library tab: drop archived assets from every list that feeds the grid,
    // then re-run the canonical filter pipeline so the grid actually re-renders.
    // (v1.5.32 had `renderRecentGrid()` with no args — rendered `undefined` and
    // silently no-op'd, which is why the photo stayed on screen.)
    if (Array.isArray(state.recentItems)) {
      state.recentItems = state.recentItems.filter(a => !ids.includes(a.id));
    }
    if (Array.isArray(state.displayedItems)) {
      state.displayedItems = state.displayedItems.filter(a => !ids.includes(a.id));
    }
    if (Array.isArray(state.recentSmartResults)) {
      state.recentSmartResults = state.recentSmartResults.filter(a => !ids.includes(a.id));
    }
    if (typeof applyRecentFilters === 'function') applyRecentFilters();
    if (state.immichSelectMode) exitImmichSelectMode();
    if (document.getElementById('recent-detail-view')?.classList.contains('active')) goBackFromDetail();
  } catch(e) {
    console.warn('Archive UI refresh hit a snag (server PUT was OK):', e);
  }
}

async function restoreImmichAssets(assetIds) {
  const ids = Array.isArray(assetIds) ? assetIds : [assetIds];
  const count = ids.length;
  if (!confirm(`Restore ${count} photo${count !== 1 ? 's' : ''} from archive?\n\nThey will reappear in the main Immich library.`)) return;
  let serverOk = false;
  try {
    const r = await fetch('/api/immich/assets/restore', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    if (!r.ok) throw new Error('Failed');
    serverOk = true;
  } catch(e) {
    alert('Restore failed.');
    return;
  }
  try {
    if (Array.isArray(state.currentImmichAlbumAssets)) {
      state.currentImmichAlbumAssets = state.currentImmichAlbumAssets.map(a =>
        ids.includes(a.id) ? { ...a, isArchived: false } : a
      );
      applyImmichFiltersAndSort();
    }
    if (state.immichSelectMode) exitImmichSelectMode();
    if (document.getElementById('recent-detail-view')?.classList.contains('active')) {
      await renderRecentDetail(state.currentRecentId);
    }
  } catch(e) {
    console.warn('Restore UI refresh hit a snag (server PUT was OK):', e);
  }
}

function updateImmichArchiveBtn() {
  const btn = document.getElementById('btn-immich-archive-toggle');
  const removeBtn = document.querySelector('#immich-select-toolbar [data-action="removeImmichSelectedFromAlbum"]');
  const permDelBtn = document.getElementById('btn-immich-perm-delete');
  if (!btn) return;
  // In trash view: show Restore From Trash, hide Archive, hide Remove, show Delete Forever
  if (state.viewingTrash) {
    btn.textContent = 'Restore';
    btn.className = 'btn btn-ghost btn-sm';
    btn.dataset.action = 'restoreFromTrashSelected';
    if (removeBtn) removeBtn.style.display = 'none';
    if (permDelBtn) permDelBtn.style.display = '';
    return;
  }
  if (permDelBtn) permDelBtn.style.display = 'none';
  // In archived view all photos are already archived — always show Restore, hide Remove
  if (state.viewingArchived) {
    btn.textContent = 'Restore';
    btn.className = 'btn btn-ghost btn-sm';
    btn.dataset.action = 'restoreImmichSelected';
    if (removeBtn) removeBtn.style.display = 'none';
    return;
  }
  if (removeBtn) removeBtn.style.display = '';
  const selectedIds = [...state.immichSelected];
  const assets = state.currentImmichAlbumAssets;
  const allArchived = selectedIds.length > 0 && selectedIds.every(id => {
    const a = assets.find(x => x.id === id);
    return a && a.isArchived;
  });
  btn.textContent = allArchived ? 'Restore' : 'Archive';
  btn.className = allArchived ? 'btn btn-ghost btn-sm' : 'btn btn-danger btn-sm';
  btn.dataset.action = allArchived ? 'restoreImmichSelected' : 'archiveImmichSelected';
}

async function addToAlbum(albumId) {
  const album = state.albums.find(a => a.id === albumId);
  if (!album) return;
  const toAdd = Array.isArray(state.pendingAddAssetId) ? state.pendingAddAssetId : [state.pendingAddAssetId];
  // v1.5.45 — prepend new adds so the just-added photo is the first thing
  // visible when the album opens. Preserves selection order on multi-add.
  const newAdds = toAdd.filter(id => !album.assets.includes(id));
  const newAssets = [...newAdds, ...album.assets];
  const cover = album.cover || newAssets[0];
  await fetch('/api/albums/' + albumId, {
    method: 'PUT', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ assets: newAssets, cover })
  });
  album.assets = newAssets;
  album.cover = cover;
  closeModal('add-to-album-modal');
  state.pendingAddAssetId = null;
  if (state.selectMode) exitSelectMode();
  if (state.immichSelectMode) exitImmichSelectMode();
  if (state.currentRecentId && document.getElementById('recent-detail-view').classList.contains('active')) {
    await renderRecentDetail(state.currentRecentId);
  }
}

async function quickCreateAndAdd() {
  const title = document.getElementById('quick-album-name').value.trim();
  if (!title) return;
  try {
    // Dedupe by title — if an album with this name already exists, add into it
    // instead of spawning a duplicate. Refresh from the server first so a stale
    // client list (e.g. one created on another device) can't slip a dupe through.
    try {
      const fresh = await fetch('/api/albums').then(r => r.json());
      if (Array.isArray(fresh)) state.albums = fresh;
    } catch (e) { /* fall back to in-memory list */ }
    const existing = (state.albums || []).find(a => (a.title || '').trim().toLowerCase() === title.toLowerCase());
    if (existing) { await addToAlbum(existing.id); return; }
    const r = await fetch('/api/albums', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ title })
    });
    if (!r.ok) throw new Error('Server error');
    const album = await r.json();
    if (!album || !album.id) throw new Error('Invalid response');
    state.albums.push(album);
    await addToAlbum(album.id);
  } catch(e) {
    alert('Failed to create album. Please try again.');
  }
}

function copyShareLink(url) {
  navigator.clipboard.writeText(url).then(() => {
    alert('Share link copied to clipboard!');
  });
}

function copyEmbedUrl(assetId) {
  const sel = document.getElementById('embed-size');
  const width = sel ? sel.value : 1400;
  const url = `${location.origin}/embed/${assetId}-${width}.jpg`;
  navigator.clipboard.writeText(url).then(() => {
    alert('Embed URL copied:\n' + url);
  }).catch(() => {
    prompt('Copy this:', url);
  });
}

// ── SLIDESHOW ─────────────────────────────────────────────────────────────────

function startSlideshow() {
  openAlbumSlideshow(0);
}

async function openAlbumSlideshow(startIdx) {
  const album = state.currentAlbum;
  if (!album || !album.assets.length) return;
  state.slideshow = { active: true, index: startIdx, timer: null, paused: false, beatIdx: null, beatPtnIdx: null, slidesShown: 1 };
  ssActiveSlot = 'a';
  ssDescVisible = true;
  document.getElementById('slideshow-slide-a').innerHTML = '';
  document.getElementById('slideshow-slide-b').innerHTML = '';
  document.getElementById('slideshow-overlay').classList.add('active');
  // Auto-enter fullscreen using the user-gesture activation from the
  // Start-button tap that called us. Desktop + Android honor this; iOS
  // Safari rejects fullscreen on non-video elements, so the request no-ops
  // there — overlay is already position:fixed inset:0 anyway.
  // Only auto-fullscreen on touch-primary devices. Desktop stays in browser
  // tab; user can hit the ⤢ button manually if they want fullscreen.
  if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) {
    try {
      const ov = document.getElementById('slideshow-overlay');
      const req = ov.requestFullscreen || ov.webkitRequestFullscreen;
      if (req) { const p = req.call(ov); if (p && p.catch) p.catch(()=>{}); }
    } catch(e) { /* iOS / no permission — ignore */ }
  }
  // Start music
  startSlideshowMusic(album.slideshowSettings || {});
  // Show title card first if enabled, otherwise go straight to first slide
  await showTitleCard(album);
  // beatIdx tracks the last-scheduled beat index for tempo presets; null
  // means "re-anchor on next scheduleNext call". beatPtnIdx cycles through
  // the beat-step pattern (e.g. [8,4,8,4,...]). ssUrlPin is cleared so a new
  // run re-picks the display width before pinning per-slide URLs.
  state.slideshow.beatIdx = null;
  state.slideshow.beatPtnIdx = null;
  ssUrlPin = {};
  _stopPaceBadge();
  showSlide(startIdx);
  // showSlide's image-load callback calls scheduleNext — single source of
  // truth, prevents the historical double-scheduling bug
  showSlideshowControls();
}

// ── SLIDESHOW SETTINGS ──────────────────────────────────────────────────────

function openSlideshowSettings() {
  const album = state.currentAlbum;
  if (!album || !album.assets.length) return;
  // Warm AudioContext inside this user-gesture handler.
  try { if (window.DarkroomAudio) DarkroomAudio.ensureCtx(); } catch(e) {}
  const settings = album.slideshowSettings || {};
  // Restore saved settings
  ssSetToggle('ss-show-title', settings.showTitle || false);
  document.getElementById('ss-byline').value = settings.byline || 'JJ Lakatua';
  ssSetToggle('ss-show-location', settings.showLocation || false);
  const locEl = document.getElementById('ss-location');
  if (locEl) locEl.value = settings.location || '';
  ssSetToggle('ss-show-dates', settings.showDates || false);
  const drEl = document.getElementById('ss-date-range');
  if (drEl) drEl.value = settings.dateRange || '';
  ssSetToggle('ss-show-count', settings.showCount || false);
  // Per-photo overlay toggles. Both default to OFF unless explicitly
  // enabled — user-facing principle is "I unchecked it, it should be off."
  ssSetToggle('ss-show-photo-title',
    settings.showPhotoTitle === true);
  ssSetToggle('ss-show-photo-description',
    settings.showPhotoDescription === true);
  ssSetToggle('ss-fade-out-end', settings.fadeOutAtEnd === true);
  ssSetToggle('ss-show-pace', settings.showPaceReadout === true);
  const presetEl = document.getElementById('ss-preset');
  if (presetEl) presetEl.value = settings.preset || 'classic';
  // Custom pace slider: BPM (40-120), default 60. Slide duration = 8 beats.
  const paceEl = document.getElementById('ss-pace');
  const paceLabel = document.getElementById('ss-pace-label');
  const paceWrap = document.getElementById('ss-custom-pace');
  if (paceEl) {
    const savedBpm = Number(settings.paceBpm);
    paceEl.value = Number.isFinite(savedBpm) && savedBpm >= 40 && savedBpm <= 200 ? savedBpm : 60;
  }
  if (paceLabel) {
    const bpm = Number(paceEl?.value) || 60;
    paceLabel.textContent = `${bpm} BPM · ${(8 * 60 / bpm).toFixed(1)}s/slide`;
  }
  if (paceWrap) paceWrap.style.display = (presetEl && presetEl.value === 'custom') ? 'block' : 'none';
  // Beat preset controls — separate pane from Custom
  const beatPane = document.getElementById('ss-beat-pace');
  const beatEveryEl = document.getElementById('ss-beat-every');
  if (beatEveryEl) {
    // paceBeatsEvery is a string — "8" (constant) or "8,4" (alternating pattern).
    const valid = ['1','2','4','8','16','32','8,4','4,8','8,8,4','8,4,4','16,8,4,4','8,4,2,2'];
    const saved = settings.paceBeatsEvery != null ? String(settings.paceBeatsEvery) : '8';
    beatEveryEl.value = valid.includes(saved) ? saved : '8';
  }
  const bpmOverrideEl = document.getElementById('ss-beat-bpm-override');
  const bpmOverrideLabel = document.getElementById('ss-beat-bpm-override-label');
  const overrideRow = document.getElementById('ss-beat-override-row');
  if (bpmOverrideEl) {
    const saved = Number(settings.paceBpmOverride);
    bpmOverrideEl.value = String(Number.isFinite(saved) && saved >= 40 && saved <= 200 ? saved : 120);
    if (bpmOverrideLabel) bpmOverrideLabel.textContent = `${bpmOverrideEl.value} BPM`;
  }
  ssSetToggle('ss-beat-override-enabled', settings.paceBpmOverrideEnabled === true);
  if (overrideRow) overrideRow.style.display = (settings.paceBpmOverrideEnabled === true) ? 'flex' : 'none';
  const _isBeat = presetEl && (presetEl.value === 'beat' || presetEl.value === 'beatfade');
  if (beatPane) beatPane.style.display = _isBeat ? 'block' : 'none';
  // Kick off the preview pulse if Custom is the chosen preset on modal open.
  if (presetEl && presetEl.value === 'custom') startPacePulse(); else stopPacePulse();
  toggleSSTitleOptions();
  loadMusicList(settings.musicFile || null);
  // Music does NOT auto-play in the settings modal — only starts when you
  // click Start. Analysis (Beat preset) runs against the decoded buffer
  // silently, no playback needed.
  if (presetEl && (presetEl.value === 'beat' || presetEl.value === 'beatfade') && settings.musicFile) {
    refreshBeatStatus(settings.musicFile);
  }
  document.getElementById('slideshow-settings-modal').classList.add('active');
}

// Beat-preset status — shows analyzing progress → detected / failed.
function refreshBeatStatus(file) {
  const status = document.getElementById('ss-beat-status');
  if (!status || !window.DarkroomAudio) return;
  if (!file) { status.textContent = 'Select a music track to begin analysis'; return; }
  const st = DarkroomAudio.getAnalysisStatus(file);
  if (st === 'ready') {
    const a = DarkroomAudio.getTrackAnalysis(file);
    status.textContent = `Detected: ${a.bpm.toFixed(1)} BPM · ${a.beats.length} beats · confidence ${a.confidence.toFixed(2)}`;
    return;
  }
  if (st === 'failed') { status.textContent = 'Detection failed — try BPM override or pick another preset'; return; }
  status.textContent = 'Analyzing track…';
  // Live progress messages from the worker
  window.onBeatAnalysisProgress = (f, stage, message) => {
    if (f !== file) return;
    if (status) status.textContent = `Analyzing: ${stage || ''}${message ? ' (' + message + ')' : ''}…`;
  };
  DarkroomAudio.analyzeTrack(file)
    .then(() => { window.onBeatAnalysisProgress = null; refreshBeatStatus(file); })
    .catch(() => { window.onBeatAnalysisProgress = null; refreshBeatStatus(file); });
}

function ssToggle(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('on');
}

function ssToggleVal(id) {
  return document.getElementById(id)?.classList.contains('on') || false;
}

function ssSetToggle(id, val) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('on', !!val);
}

function toggleSSTitleOptions() {
  const show = ssToggleVal('ss-show-title');
  document.getElementById('ss-title-options').style.display = show ? 'block' : 'none';
}

async function loadMusicList(currentFile) {
  const sel = document.getElementById('ss-music-select');
  try {
    const r = await fetch('/api/albums/music-list');
    const data = await r.json();
    sel.innerHTML = '<option value="">No music</option>';
    (data.files || []).forEach(f => {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f.replace(/^\d+-/, '').replace(/_/g, ' ');
      if (f === currentFile) opt.selected = true;
      sel.appendChild(opt);
    });
    if (currentFile && !data.files.includes(currentFile)) {
      const opt = document.createElement('option');
      opt.value = currentFile;
      opt.textContent = currentFile;
      opt.selected = true;
      sel.appendChild(opt);
    }
  } catch(e) { console.error('music list failed', e); }
}

async function saveSlideshowSettingsAndStart() {
  const album = state.currentAlbum;
  // Warm AudioContext synchronously inside this click — must happen before
  // any await, or Safari drops user-gesture activation and audio stays muted.
  try { if (window.DarkroomAudio) DarkroomAudio.ensureCtx(); } catch(e) {}
  const settings = {
    showTitle: ssToggleVal('ss-show-title'),
    byline: document.getElementById('ss-byline').value.trim(),
    showLocation: ssToggleVal('ss-show-location'),
    location: (document.getElementById('ss-location')?.value || '').trim(),
    showDates: ssToggleVal('ss-show-dates'),
    dateRange: (document.getElementById('ss-date-range')?.value || '').trim(),
    showCount: ssToggleVal('ss-show-count'),
    showPhotoTitle: ssToggleVal('ss-show-photo-title'),
    showPhotoDescription: ssToggleVal('ss-show-photo-description'),
    preset: document.getElementById('ss-preset')?.value || 'classic',
    paceBpm: Number(document.getElementById('ss-pace')?.value) || 60,
    paceBeatsEvery: document.getElementById('ss-beat-every')?.value || '8',
    paceBpmOverride: Number(document.getElementById('ss-beat-bpm-override')?.value) || 0,
    paceBpmOverrideEnabled: ssToggleVal('ss-beat-override-enabled'),
    fadeOutAtEnd: ssToggleVal('ss-fade-out-end'),
    showPaceReadout: ssToggleVal('ss-show-pace'),
    musicFile: document.getElementById('ss-music-select').value || null,
  };
  album.slideshowSettings = settings;
  // Save to server
  try {
    await fetch('/api/albums/' + album.id, {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ slideshowSettings: settings })
    });
  } catch(e) {}
  stopPacePulse();
  stopMusicPreview();
  closeModal('slideshow-settings-modal');
  openAlbumSlideshow(0);
}

// Compute the date range string for an album by fetching each asset's
// takenAt and finding min/max. Uses state.recentMeta cache when available.
// Returns '' if no usable dates found.
async function _computeAlbumDateRange(album) {
  if (!album || !album.assets || !album.assets.length) return '';
  const fetches = album.assets.map(id => {
    const cached = state.recentMeta[id];
    if (cached && cached.takenAt) return Promise.resolve(cached.takenAt);
    return fetch('/api/immich/photo/' + id)
      .then(r => r.json())
      .then(m => {
        if (!state.recentMeta[id]) state.recentMeta[id] = {};
        state.recentMeta[id].takenAt = m.takenAt || '';
        state.recentMeta[id].title = m.title || '';
        state.recentMeta[id].description = m.description || '';
        return m.takenAt || '';
      })
      .catch(() => '');
  });
  const taken = await Promise.all(fetches);
  const dates = taken.filter(Boolean).map(s => new Date(s)).filter(d => !isNaN(d.getTime()));
  if (!dates.length) return '';
  dates.sort((a, b) => a - b);
  return _formatDateRange(dates[0], dates[dates.length - 1]);
}

function _formatDateRange(d1, d2) {
  const month = d => d.toLocaleString('en-US', { month: 'short' });
  const year = d => d.getFullYear();
  // Same calendar day
  if (d1.toDateString() === d2.toDateString()) {
    return `${month(d1)} ${d1.getDate()}, ${year(d1)}`;
  }
  // Same month and year
  if (year(d1) === year(d2) && d1.getMonth() === d2.getMonth()) {
    return `${month(d1)} ${year(d1)}`;
  }
  // Same year, different months
  if (year(d1) === year(d2)) {
    return `${month(d1)} — ${month(d2)} ${year(d1)}`;
  }
  // Different years
  return `${month(d1)} ${year(d1)} — ${month(d2)} ${year(d2)}`;
}

async function showTitleCard(album) {
  const settings = album.slideshowSettings || {};
  if (!settings.showTitle) return;
  // If dates are on, resolve the display string before rendering — either
  // the user-entered override or the auto-computed range from photo
  // takenAt values. Capped at a hard 2s timeout so a slow Immich call
  // doesn't delay the slideshow start indefinitely.
  let dateRangeStr = '';
  if (settings.showDates) {
    if (settings.dateRange) {
      dateRangeStr = settings.dateRange;
    } else {
      try {
        dateRangeStr = await Promise.race([
          _computeAlbumDateRange(album),
          new Promise(res => setTimeout(() => res(''), 2000))
        ]);
      } catch (e) { dateRangeStr = ''; }
    }
  }
  const card = document.getElementById('ss-title-card');
  const content = document.getElementById('ss-title-card-content');
  let html = `<div class="ss-title-main">${album.title}</div>`;
  html += `<div style="width:60px;height:1px;background:var(--safe);margin:1.5rem auto"></div>`;
  if (settings.byline) html += `<div class="ss-title-sub">Photography by ${settings.byline}</div>`;
  if (settings.showLocation && settings.location) html += `<div class="ss-title-sub" style="margin-top:0.5rem">${settings.location}</div>`;
  if (settings.showDates && dateRangeStr) html += `<div class="ss-title-sub" style="margin-top:0.5rem">${dateRangeStr}</div>`;
  if (settings.showCount) html += `<div class="ss-title-sub" style="margin-top:0.75rem;letter-spacing:0.2em">${album.assets.length} PHOTOS</div>`;
  content.innerHTML = html;
  card.style.display = 'flex';
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  card.style.opacity = '1';
  await new Promise(r => setTimeout(r, 3500));
  card.style.opacity = '0';
  await new Promise(r => setTimeout(r, 1000));
  card.style.display = 'none';
}

// Slideshow music — routed through DarkroomAudio (Web Audio engine).
function startSlideshowMusic(settings) {
  if (!settings.musicFile) return;
  DarkroomAudio.playMusic(settings.musicFile, {
    fadeMs: 1600,
    loop: true,
    volume: 0.85,
  }).catch(e => console.warn('slideshow music failed:', e));
}

function stopSlideshowMusic() {
  if (window.DarkroomAudio) DarkroomAudio.stopMusic({ fadeMs: 800 });
}

const KB_MOVES = [
  { start: 'scale(1.08) translate(-3%, -3%)',  end: 'scale(1.25) translate(2%, 2%)' },
  { start: 'scale(1.25) translate(3%, 2%)',    end: 'scale(1.08) translate(-2%, -2%)' },
  { start: 'scale(1.08) translate(4%, -4%)',   end: 'scale(1.3) translate(-3%, 3%)' },
  { start: 'scale(1.3) translate(-4%, 3%)',    end: 'scale(1.08) translate(3%, -2%)' },
  { start: 'scale(1.08) translate(0%, -5%)',   end: 'scale(1.25) translate(0%, 3%)' },
  { start: 'scale(1.25) translate(0%, 4%)',    end: 'scale(1.08) translate(0%, -3%)' },
];

let ssActiveSlot = 'a';
let ssCleanupTimers = [];

// Adaptive image sizing for slideshow body — mirrors album.js so the admin
// preview matches the public album view exactly. Slideshow uses the resized
// display variant (/api/public/display/<id>-<w>.jpg) instead of the full
// Immich original; full-res stays on /api/immich/original/:id for the
// lightbox + recent-detail view where pixel-peeping matters.
let ssDisplayWidth = 1920;
let ssSlowLoadCount = 0;
function _pickInitialDisplayWidth() {
  try {
    const c = navigator.connection;
    if (!c) return 1920;
    if (c.saveData) return 960;
    const et = c.effectiveType || '';
    if (et === 'slow-2g' || et === '2g') return 960;
    if (et === '3g') return 1280;
    if (typeof c.downlink === 'number' && c.downlink < 1.5) return 1280;
    return 1920;
  } catch (e) { return 1920; }
}
function _measureAndAdapt(ms) {
  if (ms > 3500) {
    ssSlowLoadCount++;
    if (ssSlowLoadCount >= 2 && ssDisplayWidth > 960) {
      const prev = ssDisplayWidth;
      ssDisplayWidth = (ssDisplayWidth >= 1920) ? 1280 : 960;
      ssSlowLoadCount = 0;
      console.log('[ss] adaptive downgrade ' + prev + ' → ' + ssDisplayWidth + ' (last load ' + Math.round(ms) + 'ms)');
    }
  } else if (ms < 800) {
    ssSlowLoadCount = Math.max(0, ssSlowLoadCount - 1);
  }
}
function _dispUrl(id) {
  return '/api/public/display/' + id + '-' + ssDisplayWidth + '.jpg';
}
// Per-run pin of each slide's display URL (idx → url). The width ladder
// (ssDisplayWidth) can move mid-show; without pinning, look-ahead preloads
// land in the browser cache under one width while the render then requests
// another — a guaranteed cache miss that re-runs the sharp pipeline server-
// side and makes the photo arrive seconds late (the uneven-pace bug).
// First reference wins: whoever touches a slide first (preload or render)
// fixes its URL for the run. Cleared in startSlideshow.
let ssUrlPin = {};
function _ssUrlFor(idx) {
  const album = state.currentAlbum;
  if (!album || !album.assets || !album.assets[idx]) return '';
  if (ssUrlPin[idx] == null) ssUrlPin[idx] = _dispUrl(album.assets[idx]);
  return ssUrlPin[idx];
}
// Attach load/error handlers for a slide image with graceful fallback to the
// Immich thumb URL on failure. If thumb also fails, show() runs anyway — the
// slot's bg-image is the last-resort visual fallback.
function _attachSlideImgHandlers(img, id, show) {
  if (img.complete && img.naturalWidth > 0) { show(); return; }
  let fellBack = false;
  const measureStart = performance.now();
  const onMeasureOnce = () => {
    img.removeEventListener('load', onMeasureOnce);
    _measureAndAdapt(performance.now() - measureStart);
  };
  img.addEventListener('load', onMeasureOnce);
  img.onload = show;
  img.onerror = () => {
    if (fellBack) { show(); return; }
    fellBack = true;
    img.src = '/api/public/thumb/' + id;
  };
}
// Hidden image preload for look-ahead slides (N+2, N+3). Browser HTTP cache
// keeps the result so the actual slide render hits cache.
function _preloadAhead(idx) {
  const album = state.currentAlbum;
  if (!album || !album.assets || !album.assets.length) return;
  for (const off of [2, 3]) {
    const k = (idx + off) % album.assets.length;
    const id = album.assets[k];
    if (!id) continue;
    const pre = new Image();
    pre.src = _ssUrlFor(k);
  }
}

// Pick initial width at module load — re-evaluated by _measureAndAdapt as
// slides go by.
ssDisplayWidth = _pickInitialDisplayWidth();

function cancelSlideCleanup() {
  ssCleanupTimers.forEach(t => clearTimeout(t));
  ssCleanupTimers = [];
  // Hide the inactive slot cleanly without touching the visible one
  const inactiveSlot = ssActiveSlot === 'a' ? 'b' : 'a';
  const inactiveEl = document.getElementById('slideshow-slide-' + inactiveSlot);
  if (inactiveEl) { inactiveEl.classList.remove('ss-visible'); inactiveEl.style.zIndex = 1; }
}

// Returns the duration the CURRENT slide will hold, including the actual
// beat-pattern step for beat/beatfade presets (where successive slides can
// have very different durations). _slideDurationMs() returns only the first
// step and is wrong mid-pattern.
function _currentSlideHoldMs() {
  const settings = (state.currentAlbum && state.currentAlbum.slideshowSettings) || {};
  if (settings.preset === 'quick') return 6000;
  if (settings.preset === 'custom') {
    const bpm = Number(settings.paceBpm);
    if (Number.isFinite(bpm) && bpm >= 40 && bpm <= 200) return Math.round(8 * 60000 / bpm);
    return 8000;
  }
  if (settings.preset === 'beat' || settings.preset === 'beatfade') {
    const pattern = _parseBeatPattern(settings.paceBeatsEvery);
    const ptnIdx = (state.slideshow.beatPtnIdx == null) ? 0 : (state.slideshow.beatPtnIdx % pattern.length);
    const beats = pattern[ptnIdx];
    let bpm = 0;
    if (settings.paceBpmOverrideEnabled === true && Number(settings.paceBpmOverride) >= 40) {
      bpm = Number(settings.paceBpmOverride);
    } else if (window.DarkroomAudio && settings.musicFile) {
      const analysis = DarkroomAudio.getTrackAnalysis(settings.musicFile);
      if (analysis && analysis.bpm) bpm = analysis.bpm;
    }
    if (!bpm) bpm = 60;
    return Math.round(beats * 60000 / bpm);
  }
  return 7000; // classic default
}

// Per-photo overlay (title + description) — shared by all preset render
// paths. Title fade timing scales with the actual current slide duration
// so 8/4/2-beat slides each get appropriate fade-in/out windows. Titles
// are skipped entirely on slides shorter than ~1.5s (can't surface before
// the next slide arrives).
// Pace readout badge (Slideshow Settings → Custom pane → "Show pace
// readout"). IN-APP ONLY — album.js never reads showPaceReadout, so the
// public album page is untouched. Live-ticking elapsed counter for the
// current slide (0.0 → target), plus the measured duration of the previous
// slide. Driven by its own 100ms display interval — reads the clock and
// writes textContent only, never touches slideshow timers or animation.
let _paceBadgeLastTs = null;
let _paceBadgeLastDelta = null;
let _paceBadgeTicker = null;
function _stopPaceBadge() {
  if (_paceBadgeTicker) { clearInterval(_paceBadgeTicker); _paceBadgeTicker = null; }
  _paceBadgeLastTs = null;
  _paceBadgeLastDelta = null;
  const el = document.getElementById('slideshow-pace-badge');
  if (el) el.style.display = 'none';
}
function _updatePaceBadge() {
  const el = document.getElementById('slideshow-pace-badge');
  if (!el) return;
  const settings = (state.currentAlbum && state.currentAlbum.slideshowSettings) || {};
  if (settings.showPaceReadout !== true) { _stopPaceBadge(); return; }
  const now = performance.now();
  if (_paceBadgeLastTs != null) _paceBadgeLastDelta = now - _paceBadgeLastTs;
  _paceBadgeLastTs = now;
  const tgt = (_currentSlideHoldMs() / 1000).toFixed(1);
  const render = () => {
    const elapsed = (performance.now() - _paceBadgeLastTs) / 1000;
    el.textContent = `${elapsed.toFixed(1)}s / ${tgt}s`
      + (_paceBadgeLastDelta != null ? ` · last slide ${(_paceBadgeLastDelta / 1000).toFixed(2)}s` : '');
  };
  el.style.display = 'block';
  render();
  if (_paceBadgeTicker) clearInterval(_paceBadgeTicker);
  _paceBadgeTicker = setInterval(render, 100);
}

function _renderPerPhotoOverlay(idx) {
  const album = state.currentAlbum;
  if (!album) return;
  _updatePaceBadge();
  const ssSettings = album.slideshowSettings || {};
  const wantTitle = ssSettings.showPhotoTitle === true;
  const wantDesc  = ssSettings.showPhotoDescription === true;
  const descEl  = document.getElementById('slideshow-description');
  const titleEl = document.getElementById('slideshow-photo-title');
  const assetId = album.assets[idx];

  const slideDur = _currentSlideHoldMs();
  // Skip both overlays on slides too short to fit a readable fade-in/hold/
  // fade-out. Duration-based — a 2-beat slide at 60 BPM is 2s and totally
  // workable, while at 120 BPM it's only 1s and isn't.
  const overlayTooFast = slideDur < 1400;

  // Image crossfade duration per preset — title shouldn't materialize
  // until the image it belongs to is fully in view.
  //   Beat Fade: 700ms (.ss-fade-quick override)
  //   Quick: 1.8s slide-in transform
  //   Classic / Beat / Custom: 1.5s default opacity transition
  const imgFadeMs = (ssSettings.preset === 'beatfade') ? 700
                  : (ssSettings.preset === 'quick') ? 1800
                  : 1500;
  // Baseline delay = image fully in + small breathing buffer.
  const baseDelay = imgFadeMs + 200;

  // Adaptive fade timings keyed off the actual hold duration. Title and
  // description share these so they fade in / out in lockstep.
  let OV_DELAY_MS, OV_FADE_IN_MS, OV_FADE_OUT_MS, OV_FADE_OUT_AT_MS;
  if (slideDur >= 6000) {
    // Long slides — wait past image, then leisurely text fade.
    OV_DELAY_MS = baseDelay + 800;
    OV_FADE_IN_MS = 1000;
    OV_FADE_OUT_MS = 1000;
    OV_FADE_OUT_AT_MS = slideDur - OV_FADE_OUT_MS - 200;
  } else if (slideDur >= 3500) {
    // Mid-length — wait for image to settle.
    OV_DELAY_MS = baseDelay;
    OV_FADE_IN_MS = 600;
    OV_FADE_OUT_MS = 600;
    OV_FADE_OUT_AT_MS = slideDur - OV_FADE_OUT_MS - 200;
  } else if (slideDur >= 2200) {
    // ~4 beat / tight slides. Compromise: title starts at end of image
    // crossfade tail (rather than way after). Better to see the title
    // briefly than not at all.
    OV_DELAY_MS = Math.max(500, baseDelay - 400);
    OV_FADE_IN_MS = 400;
    OV_FADE_OUT_MS = 400;
    OV_FADE_OUT_AT_MS = slideDur - OV_FADE_OUT_MS - 150;
  } else {
    // Very short slides — minimal fade, title appears during image fade.
    OV_DELAY_MS = 200;
    OV_FADE_IN_MS = 300;
    OV_FADE_OUT_MS = 300;
    OV_FADE_OUT_AT_MS = slideDur - OV_FADE_OUT_MS - 100;
  }

  // Clear any in-flight timers from a previous slide.
  if (titleEl && titleEl._slideTitleTimer) {
    clearTimeout(titleEl._slideTitleTimer);
    titleEl._slideTitleTimer = null;
  }
  if (titleEl && titleEl._slideTitleFadeOutTimer) {
    clearTimeout(titleEl._slideTitleFadeOutTimer);
    titleEl._slideTitleFadeOutTimer = null;
  }
  if (descEl && descEl._slideDescTimer) {
    clearTimeout(descEl._slideDescTimer);
    descEl._slideDescTimer = null;
  }
  if (descEl && descEl._slideDescFadeOutTimer) {
    clearTimeout(descEl._slideDescFadeOutTimer);
    descEl._slideDescFadeOutTimer = null;
  }
  // Pre-set fade-in transition + reset opacity so both elements start
  // invisible and fade in via the adaptive duration (CSS defaults are too
  // slow for short slides).
  if (titleEl) {
    titleEl.style.transition = `opacity ${OV_FADE_IN_MS}ms ease-in-out`;
    titleEl.style.opacity = '0';
  }
  if (descEl) {
    descEl.style.transition = `opacity ${OV_FADE_IN_MS}ms ease-in-out`;
    descEl.style.opacity = '0';
  }

  const applyOverlay = (m) => {
    if (descEl) {
      if (wantDesc && !overlayTooFast && m && m.description) {
        descEl.textContent = m.description;
        descEl.style.display = '';
        if (descEl._slideDescTimer) clearTimeout(descEl._slideDescTimer);
        if (descEl._slideDescFadeOutTimer) clearTimeout(descEl._slideDescFadeOutTimer);
        descEl._slideDescTimer = setTimeout(() => {
          descEl.style.transition = `opacity ${OV_FADE_IN_MS}ms ease-in-out`;
          descEl.style.opacity = '1';
          descEl._slideDescTimer = null;
        }, OV_DELAY_MS);
        descEl._slideDescFadeOutTimer = setTimeout(() => {
          descEl.style.transition = `opacity ${OV_FADE_OUT_MS}ms ease-in-out`;
          descEl.style.opacity = '0';
          descEl._slideDescFadeOutTimer = null;
        }, OV_FADE_OUT_AT_MS);
      } else {
        descEl.textContent = '';
        descEl.style.opacity = '0';
        descEl.style.display = wantDesc ? '' : 'none';
      }
    }
    if (titleEl) {
      if (wantTitle && !overlayTooFast && m && m.title) {
        titleEl.style.display = '';
        if (titleEl._slideTitleTimer) clearTimeout(titleEl._slideTitleTimer);
        if (titleEl._slideTitleFadeOutTimer) clearTimeout(titleEl._slideTitleFadeOutTimer);
        titleEl._slideTitleTimer = setTimeout(() => {
          titleEl.textContent = m.title;
          titleEl.style.transition = `opacity ${OV_FADE_IN_MS}ms ease-in-out`;
          titleEl.style.opacity = '1';
          titleEl._slideTitleTimer = null;
        }, OV_DELAY_MS);
        titleEl._slideTitleFadeOutTimer = setTimeout(() => {
          titleEl.style.transition = `opacity ${OV_FADE_OUT_MS}ms ease-in-out`;
          titleEl.style.opacity = '0';
          titleEl._slideTitleFadeOutTimer = null;
        }, OV_FADE_OUT_AT_MS);
      } else {
        titleEl.textContent = '';
        titleEl.style.opacity = '0';
        titleEl.style.display = 'none';
      }
    }
  };

  applyOverlay(state.recentMeta[assetId]);
  const cached = state.recentMeta[assetId];
  const needFetch = !cached
    || (wantTitle && cached.title === undefined)
    || (wantDesc && cached.description === undefined);
  if (needFetch) {
    fetch('/api/immich/photo/' + assetId).then(r => r.json()).then(m => {
      if (!state.recentMeta[assetId]) state.recentMeta[assetId] = {};
      state.recentMeta[assetId].description = m.description || '';
      state.recentMeta[assetId].title = m.title || '';
      if (state.slideshow.index === idx) applyOverlay(state.recentMeta[assetId]);
    }).catch(() => {});
  }
}

function showSlide(idx, direction) {
  const album = state.currentAlbum;
  // Dispatch to alternative implementation for non-Classic presets.
  // Classic (default / unset) falls through unchanged below.
  const _preset = (album && album.slideshowSettings && album.slideshowSettings.preset) || 'classic';
  // music-sync uses Classic visuals (Ken Burns + crossfade) — falls through
  // below. Only the SCHEDULING is beat-driven, handled in scheduleNext().
  if (_preset === 'quick') return showSlideSlide(idx, direction);
  if (_preset === 'beatfade') return showSlideBeatFade(idx);
  // Clear leftover classes from non-Classic runs so Classic's crossfade path
  // isn't fighting transform-based or ss-fade-quick positioning.
  ['a','b'].forEach(s => {
    const el = document.getElementById('slideshow-slide-' + s);
    if (!el) return;
    ['ss-slide-h','ss-slide-h-from-right','ss-slide-h-from-left','ss-exiting-left','ss-exiting-right','ss-fade-quick']
      .forEach(c => el.classList.remove(c));
  });
  const counter = document.getElementById('slideshow-counter');
  counter.textContent = (idx + 1) + ' / ' + album.assets.length;
  state.slideshow.index = idx;

  _renderPerPhotoOverlay(idx);

  const move = KB_MOVES[idx % KB_MOVES.length];
  const nextSlot = ssActiveSlot === 'a' ? 'b' : 'a';
  const currentEl = document.getElementById('slideshow-slide-' + ssActiveSlot);
  const nextEl = document.getElementById('slideshow-slide-' + nextSlot);
  const url = _ssUrlFor(idx);
  const thumbUrl = '/api/public/thumb/' + album.assets[idx];

  // Adaptive crossfade duration. The default CSS 1.5s opacity transition
  // is longer than fast beat-pattern slides (e.g. 2 beats @ 94 BPM = 1.28s),
  // which causes consecutive crossfades to stack and look janky. Scale
  // the slot's opacity transition to fit comfortably inside the current
  // slide's hold time.
  const _kbSlideDur = _currentSlideHoldMs();
  const crossfadeMs = _kbSlideDur < 1600 ? 400
                    : _kbSlideDur < 3000 ? 800
                    : 1500;
  [currentEl, nextEl].forEach(el => {
    if (el && !el.classList.contains('ss-fade-quick')
        && !el.classList.contains('ss-slide-h')) {
      el.style.transition = `opacity ${crossfadeMs}ms ease-in-out`;
    }
  });

  nextEl.innerHTML = `
    <div class="ss-bg" style="background-image:url('${thumbUrl}')"></div>
    <img class="ss-img" src="${url}">
  `;
  nextEl.style.zIndex = 1;
  nextEl.classList.remove('ss-visible');

  const img = nextEl.querySelector('.ss-img');
  const show = () => {
    img.style.setProperty('--kb-start', move.start);
    img.style.setProperty('--kb-end', move.end);
    img.style.animation = 'none';
    void img.offsetWidth;
    img.style.animation = 'kenburns 14s linear forwards';
    nextEl.style.zIndex = 3;
    requestAnimationFrame(() => requestAnimationFrame(() => nextEl.classList.add('ss-visible')));
    if (!state.slideshow.paused) scheduleNext();
    // Cleanup timers scale with crossfade so they don't fire too early or
    // too late relative to the visible transition.
    const t1 = setTimeout(() => { currentEl.classList.remove('ss-visible'); }, crossfadeMs);
    const t2 = setTimeout(() => {
      currentEl.style.zIndex = 1;
      ssActiveSlot = nextSlot;
      ssCleanupTimers = ssCleanupTimers.filter(t => t !== t1 && t !== t2);
    }, crossfadeMs * 2 + 500);
    ssCleanupTimers.push(t1, t2);
  };

  _attachSlideImgHandlers(img, album.assets[idx], show);

  // Preload next image + look-ahead (N+2, N+3)
  const preloadIdx = (idx + 1) % album.assets.length;
  const pre = new Image();
  pre.src = _ssUrlFor(preloadIdx);
  _preloadAhead(idx);
}

// QUICK preset (slide-horizontal, no Ken Burns). Fully isolated from
// showSlide; Classic path never enters this function.
function showSlideSlide(idx, direction) {
  const album = state.currentAlbum;
  const counter = document.getElementById('slideshow-counter');
  counter.textContent = (idx + 1) + ' / ' + album.assets.length;
  state.slideshow.index = idx;

  // Per-photo title/description overlay (was missing from Quick preset's
  // render path — only the Classic preset had this wired up).
  _renderPerPhotoOverlay(idx);

  const assetId = album.assets[idx];
  const url = _ssUrlFor(idx);
  const thumbUrl = '/api/public/thumb/' + assetId;
  const nextSlot = ssActiveSlot === 'a' ? 'b' : 'a';
  const currentEl = document.getElementById('slideshow-slide-' + ssActiveSlot);
  const nextEl = document.getElementById('slideshow-slide-' + nextSlot);

  // Clear any prior transition-mode classes on both slots
  ['ss-slide-h','ss-slide-h-from-right','ss-slide-h-from-left','ss-exiting-left','ss-exiting-right']
    .forEach(c => { currentEl.classList.remove(c); nextEl.classList.remove(c); });

  nextEl.innerHTML = `
    <div class="ss-bg" style="background-image:url('${thumbUrl}')"></div>
    <img class="ss-img" src="${url}">
  `;
  nextEl.style.zIndex = 1;
  nextEl.classList.remove('ss-visible');

  const img = nextEl.querySelector('.ss-img');
  const show = () => {
    img.style.animation = 'none';
    img.style.transform = '';
    const dir = direction === 'backward' ? 'backward' : 'forward';
    const fromClass = dir === 'forward' ? 'ss-slide-h-from-right' : 'ss-slide-h-from-left';
    nextEl.classList.add('ss-slide-h', fromClass);
    void nextEl.offsetWidth;
    nextEl.style.zIndex = 3;
    // Both slots transition in parallel for a single coherent motion.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      nextEl.classList.add('ss-visible');
      const exitClass = dir === 'forward' ? 'ss-exiting-left' : 'ss-exiting-right';
      currentEl.classList.add('ss-slide-h', exitClass);
    }));
    if (!state.slideshow.paused) scheduleNext();
    const t2 = setTimeout(() => {
      currentEl.style.zIndex = 1;
      currentEl.classList.remove('ss-visible');
      ssActiveSlot = nextSlot;
      ssCleanupTimers = ssCleanupTimers.filter(t => t !== t2);
    }, 1900);
    ssCleanupTimers.push(t2);
  };
  _attachSlideImgHandlers(img, assetId, show);

  // Preload next image + look-ahead
  const preloadIdx = (idx + 1) % album.assets.length;
  const pre = new Image();
  pre.src = _ssUrlFor(preloadIdx);
  _preloadAhead(idx);
}

// BEAT FADE preset — same scheduler + engine as Beat, but no Ken Burns
// motion. Just a crisp 400ms opacity crossfade on each beat-aligned tick.
function showSlideBeatFade(idx) {
  const album = state.currentAlbum;
  const counter = document.getElementById('slideshow-counter');
  counter.textContent = (idx + 1) + ' / ' + album.assets.length;
  state.slideshow.index = idx;

  // Per-photo title/description overlay (was missing — only the Beat
  // preset's render path through showSlide had this wired up).
  _renderPerPhotoOverlay(idx);

  const assetId = album.assets[idx];
  const url = _ssUrlFor(idx);
  const thumbUrl = '/api/public/thumb/' + assetId;
  const nextSlot = ssActiveSlot === 'a' ? 'b' : 'a';
  const currentEl = document.getElementById('slideshow-slide-' + ssActiveSlot);
  const nextEl = document.getElementById('slideshow-slide-' + nextSlot);

  // Strip mode classes from any prior preset on both slots.
  ['a','b'].forEach(s => {
    const el = document.getElementById('slideshow-slide-' + s);
    if (!el) return;
    ['ss-slide-h','ss-slide-h-from-right','ss-slide-h-from-left','ss-exiting-left','ss-exiting-right']
      .forEach(c => el.classList.remove(c));
  });

  nextEl.innerHTML = `
    <div class="ss-bg" style="background-image:url('${thumbUrl}')"></div>
    <img class="ss-img" src="${url}">
  `;
  nextEl.style.zIndex = 1;
  nextEl.classList.add('ss-fade-quick');
  nextEl.classList.remove('ss-visible');
  currentEl.classList.add('ss-fade-quick');

  const img = nextEl.querySelector('.ss-img');
  // Static image — no ken-burns animation, no transform
  img.style.animation = 'none';
  img.style.transform = '';

  const show = () => {
    nextEl.style.zIndex = 3;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      nextEl.classList.add('ss-visible');
      currentEl.classList.remove('ss-visible');
    }));
    if (!state.slideshow.paused) scheduleNext();
    // Cleanup timer bumped from 500 → 1500ms so it runs after the fade
    // (now 1400ms via .ss-fade-quick) fully completes.
    const t1 = setTimeout(() => {
      currentEl.style.zIndex = 1;
      ssActiveSlot = nextSlot;
      ssCleanupTimers = ssCleanupTimers.filter(t => t !== t1);
    }, 1500);
    ssCleanupTimers.push(t1);
  };
  _attachSlideImgHandlers(img, assetId, show);

  // Preload next image + look-ahead
  const preloadIdx = (idx + 1) % album.assets.length;
  const pre = new Image();
  pre.src = _ssUrlFor(preloadIdx);
  _preloadAhead(idx);
}

let ssHideTimer = null;
let ssDescVisible = true;

function toggleSlideshowMusic() {
  const btn = document.getElementById('slideshow-music-btn');
  if (!window.DarkroomAudio) return;
  if (DarkroomAudio.isMusicPlaying()) {
    DarkroomAudio.pauseMusic({ fadeMs: 200 });
    if (btn) btn.style.color = 'var(--text-dim)';
  } else {
    const file = DarkroomAudio.getMusicFile()
      || (state.currentAlbum?.slideshowSettings?.musicFile);
    if (!file) return;
    DarkroomAudio.playMusic(file, { fadeMs: 200, loop: true, volume: 0.85 });
    if (btn) btn.style.color = '';
  }
}

function toggleSlideshowDesc() {
  ssDescVisible = !ssDescVisible;
  const descEl = document.getElementById('slideshow-description');
  const titleEl = document.getElementById('slideshow-photo-title');
  const btn = document.getElementById('slideshow-desc-btn');
  // Toggle both overlay elements together — treats title+description as
  // one "overlay text" unit for the in-slideshow ✦ button.
  if (descEl) descEl.style.opacity = ssDescVisible ? '1' : '0';
  if (titleEl) titleEl.style.opacity = ssDescVisible ? '1' : '0';
  if (btn) btn.style.color = ssDescVisible ? 'var(--safe)' : '';
}
function showSlideshowControls() {
  const ctrl = document.querySelector('.slideshow-controls');
  const counter = document.getElementById('slideshow-counter');
  if (ctrl) ctrl.classList.remove('ss-hidden');
  if (counter) counter.classList.remove('ss-hidden');
  clearTimeout(ssHideTimer);
  ssHideTimer = setTimeout(() => {
    if (ctrl) ctrl.classList.add('ss-hidden');
    if (counter) counter.classList.add('ss-hidden');
  }, 3000);
}

// Slide hold duration. When a per-photo title is enabled the slide stays
// up 12s instead of the classic 7s — gives the title time to fade in,
// hold readable for several seconds, and fade out cleanly BEFORE the
// next slide arrives. When title is off, classic 7s rhythm is preserved.
// paceBeatsEvery is a string — "8" (constant) or comma-separated pattern like
// "8,4". Returns an array of positive integers; falls back to [8].
function _parseBeatPattern(val) {
  const arr = String(val ?? '8').split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isFinite(n) && n > 0 && n <= 64);
  return arr.length ? arr : [8];
}

function _slideDurationMs() {
  const settings = (state.currentAlbum && state.currentAlbum.slideshowSettings) || {};
  if (settings.preset === 'quick') return 6000;
  if (settings.preset === 'custom') {
    const bpm = Number(settings.paceBpm);
    if (Number.isFinite(bpm) && bpm >= 40 && bpm <= 200) return Math.round(8 * 60000 / bpm);
  }
  if (settings.preset === 'beat' || settings.preset === 'beatfade') {
    // For mixed patterns, use the first step's duration as the representative.
    // _slideDurationMs is mainly used for fallback timing and the minAhead
    // computation; the actual schedule uses the live pattern step.
    const pattern = _parseBeatPattern(settings.paceBeatsEvery);
    const beats = pattern[0];
    const useOverride = settings.paceBpmOverrideEnabled === true;
    const override = Number(settings.paceBpmOverride);
    const file = settings.musicFile;
    const analysis = file && window.DarkroomAudio ? DarkroomAudio.getTrackAnalysis(file) : null;
    const bpm = useOverride && override >= 40 ? override : (analysis ? analysis.bpm : 0);
    if (Number.isFinite(bpm) && bpm >= 40) return Math.round(beats * 60000 / bpm);
  }
  return settings.showPhotoTitle === true ? 12000 : 7000;
}

// Slide scheduler. For the Beat preset, walks the detected beats array using
// DarkroomAudio.getMusicTime() (sample-accurate) — finds the next beat that's
// at least minDelay away and schedules the slide change for that exact moment.
// Falls back to fixed-duration setTimeout for other presets or if analysis
// hasn't arrived yet.
function scheduleNext() {
  if (state.slideshow.timer) clearTimeout(state.slideshow.timer);
  if (state.slideshow.paused) return;
  const dur = _slideDurationMs();
  let delay = dur;
  const settings = (state.currentAlbum && state.currentAlbum.slideshowSettings) || {};
  // Custom preset note (v1.5.66): delay stays a plain `dur` counted from the
  // slide's APPEARANCE (this runs from img.onload). v1.5.65 tried subtracting
  // the incoming image's load latency to keep the change-grid even, but that
  // SHORTENS a slide whenever the previous load was slow — worse than the
  // original symptom. Even pacing is achieved instead by pinning preload
  // URLs (_ssUrlFor) so renders hit the browser cache and latency ≈ 0.
  if ((settings.preset === 'beat' || settings.preset === 'beatfade')
      && window.DarkroomAudio
      && DarkroomAudio.isMusicPlaying()) {
    const analysis = DarkroomAudio.getTrackAnalysis(settings.musicFile);
    const useOverride = settings.paceBpmOverrideEnabled === true;
    const override = Number(settings.paceBpmOverride);
    const pattern = _parseBeatPattern(settings.paceBeatsEvery);
    // pattern position cycles through the array; nextIdx advances by pattern[ptnIdx]
    const ptnIdx = (state.slideshow.beatPtnIdx == null) ? 0 : (state.slideshow.beatPtnIdx % pattern.length);
    const step = pattern[ptnIdx];
    const _dbgBase = { pattern: pattern.join(','), ptnIdx, step, useOverride, override, detectedBpm: analysis?.bpm, musicSec: DarkroomAudio.getMusicTime().toFixed(3) };
    if (useOverride && override >= 40) {
      // Override path also walks the pattern. State = nextTickSec accumulator.
      const beatSec = 60 / override;
      const musicSec = DarkroomAudio.getMusicTime();
      const phase = (analysis && analysis.beats && analysis.beats.length)
        ? (analysis.beats[0] % beatSec) : 0;
      let target;
      let curPtnIdx = ptnIdx;
      if (state.slideshow.beatIdx == null) {
        const minDelay = dur * 0.001 * 0.5;
        const k = Math.ceil((musicSec + minDelay - phase) / (pattern[0] * beatSec));
        target = k * pattern[0] * beatSec + phase;
      } else {
        target = state.slideshow.beatIdx + step * beatSec;
        // Catch-up: image load delays can push musicSec past target. Without
        // this, delay = max(50, negative) fires the slide ~instantly. Walk
        // forward through the pattern until target is comfortably ahead so
        // we resync rather than slipping every late slide.
        while (target <= musicSec + 0.1) {
          curPtnIdx = (curPtnIdx + 1) % pattern.length;
          target += pattern[curPtnIdx] * beatSec;
        }
      }
      state.slideshow.beatIdx = target;
      state.slideshow.beatPtnIdx = (curPtnIdx + 1) % pattern.length;
      delay = Math.max(50, (target - musicSec) * 1000);
      console.log('[beat-schedule] override path', { ..._dbgBase, target, delay });
    } else if (analysis && analysis.beats && analysis.beats.length) {
      // State-tracked: step the beat index by the current pattern element.
      const musicSec = DarkroomAudio.getMusicTime();
      const arr = analysis.beats;
      let nextIdx;
      let curPtnIdx = ptnIdx;
      if (state.slideshow.beatIdx == null) {
        const minAheadSec = (dur * 0.5) / 1000;
        let firstIdx = -1;
        for (let i = 0; i < arr.length; i++) {
          if (arr[i] > musicSec + minAheadSec) { firstIdx = i; break; }
        }
        if (firstIdx < 0) {
          console.log('[beat-schedule] no target beat found', { ..._dbgBase, beatsArrayLen: arr.length });
          state.slideshow.timer = setTimeout(() => { slideshowNext(); }, delay);
          return;
        }
        // Snap first slide to a multiple of pattern[0] so cadence starts clean
        nextIdx = Math.ceil(firstIdx / pattern[0]) * pattern[0];
      } else {
        nextIdx = state.slideshow.beatIdx + step;
        // Catch-up: if a slow image load advanced musicSec past arr[nextIdx],
        // walk forward through the pattern (and beats array) until we land
        // on a beat that's still in the future. Otherwise delay clamps to
        // 50ms and slides slip past one after another instantly.
        while (nextIdx < arr.length && arr[nextIdx] <= musicSec + 0.1) {
          curPtnIdx = (curPtnIdx + 1) % pattern.length;
          nextIdx += pattern[curPtnIdx];
        }
      }
      const finalIdx = Math.min(arr.length - 1, nextIdx);
      const target = arr[finalIdx];
      state.slideshow.beatIdx = finalIdx;
      state.slideshow.beatPtnIdx = (curPtnIdx + 1) % pattern.length;
      delay = Math.max(50, (target - musicSec) * 1000);
      console.log('[beat-schedule] auto path', { ..._dbgBase, nextIdx, finalIdx, target, delay });
    } else {
      console.log('[beat-schedule] no analysis ready, falling through to dur', { ..._dbgBase, dur });
    }
  }
  state.slideshow.timer = setTimeout(() => {
    slideshowNext();
  }, delay);
}

// Settings-modal music preview — shares the engine's single music slot.
function startMusicPreview(file) {
  if (!file || !window.DarkroomAudio) return;
  DarkroomAudio.playMusic(file, { fadeMs: 200, loop: true, volume: 0.6 })
    .catch(e => console.warn('preview failed:', e));
}
function stopMusicPreview() {
  if (window.DarkroomAudio) DarkroomAudio.stopMusic({ fadeMs: 150 });
}

// Pace-preview pulse — visible inside the settings modal while Custom is the
// selected preset. Flashes at the slider's current rate so the user can
// tap-match the music in their head before committing.
let _pacePulseTimer = null;
function startPacePulse() {
  stopPacePulse();
  const pulse = document.getElementById('ss-pace-pulse');
  const paceEl = document.getElementById('ss-pace');
  if (!pulse || !paceEl) return;
  const beat = () => {
    // Beat-on: bright + grown
    pulse.style.opacity = '1';
    pulse.style.transform = 'scale(1.15)';
    // Settle back to resting state after the visible portion of the beat
    setTimeout(() => {
      pulse.style.opacity = '.28';
      pulse.style.transform = 'scale(.55)';
    }, 220);
    // Schedule next beat at the current BPM (live read from slider)
    const bpm = Math.max(20, Number(paceEl.value) || 60);
    _pacePulseTimer = setTimeout(beat, 60000 / bpm);
  };
  beat();
}
function stopPacePulse() {
  if (_pacePulseTimer) { clearTimeout(_pacePulseTimer); _pacePulseTimer = null; }
  const pulse = document.getElementById('ss-pace-pulse');
  if (pulse) { pulse.style.opacity = '0'; pulse.style.transform = 'scale(.55)'; }
}

function slideshowNext() {
  const album = state.currentAlbum;
  if (state.slideshow.timer) clearTimeout(state.slideshow.timer);
  cancelSlideCleanup();
  // End-of-pass: only fade out + close when the album opts in via
  // fadeOutAtEnd; otherwise loop (preserves the long-standing default).
  const settings = album.slideshowSettings || {};
  if (settings.fadeOutAtEnd === true && state.slideshow.slidesShown >= album.assets.length) {
    fadeOutSlideshow();
    return;
  }
  state.slideshow.slidesShown += 1;
  const nextIdx = (state.slideshow.index + 1) % album.assets.length;
  showSlide(nextIdx, 'forward');
  // showSlide's image-load callback calls scheduleNext.
}

// Fade visuals to black and music together, then close. Used at the end of
// a single pass through the album.
function fadeOutSlideshow() {
  const FADE_MS = 6000;
  if (window.DarkroomAudio) DarkroomAudio.stopMusic({ fadeMs: FADE_MS });
  ['a','b'].forEach(s => {
    const el = document.getElementById('slideshow-slide-' + s);
    if (!el) return;
    el.style.transition = `opacity ${FADE_MS}ms ease-out`;
    el.classList.remove('ss-visible');
    el.style.opacity = '0';
  });
  setTimeout(() => closeSlideshow(), FADE_MS + 200);
}

function slideshowPrev() {
  const album = state.currentAlbum;
  const prevIdx = (state.slideshow.index - 1 + album.assets.length) % album.assets.length;
  if (state.slideshow.timer) clearTimeout(state.slideshow.timer);
  cancelSlideCleanup();
  // Backward nav re-anchors the beat grid — next scheduleNext finds a fresh
  // target based on current music position rather than stepping forward.
  state.slideshow.beatIdx = null;
  state.slideshow.beatPtnIdx = null;
  showSlide(prevIdx, 'backward');
}

function toggleSlideshow() {
  state.slideshow.paused = !state.slideshow.paused;
  document.getElementById('slideshow-pause-btn').textContent = state.slideshow.paused ? '▶' : '❚❚';
  if (!state.slideshow.paused) {
    const settings = state.currentAlbum?.slideshowSettings || {};
    if (window.DarkroomAudio && !DarkroomAudio.isMusicPlaying() && settings.musicFile) {
      DarkroomAudio.playMusic(settings.musicFile, { fadeMs: 300, loop: true, volume: 0.85 });
    }
    // Resume re-anchors the beat grid (musicSec jumped while paused)
    state.slideshow.beatIdx = null;
    state.slideshow.beatPtnIdx = null;
    showSlide(state.slideshow.index);
    // showSlide's image-load callback calls scheduleNext
  } else {
    if (state.slideshow.timer) clearTimeout(state.slideshow.timer);
    if (window.DarkroomAudio) DarkroomAudio.pauseMusic({ fadeMs: 300 });
  }
}

function closeSlideshow() {
  if (state.slideshow.timer) clearTimeout(state.slideshow.timer);
  cancelSlideCleanup();
  _stopPaceBadge();
  state.slideshow = { active: false, index: 0, timer: null, paused: false, beatIdx: null, beatPtnIdx: null, slidesShown: 0 };
  document.getElementById('slideshow-overlay').classList.remove('active');
  const card = document.getElementById('ss-title-card');
  if (card) { card.style.opacity = '0'; card.style.display = 'none'; }
  // Wipe inline styles fadeOutSlideshow may have set; otherwise the next
  // slideshow opens with opacity:0 still on both slots = black screen.
  ['a','b'].forEach(s => {
    const el = document.getElementById('slideshow-slide-' + s);
    if (!el) return;
    el.style.transition = '';
    el.style.opacity = '';
  });
  // Reset overlay text elements: clear pending fade timers AND wipe the
  // text content so the previous slideshow's last title/description
  // doesn't bleed into the next one. Also reset opacity/display in case
  // toggleSlideshowDesc (✦ button) left them muted.
  const _dEl = document.getElementById('slideshow-description');
  const _tEl = document.getElementById('slideshow-photo-title');
  if (_tEl) {
    if (_tEl._slideTitleTimer) { clearTimeout(_tEl._slideTitleTimer); _tEl._slideTitleTimer = null; }
    if (_tEl._slideTitleFadeOutTimer) { clearTimeout(_tEl._slideTitleFadeOutTimer); _tEl._slideTitleFadeOutTimer = null; }
    _tEl.textContent = '';
    _tEl.style.opacity = '';
    _tEl.style.display = '';
    _tEl.style.transition = '';
  }
  if (_dEl) {
    if (_dEl._slideDescTimer) { clearTimeout(_dEl._slideDescTimer); _dEl._slideDescTimer = null; }
    if (_dEl._slideDescFadeOutTimer) { clearTimeout(_dEl._slideDescFadeOutTimer); _dEl._slideDescFadeOutTimer = null; }
    _dEl.textContent = '';
    _dEl.style.opacity = '';
    _dEl.style.display = '';
    _dEl.style.transition = '';
  }
  ssDescVisible = true;
  stopSlideshowMusic();
}

// Slideshow keyboard + swipe
document.addEventListener('keydown', e => {
  if (state.slideshow.active) {
    if (e.key === 'ArrowRight') slideshowNext();
    if (e.key === 'ArrowLeft') slideshowPrev();
    if (e.key === ' ') { e.preventDefault(); toggleSlideshow(); }
    if (e.key === 'Escape') closeSlideshow();
  }
});

function slideshowFullscreen() {
  const el = document.getElementById('slideshow-overlay');
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  const isFs = document.fullscreenElement || document.webkitFullscreenElement;
  const btn = document.getElementById('ss-fs-btn');
  if (isFs) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    if (btn) btn.textContent = '⤢';
  } else if (req) {
    req.call(el).then(() => { if (btn) btn.textContent = '⤡'; }).catch(() => {});
  }
}
['fullscreenchange','webkitfullscreenchange'].forEach(ev => document.addEventListener(ev, () => {
  const btn = document.getElementById('ss-fs-btn');
  if (btn) btn.textContent = (document.fullscreenElement || document.webkitFullscreenElement) ? '⤡' : '⤢';
}));

let ssTouchX = null, ssTouchY = null;
document.addEventListener('touchstart', e => {
  if (state.slideshow.active) { ssTouchX = e.touches[0].clientX; ssTouchY = e.touches[0].clientY; }
}, {passive: true});
document.addEventListener('touchend', e => {
  if (!ssTouchX || !state.slideshow.active) return;
  const dx = e.changedTouches[0].clientX - ssTouchX;
  const dy = e.changedTouches[0].clientY - ssTouchY;
  if (dy > 70 && Math.abs(dy) > Math.abs(dx)) { closeSlideshow(); }
  else if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { dx < 0 ? slideshowNext() : slideshowPrev(); }
  ssTouchX = null; ssTouchY = null;
}, {passive: true});

// Stop stray music if page is restored from background without an active slideshow
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !state.slideshow.active && window.DarkroomAudio && DarkroomAudio.isMusicPlaying()) {
    DarkroomAudio.stopMusic({ fadeMs: 0 });
  }
});

// ── SELECTION MODE ──────────────────────────────────────────────────────────
function toggleSelectMode() {
  state.selectMode ? exitSelectMode() : enterSelectMode();
}

function enterSelectMode() {
  state.selectMode = true;
  state.selectedAssets = new Set();
  lastRecentSelectedIdx = -1;
  document.getElementById('select-mode-btn').style.display = 'none';
  document.getElementById('select-actions').style.display = 'flex';
  const items = state.recentSmartResults && state.recentSmartResults.length ? state.recentSmartResults : state.recentItems;
  renderRecentGrid(items);
}

function exitSelectMode() {
  state.selectMode = false;
  state.selectedAssets = new Set();
  lastRecentSelectedIdx = -1;
  document.getElementById('select-mode-btn').style.display = 'inline-block';
  document.getElementById('select-actions').style.display = 'none';
  const items = state.recentSmartResults && state.recentSmartResults.length ? state.recentSmartResults : state.recentItems;
  renderRecentGrid(items);
}

let lastRecentSelectedIdx = -1;

function toggleAssetSelect(assetId, e) {
  const items = state.displayedItems || [];
  const idx = items.findIndex(a => a.id === assetId);
  if (e && e.shiftKey && lastRecentSelectedIdx >= 0 && idx >= 0) {
    const from = Math.min(lastRecentSelectedIdx, idx);
    const to = Math.max(lastRecentSelectedIdx, idx);
    for (let i = from; i <= to; i++) state.selectedAssets.add(items[i].id);
  } else {
    if (state.selectedAssets.has(assetId)) state.selectedAssets.delete(assetId);
    else state.selectedAssets.add(assetId);
    if (idx >= 0) lastRecentSelectedIdx = idx;
  }
  document.getElementById('select-count').textContent = state.selectedAssets.size + ' selected';
  renderRecentGrid(items);
}

function addSelectionToAlbum() {
  if (!state.selectedAssets.size) { alert('Select at least one photo first.'); return; }
  openAddToAlbumModal([...state.selectedAssets]);
}

document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });

(async () => {
  const r = await fetch('/api/auth/check');
  const d = await r.json();
  if (d.authenticated) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    loadGallery();
    fetch('/api/albums').then(r => r.json()).then(a => state.albums = a);
  }
})();

async function loadGallery() {
  const r = await fetch('/api/prints');
  state.prints = await r.json();
  renderTagFilterBar();
  applyFilters();
}

function renderTagFilterBar() {
  const allTags = [...new Set(state.prints.flatMap(p => p.tags || []))].sort();
  const bar = document.getElementById('tag-filter-bar');
  if (!allTags.length) { bar.innerHTML = ''; return; }
  bar.innerHTML = allTags.map(t => `
    <button class="tag-filter ${state.activeTag === t ? 'active' : ''}" data-action="setTagFilter" data-tag="${t}">${t}</button>
  `).join('');
}

function setTagFilter(tag) {
  state.activeTag = state.activeTag === tag ? null : tag;
  renderTagFilterBar();
  applyFilters();
}

function setSort(s) {
  state.sort = s;
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('sort-' + s).classList.add('active');
  applyFilters();
}

function applyFilters() {
  const q = document.getElementById('gallery-search').value.toLowerCase();
  let prints = [...state.prints];

  // Search filter
  if (q) prints = prints.filter(p =>
    p.title.toLowerCase().includes(q) ||
    p.filename.toLowerCase().includes(q) ||
    (p.description || '').toLowerCase().includes(q) ||
    (p.tags || []).some(t => t.toLowerCase().includes(q))
  );

  // Tag filter
  if (state.activeTag) prints = prints.filter(p => (p.tags || []).includes(state.activeTag));

  // Sort
  const sort = state.sort || 'recent';
  if (sort === 'recent') {
    prints.sort((a, b) => {
      const aDate = Math.max(...(a.sessions || []).map(s => new Date(s.date).getTime()), 0);
      const bDate = Math.max(...(b.sessions || []).map(s => new Date(s.date).getTime()), 0);
      return bDate - aDate;
    });
  } else if (sort === 'oldest') {
    prints.sort((a, b) => {
      const aDate = Math.min(...(a.sessions || []).map(s => new Date(s.date).getTime()).filter(Boolean), Infinity);
      const bDate = Math.min(...(b.sessions || []).map(s => new Date(s.date).getTime()).filter(Boolean), Infinity);
      return aDate - bDate;
    });
  } else if (sort === 'title') {
    prints.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sort === 'sessions') {
    prints.sort((a, b) => (b.sessions?.length || 0) - (a.sessions?.length || 0));
  }

  renderGallery(prints);
}

function renderGallery(prints) {
  state.displayedPrints = prints;
  const grid = document.getElementById('gallery-grid');
  if (!prints.length) { grid.innerHTML = '<div class="gallery-empty">No prints yet.<br>Tap + Print to add one.</div>'; return; }
  grid.innerHTML = prints.map(p => `
    <div class="gallery-item" data-action="showDetail" data-id="${p.id}">
      <img src="${thumbSrc(p.immichId)}" alt="${p.title}" loading="lazy" onerror="this.style.background='#1a1a1a'">
      <div class="gallery-item-info">
        <div class="gallery-item-title">${p.title}</div>
        <div class="gallery-item-count">${p.sessions?.length || 0} session${(p.sessions?.length || 0) !== 1 ? 's' : ''}</div>
      </div>
    </div>
  `).join('');
}

async function showDetail(printId, navGen) {
  const myGen = navGen != null ? navGen : ++_navGen;
  const print = state.prints.find(p => p.id === printId);
  if (!print) return;
  const displayedPrints = state.displayedPrints || state.prints;
  const printIdx = displayedPrints.findIndex(p => p.id === printId);
  state.currentPrintId = printId;
  document.getElementById('detail-view').classList.add('active');
  document.getElementById('back-btn').style.display = 'flex';
  document.getElementById('back-btn').onclick = closePrintDetail;
  document.getElementById('add-print-btn').style.display = 'none';
  document.getElementById('header-title').textContent = print.title;

  const content = document.getElementById('detail-content');

  // Attach load/error handlers AFTER innerHTML write — CSP (script-src 'self')
  // blocks inline `onload=""` / `onerror=""` attributes silently.
  const _attachDetailImgHandlers = () => {
    const dimg = content.querySelector('.detail-image');
    if (!dimg) return;
    dimg.addEventListener('error', () => { dimg.style.opacity = '0.2'; dimg.alt = 'Image unavailable'; });
    const onLoad = () => scheduleDetailUpgrade(dimg);
    if (dimg.complete && dimg.naturalWidth > 0) onLoad();
    else dimg.addEventListener('load', onLoad);
  };

  // Phase 1 — paint the image immediately with a placeholder info panel, so the
  // print starts downloading in parallel with (not gated behind) the metadata
  // fetch. Mirrors the library detail view (renderRecentDetail) for uniformity:
  // on slow 5G the print is viewable right away and a metadata stall no longer
  // blanks or fails it.
  content.innerHTML = `
    <div class="detail-layout">
      <div class="detail-left">
        <div style="position:relative;width:100%;height:100%;display:flex;align-items:flex-start;justify-content:center">
          <img class="detail-image" src="${thumbSrc(print.immichId, {size:_isMobileUA() ? 'thumbnail' : 'preview'})}" ${_isMobileUA() ? `data-next="${thumbSrc(print.immichId, {size:'preview'})}"` : ''} alt="${print.title}" data-action="openFullscreen" data-url="/api/immich/original/${print.immichId}" style="cursor:zoom-in;touch-action:manipulation;background:#1a1a1a;min-height:200px">
          <div data-action="printNavPrev" style="position:absolute;left:0;top:0;width:25%;height:100%;cursor:pointer;z-index:10;touch-action:manipulation"></div>
          <div data-action="printNavNext" style="position:absolute;right:0;top:0;width:25%;height:100%;cursor:pointer;z-index:10;touch-action:manipulation"></div>
        </div>
      </div>
      <div class="detail-right">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:0.5rem 1rem;border-bottom:1px solid var(--border)">
          ${printIdx > 0 ? `<button class="nav-arrow" data-action="printNavPrev">&#8249;</button>` : `<div style="width:36px"></div>`}
          <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text-dim)">${printIdx + 1} / ${displayedPrints.length}</div>
          ${printIdx < displayedPrints.length - 1 ? `<button class="nav-arrow" data-action="printNavNext">&#8250;</button>` : `<div style="width:36px"></div>`}
        </div>
        <div class="loading" style="padding:1.5rem;font-size:12px">Loading details…</div>
      </div>
    </div>`;
  _attachDetailImgHandlers();

  // Phase 2 — fetch metadata in parallel and patch only the info panel when it
  // lands; the (already loading) image element is left untouched. 15s abort —
  // a meta failure now costs just the EXIF sidebar, not the print.
  let meta = {};
  let metaFailed = false;
  try {
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), 15000);
    const r = await fetch(`/api/immich/photo/${print.immichId}`, { signal: ac.signal });
    clearTimeout(tid);
    meta = await r.json();
  } catch(e) {
    metaFailed = true;
  }

  // Stale-result guard: a newer nav has happened, drop this result.
  if (myGen !== _navGen) return;

  if (metaFailed) {
    const rp = content.querySelector('.detail-right');
    if (rp) rp.innerHTML = '<div class="loading" style="padding:1.5rem;font-size:12px">Details unavailable — connection is slow. The print above is still viewable; navigate or reopen to retry.</div>';
    return;
  }

  const sessions = (print.sessions || []).slice().sort((a, b) => Number(b.id) - Number(a.id));
  // Lazy-load Darkroom albums if the user opened a print detail before ever
  // visiting the Albums tab. Same NO-empty-array-on-failure rule as elsewhere.
  if (!Array.isArray(state.albums)) {
    try {
      const ac = new AbortController();
      const tid = setTimeout(() => ac.abort(), 15000);
      const r = await fetch('/api/albums', { signal: ac.signal });
      clearTimeout(tid);
      const data = await r.json();
      if (Array.isArray(data)) state.albums = data;
    } catch (e) { /* leave state.albums to other loaders */ }
    if (myGen !== _navGen) return; // stale-result guard
  }
  // Albums this print belongs to — looked up by Immich asset ID against the
  // already-loaded state.albums.
  const printAlbums = (state.albums || []).filter(a => (a.assets || []).includes(print.immichId));

  // Patch only the right-hand info panel; the image element keeps loading.
  const rightPanel = content.querySelector('.detail-right');
  if (!rightPanel) return;
  rightPanel.outerHTML = `
      <div class="detail-right">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:0.5rem 1rem;border-bottom:1px solid var(--border)">
      ${printIdx > 0 ? `<button class="nav-arrow" data-action="printNavPrev">&#8249;</button>` : `<div style="width:36px"></div>`}
      <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text-dim)">${printIdx + 1} / ${displayedPrints.length}</div>
      ${printIdx < displayedPrints.length - 1 ? `<button class="nav-arrow" data-action="printNavNext">&#8250;</button>` : `<div style="width:36px"></div>`}
    </div>
    <div class="detail-meta">
      <div class="detail-title-row">
        <div class="detail-title" id="title-display">${print.title}</div>
        <button class="btn-icon" data-action="startEditTitle" title="Edit title">✎</button>
      </div>
      ${meta.description ? `<div class="detail-film">${meta.description}</div>` : ''}
      <div class="exif-row">
        ${meta.shutterSpeed ? `<div class="exif-item">${meta.shutterSpeed}<span>Shutter</span></div>` : ''}
        ${meta.fNumber ? `<div class="exif-item">f/${meta.fNumber}<span>Aperture</span></div>` : ''}
        ${meta.iso ? `<div class="exif-item">ISO ${meta.iso}<span>ISO</span></div>` : ''}
        ${meta.lens ? `<div class="exif-item">${meta.lens}<span>Lens</span></div>` : ''}
      </div>
      <div style="margin-top:0.5rem;font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text-dim)">${print.filename}</div>
      <div class="print-tags-row" id="print-tags-row">
        ${(print.tags || []).map(t => `<span class="print-tag">${t} <button class="btn-icon" data-action="removeTag" data-tag="${t}" style="font-size:10px">×</button></span>`).join('')}
        <button class="btn-icon" data-action="showTagInput" style="font-size:11px;color:var(--safe)">+ tag</button>
        <input class="tag-add-input" id="tag-add-input" type="text" placeholder="tag name">
      </div>
      ${printAlbums.length ? `
        <div class="print-albums-row">
          <div class="print-albums-label">In albums</div>
          ${printAlbums.map(a => `<button class="album-chip" data-action="openAlbum" data-id="${a.id}" title="Open album">${a.title}</button>`).join('')}
        </div>
      ` : ''}
    </div>
    <div class="sessions-header">
      <div class="sessions-label">Print Sessions (${sessions.length})</div>
      <div style="display:flex;gap:0.5rem">
        <button class="btn btn-ghost btn-sm" data-action="openAddSessionModal">+ Session</button>
        <button class="btn btn-danger btn-sm" data-action="deletePrint">Delete Print</button>
      </div>
    </div>
    ${sessions.length === 0 ? '<div class="loading">No sessions yet.</div>' : ''}
    ${sessions.map(s => {
      const fstop = s.fStop ? (s.fStop.startsWith('f/') ? s.fStop : 'f/' + s.fStop) : '';
      const isSplit = s.technique === 'Split Grade';
      const lowLabel = s.gradeLow || '#00';
      const highLabel = s.gradeHigh || '#5';
      const lowTime = s.gradeOO ? (s.gradeOO.toString().endsWith('s') ? s.gradeOO : s.gradeOO + 's') : '';
      const highTime = s.grade5 ? (s.grade5.toString().endsWith('s') ? s.grade5 : s.grade5 + 's') : '';
      const singleTime = s.time ? (s.time.toString().endsWith('s') ? s.time : s.time + 's') : '';
      const grade = s.grade ? (s.grade.startsWith('#') ? s.grade : '#' + s.grade) : '';
      let exposureLine = '';
      if (isSplit) {
        exposureLine = [fstop, lowLabel + ' → ' + lowTime, highLabel + ' → ' + highTime].filter(Boolean).join('  ·  ');
      } else {
        exposureLine = [fstop, grade, singleTime].filter(Boolean).join('  ·  ');
      }
      return `
      <div class="session-card" id="session-${s.id}">
        <div class="session-header-row">
          <div class="session-date">${s.date}</div>
          <div class="session-size">${s.printSize || ''}</div>
        </div>
        <div class="session-exposure">${exposureLine}</div>
        <div class="session-details">
          ${s.enlarger ? `<span class="session-tag">Enlarger #${s.enlarger}</span>` : ''}
          ${s.lens ? `<span class="session-tag">Lens ${s.lens}</span>` : ''}
          ${s.paper ? `<span class="session-tag">${s.paper}</span>` : ''}
        </div>
        ${s.dodgeBurn ? `<div class="session-notes">${s.dodgeBurn}</div>` : ''}
        ${s.notes ? `<div class="session-notes" style="margin-top:0.5rem;border-color:var(--border);color:var(--text-dim)">${s.notes}</div>` : ''}
        <div class="session-actions">
          <button class="btn btn-ghost btn-sm" data-action="editSession" data-id="${s.id}">Edit</button>
          <button class="btn btn-danger btn-sm" data-action="deleteSession" data-id="${s.id}">Delete</button>
        </div>
      </div>
    `}).join('')}
      </div>
  `;
}

function closePrintDetail() {
  const overlay = document.getElementById('detail-view');
  overlay.classList.add('dismissing');
  setTimeout(() => overlay.classList.remove('active', 'dismissing'), 230);
  document.getElementById('back-btn').style.display = 'none';
  document.getElementById('add-print-btn').style.display = 'inline-block';
  document.getElementById('header-title').textContent = 'Darkroom Log';
}

function showGallery() {
  closePrintDetail();
  loadGallery();
  renderTagFilterBar();
}

function startEditTitle() {
  const print = state.prints.find(p => p.id === state.currentPrintId);
  document.querySelector('.detail-title-row').innerHTML = `
    <input class="title-edit-input" id="title-edit-input" type="text" value="${print.title}">
    <button class="btn btn-ghost btn-sm" data-action="saveTitle">Save</button>
    <button class="btn-icon" data-action="cancelEditTitle" data-title="${encodeURIComponent(print.title)}">✕</button>
  `;
  const inp = document.getElementById('title-edit-input');
  inp.focus();
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') cancelEditTitle(print.title); });
}

async function saveTitle() {
  const newTitle = document.getElementById('title-edit-input').value.trim();
  if (!newTitle) return;
  await fetch(`/api/prints/${state.currentPrintId}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({title: newTitle}) });
  const idx = state.prints.findIndex(p => p.id === state.currentPrintId);
  if (idx !== -1) state.prints[idx].title = newTitle;
  document.getElementById('header-title').textContent = newTitle;
  document.querySelector('.detail-title-row').innerHTML = `
    <div class="detail-title" id="title-display">${newTitle}</div>
    <button class="btn-icon" data-action="startEditTitle" title="Edit title">✎</button>
  `;
}

function cancelEditTitle(original) {
  document.querySelector('.detail-title-row').innerHTML = `
    <div class="detail-title" id="title-display">${original}</div>
    <button class="btn-icon" data-action="startEditTitle" title="Edit title">✎</button>
  `;
}

function openAddPrintModal() {
  document.getElementById('add-print-modal').classList.add('active');
  document.getElementById('immich-search').value = '';
  document.getElementById('immich-results').innerHTML = '';
  document.getElementById('print-title').value = '';
  state.selectedImmich = null;
}

function openAddSessionModal() {
  state.editingSessionId = null;
  // Capture the print id at modal-open time so saveSession() targets the
  // right print even if anything else mutates state.currentPrintId in the
  // meantime (defense in depth on top of the keyboard-nav guard).
  state.sessionPrintId = state.currentPrintId;
  document.getElementById('session-modal-title').textContent = 'Log Print Session';
  clearSessionForm();
  const now = new Date(); const localDate = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0'); document.getElementById('s-date').value = localDate;
  document.getElementById('add-session-modal').classList.add('active');
}

function editSession(sessionId) {
  const print = state.prints.find(p => p.id === state.currentPrintId);
  const s = print.sessions.find(s => s.id === sessionId);
  if (!s) return;
  state.editingSessionId = sessionId;
  state.sessionPrintId = state.currentPrintId;
  document.getElementById('session-modal-title').textContent = 'Edit Session';
  clearSessionForm();
  document.getElementById('s-date').value = s.date || '';
  document.getElementById('s-size').value = s.printSize || '';
  document.getElementById('s-enlarger').value = s.enlarger || '';
  document.getElementById('s-lens').value = s.lens || '';
  const paperSelect = document.getElementById('s-paper'); const knownPapers = ['Fomabrom Variant 111 Glossy','Ilford Multigrade FB Classic Glossy','Ilford Multigrade FB Warmtone Glossy','Ilford Multigrade RC Deluxe']; if (s.paper && knownPapers.includes(s.paper)) { paperSelect.value = s.paper; document.getElementById('s-paper-other').style.display = 'none'; } else if (s.paper) { paperSelect.value = '__other__'; document.getElementById('s-paper-other').value = s.paper; document.getElementById('s-paper-other').style.display = 'block'; } else { paperSelect.value = ''; }
  document.getElementById('s-dodgeburn').value = s.dodgeBurn || '';
  document.getElementById('s-notes').value = s.notes || '';
  if (s.technique === 'Split Grade') {
    setTechnique('split');
    document.getElementById('s-fstop-split').value = s.fStop || '';
    document.getElementById('s-grade-low').value = s.gradeLow || '#00';
    document.getElementById('s-grade-high').value = s.gradeHigh || '#5';
    document.getElementById('s-g00').value = s.gradeOO || '';
    document.getElementById('s-g5').value = s.grade5 || '';
  } else {
    setTechnique('single');
    document.getElementById('s-fstop').value = s.fStop || '';
    document.getElementById('s-grade').value = s.grade || '';
    document.getElementById('s-time').value = s.time || '';
  }
  document.getElementById('add-session-modal').classList.add('active');
}

function clearSessionForm() {
  ['s-date','s-size','s-enlarger','s-lens','s-paper','s-fstop','s-grade','s-time','s-fstop-split','s-grade-low','s-grade-high','s-g00','s-g5','s-dodgeburn','s-notes'].forEach(id => { document.getElementById(id).value = ''; });
  setTechnique('single');
}

function closeModal(id) { document.getElementById(id).classList.remove('active'); }

function setTechnique(t) {
  state.technique = t;
  document.getElementById('t-single').classList.toggle('active', t === 'single');
  document.getElementById('t-split').classList.toggle('active', t === 'split');
  document.getElementById('single-fields').classList.toggle('visible', t === 'single');
  document.getElementById('split-fields').classList.toggle('visible', t === 'split');
}

function searchImmich(q) {
  clearTimeout(state.immichSearchTimeout);
  if (!q || q.length < 2) { document.getElementById('immich-results').innerHTML = ''; return; }
  state.immichSearchTimeout = setTimeout(async () => {
    const r = await fetch(`/api/immich/search?q=${encodeURIComponent(q)}`);
    const items = await r.json();
    const el = document.getElementById('immich-results');
    if (!items.length) { el.innerHTML = '<div class="search-result-item" style="color:var(--text-dim)">No results</div>'; return; }
    const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    el.innerHTML = '<div class="search-results">' + items.map(i => {
      const titleLine = i.title ? `<div style="font-weight:600;line-height:1.2">${esc(i.title)}</div>` : '';
      const fnStyle = i.title ? 'color:var(--text-dim);font-size:11px;line-height:1.2' : '';
      return `<div class="search-result-item" data-action="selectImmich" data-item='${JSON.stringify(i).replace(/'/g, "&#39;")}'>${titleLine}<div style="${fnStyle}">${esc(i.filename)}</div></div>`;
    }).join('') + '</div>';
  }, 300);
}

function selectImmich(item) {
  state.selectedImmich = item;
  document.getElementById('immich-search').value = item.filename;
  if (!document.getElementById('print-title').value) {
    document.getElementById('print-title').value = item.filename.replace(/\.[^.]+$/, '');
  }
  document.getElementById('immich-results').innerHTML = `<div class="search-result-item selected">${item.filename}</div>`;
}

async function createPrint() {
  if (!state.selectedImmich) { alert('Please select a negative from Immich'); return; }
  const title = document.getElementById('print-title').value.trim();
  if (!title) { alert('Please enter a print title'); return; }
  let desc = '';
  try { const mr = await fetch('/api/immich/photo/' + state.selectedImmich.id); const md = await mr.json(); desc = md.description || ''; } catch(e) {}
  const r = await fetch('/api/prints', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ immichId: state.selectedImmich.id, filename: state.selectedImmich.filename, title, description: desc }) });
  const print = await r.json();
  closeModal('add-print-modal');
  await loadGallery();
  showDetail(print.id);
}

function handlePaperChange(el) {
  const other = document.getElementById('s-paper-other');
  other.style.display = el.value === '__other__' ? 'block' : 'none';
  if (el.value === '__other__') other.focus();
}

function getPaperValue() {
  const sel = document.getElementById('s-paper');
  return sel.value === '__other__' ? document.getElementById('s-paper-other').value : sel.value;
}

function autoPrefixHash(el) {
  let v = el.value.replace(/^#+/, '');
  if (v) el.value = '#' + v;
}

function autoPrefixF(el) {
  let v = el.value.replace(/^f\/+/, '');
  if (v) el.value = 'f/' + v;
}

function showTagInput() {
  const inp = document.getElementById('tag-add-input');
  inp.classList.add('visible');
  inp.focus();
}

function handleTagKey(e) {
  if (e.key === 'Enter') addTag();
  if (e.key === 'Escape') {
    document.getElementById('tag-add-input').classList.remove('visible');
    document.getElementById('tag-add-input').value = '';
  }
}

async function addTag() {
  const inp = document.getElementById('tag-add-input');
  const newTags = inp.value.split(/[\s,]+/).map(t => t.trim().toLowerCase()).filter(Boolean);
  if (!newTags.length) return;
  const print = state.prints.find(p => p.id === state.currentPrintId);
  const tags = [...new Set([...(print.tags || []), ...newTags])];
  await fetch(`/api/prints/${state.currentPrintId}`, {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({tags})
  });
  print.tags = tags;
  inp.value = '';
  inp.classList.remove('visible');
  updateTagsDisplay(print);
}

async function removeTag(tag) {
  const print = state.prints.find(p => p.id === state.currentPrintId);
  const tags = (print.tags || []).filter(t => t !== tag);
  await fetch(`/api/prints/${state.currentPrintId}`, {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({tags})
  });
  print.tags = tags;
  updateTagsDisplay(print);
}

function updateTagsDisplay(print) {
  const row = document.getElementById('print-tags-row');
  if (!row) return;
  row.innerHTML = `
    ${(print.tags || []).map(t => `<span class="print-tag">${t} <button class="btn-icon" data-action="removeTag" data-tag="${t}" style="font-size:10px">×</button></span>`).join('')}
    <button class="btn-icon" data-action="showTagInput" style="font-size:11px;color:var(--safe)">+ tag</button>
    <input class="tag-add-input" id="tag-add-input" type="text" placeholder="tag name">
  `;
}

async function saveSession() {
  const isSplit = state.technique === 'split';
  const session = {
    date: document.getElementById('s-date').value,
    printSize: document.getElementById('s-size').value,
    enlarger: document.getElementById('s-enlarger').value,
    lens: document.getElementById('s-lens').value,
    paper: getPaperValue(),
    technique: isSplit ? 'Split Grade' : 'Single Grade',
    fStop: isSplit ? document.getElementById('s-fstop-split').value : document.getElementById('s-fstop').value,
    grade: isSplit ? null : document.getElementById('s-grade').value,
    time: isSplit ? null : document.getElementById('s-time').value,
    gradeLow: isSplit ? document.getElementById('s-grade-low').value : null,
    gradeHigh: isSplit ? document.getElementById('s-grade-high').value : null,
    gradeOO: isSplit ? document.getElementById('s-g00').value : null,
    grade5: isSplit ? document.getElementById('s-g5').value : null,
    dodgeBurn: document.getElementById('s-dodgeburn').value,
    notes: document.getElementById('s-notes').value
  };

  // Always target the print captured at modal-open time, not whatever
  // state.currentPrintId happens to be now (it can drift if anything
  // navigates while the modal is open).
  const targetPrintId = state.sessionPrintId ?? state.currentPrintId;

  if (state.editingSessionId) {
    const print = state.prints.find(p => p.id === targetPrintId);
    const idx = print.sessions.findIndex(s => s.id === state.editingSessionId);
    if (idx !== -1) {
      print.sessions[idx] = { ...print.sessions[idx], ...session };
      await fetch(`/api/prints/${targetPrintId}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ sessions: print.sessions }) });
    }
  } else {
    await fetch(`/api/prints/${targetPrintId}/sessions`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(session) });
  }

  state.sessionPrintId = null;
  closeModal('add-session-modal');
  await loadGallery();
  showDetail(targetPrintId);
}

async function deletePrint() {
  if (!confirm('Delete this print and all its sessions? This cannot be undone.')) return;
  await fetch(`/api/prints/${state.currentPrintId}`, {method:'DELETE'});
  showGallery();
}

async function deleteSession(sessionId) {
  if (!confirm('Delete this session?')) return;
  await fetch(`/api/prints/${state.currentPrintId}/sessions/${sessionId}`, {method:'DELETE'});
  await loadGallery();
  showDetail(state.currentPrintId);
}



// ── IMMICH ALBUMS TAB ─────────────────────────────────────────────────────────

async function loadImmichTab() {
  const grid = document.getElementById('immich-album-grid');
  grid.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const { albums: configuredIds } = await fetch('/api/settings/immich-albums').then(r => r.json());
    state.immichConfiguredIds = configuredIds;
    if (!configuredIds.length) {
      state.immichAlbumsLoaded = true;
      grid.innerHTML = '<div style="text-align:center;padding:3rem;color:var(--text-dim);font-family:\'IBM Plex Mono\',monospace;font-size:12px">No albums configured.<br><br>Click ⚙ Configure to select Immich albums.</div>';
      return;
    }
    const albumDetails = await Promise.all(
      configuredIds.map(id => fetch(`/api/immich/immich-albums/${id}`).then(r => r.json()).catch(() => null))
    );
    state.immichAlbums = albumDetails.filter(a => a && a.id);
    state.immichAlbumsLoaded = true;
    renderImmichAlbumGrid();
  } catch(e) {
    grid.innerHTML = '<div style="color:var(--red);padding:1rem">Error loading albums</div>';
  }
}

function renderImmichAlbumGrid() {
  const grid = document.getElementById('immich-album-grid');
  if (!state.immichAlbums.length) {
    grid.innerHTML = '<div style="text-align:center;padding:3rem;color:var(--text-dim)">No albums found.</div>';
    return;
  }
  grid.innerHTML = '<div class="gallery-grid">' + state.immichAlbums.map(album => {
    const thumb = album.albumThumbnailAssetId ? thumbSrc(album.albumThumbnailAssetId) : '';
    const count = album.assetCount || (album.assets || []).length;
    const name = (album.albumName || 'Untitled').replace(/"/g, '&quot;');
    return `<div class="gallery-item" data-action="openImmichAlbum" data-id="${album.id}" data-name="${name}" style="cursor:pointer;position:relative">
      ${thumb ? `<img src="${thumb}" loading="lazy" style="width:100%;height:100%;object-fit:cover">` : '<div style="width:100%;height:100%;background:var(--surface2);display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:24px">📷</div>'}
      <div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,0.75));padding:0.5rem;font-family:\'IBM Plex Mono\',monospace;font-size:10px;color:#fff;pointer-events:none">
        <div style="font-weight:600;margin-bottom:2px">${album.albumName || 'Untitled'}</div>
        <div style="opacity:0.7">${count} photo${count !== 1 ? 's' : ''}</div>
      </div>
    </div>`;
  }).join('') + '</div>';
}

async function openArchivedView() {
  const gallery = document.getElementById('immich-album-gallery');
  gallery.innerHTML = '<div class="loading">Loading...</div>';
  document.getElementById('immich-album-name').textContent = 'Archived';
  document.getElementById('immich-view').classList.remove('active');
  document.getElementById('immich-album-view').classList.add('active');
  document.getElementById('immich-album-view').scrollTop = 0;
  document.getElementById('back-btn').style.display = 'flex';
  document.getElementById('header-title').textContent = 'Archived';
  document.getElementById('immich-select-mode-btn').style.display = 'inline-block';
  document.getElementById('immich-filters-btn').style.display = 'none';
  const delBtn = document.querySelector('[data-action="deleteImmichAlbum"]');
  if (delBtn) delBtn.style.display = 'none';
  state.viewingArchived = true;
  state.currentImmichAlbumId = null;
  state.currentImmichAlbumAssets = [];
  state.immichActiveChips = new Set();
  state.immichSearchQuery = '';
  const searchEl = document.getElementById('immich-album-search');
  if (searchEl) searchEl.value = '';
  state.immichSelected = new Set();
  state.immichSelectMode = false;
  document.getElementById('back-btn').onclick = () => {
    document.getElementById('immich-album-view').classList.remove('active');
    document.getElementById('immich-view').classList.add('active');
    document.getElementById('back-btn').style.display = 'none';
    document.getElementById('header-title').textContent = 'Darkroom Log';
    document.getElementById('immich-filters-btn').style.display = '';
    const delBtn = document.querySelector('[data-action="deleteImmichAlbum"]');
    if (delBtn) delBtn.style.display = '';
    state.viewingArchived = false;
    exitImmichSelectMode();
  };
  try {
    const data = await fetch('/api/immich/archived').then(r => r.json());
    state.currentImmichAlbumAssets = data.assets || [];
    renderImmichSortBar();
    applyImmichFiltersAndSort();
  } catch(e) {
    gallery.innerHTML = '<div style="color:var(--red);padding:1rem">Error loading archived photos</div>';
  }
}

async function openTrashView() {
  const gallery = document.getElementById('immich-album-gallery');
  gallery.innerHTML = '<div class="loading">Loading...</div>';
  document.getElementById('immich-album-name').textContent = 'Trash';
  document.getElementById('immich-view').classList.remove('active');
  document.getElementById('immich-album-view').classList.add('active');
  document.getElementById('immich-album-view').scrollTop = 0;
  document.getElementById('back-btn').style.display = 'flex';
  document.getElementById('header-title').textContent = 'Trash';
  document.getElementById('immich-select-mode-btn').style.display = 'inline-block';
  document.getElementById('immich-filters-btn').style.display = 'none';
  const delBtn = document.querySelector('[data-action="deleteImmichAlbum"]');
  if (delBtn) delBtn.style.display = 'none';
  state.viewingTrash = true;
  state.viewingArchived = false;
  state.currentImmichAlbumId = null;
  state.currentImmichAlbumAssets = [];
  state.immichActiveChips = new Set();
  state.immichSearchQuery = '';
  const searchEl = document.getElementById('immich-album-search');
  if (searchEl) searchEl.value = '';
  state.immichSelected = new Set();
  state.immichSelectMode = false;
  document.getElementById('back-btn').onclick = () => {
    document.getElementById('immich-album-view').classList.remove('active');
    document.getElementById('immich-view').classList.add('active');
    document.getElementById('back-btn').style.display = 'none';
    document.getElementById('header-title').textContent = 'Darkroom Log';
    document.getElementById('immich-filters-btn').style.display = '';
    const delBtn = document.querySelector('[data-action="deleteImmichAlbum"]');
    if (delBtn) delBtn.style.display = '';
    state.viewingTrash = false;
    exitImmichSelectMode();
  };
  try {
    const data = await fetch('/api/immich/trash').then(r => r.json());
    state.currentImmichAlbumAssets = data.assets || [];
    renderImmichSortBar();
    applyImmichFiltersAndSort();
  } catch(e) {
    gallery.innerHTML = '<div style="color:var(--red);padding:1rem">Error loading trash</div>';
  }
}

async function restoreFromTrashAssets(assetIds) {
  const ids = Array.isArray(assetIds) ? assetIds : [assetIds];
  const count = ids.length;
  if (!confirm(`Restore ${count} photo${count !== 1 ? 's' : ''} from trash?\n\nThey will be returned to the main Immich library.`)) return;
  try {
    const r = await fetch('/api/immich/assets/restore-trash', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    if (!r.ok) throw new Error('Failed');
    state.currentImmichAlbumAssets = state.currentImmichAlbumAssets.filter(a => !ids.includes(a.id));
    applyImmichFiltersAndSort();
    if (state.immichSelectMode) exitImmichSelectMode();
    if (document.getElementById('recent-detail-view').classList.contains('active')) goBackFromDetail();
  } catch(e) { alert('Restore from trash failed.'); }
}

async function permanentDeleteAssets(assetIds, filenames) {
  const ids = Array.isArray(assetIds) ? assetIds : [assetIds];
  const count = ids.length;
  if (!confirm(`Permanently delete ${count} photo${count !== 1 ? 's' : ''}?\n\n⚠️ This cannot be undone. Files will be removed from Immich forever.`)) return;
  try {
    const r = await fetch('/api/immich/assets/permanent', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    if (!r.ok) throw new Error('Failed');
    state.currentImmichAlbumAssets = state.currentImmichAlbumAssets.filter(a => !ids.includes(a.id));
    applyImmichFiltersAndSort();
    if (state.immichSelectMode) exitImmichSelectMode();
    if (document.getElementById('recent-detail-view').classList.contains('active')) goBackFromDetail();
  } catch(e) { alert('Permanent delete failed.'); }
}

function restoreFromTrashSelected() {
  if (!state.immichSelected.size) { alert('Select at least one photo first.'); return; }
  restoreFromTrashAssets([...state.immichSelected]);
}

function permanentDeleteImmichSelected() {
  if (!state.immichSelected.size) { alert('Select at least one photo first.'); return; }
  permanentDeleteAssets([...state.immichSelected]);
}

async function deleteImmichAlbum() {
  const albumId = state.currentImmichAlbumId;
  const albumName = document.getElementById('immich-album-name').textContent || 'this album';
  if (!albumId) return;
  if (!confirm(`Delete "${albumName}" from Immich?\n\nPhotos will stay in your library — only the album is removed.`)) return;
  try {
    const r = await fetch(`/api/immich/immich-albums/${albumId}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Failed');
    // Remove from local immich albums list and go back to the grid
    state.immichAlbums = state.immichAlbums.filter(a => a.id !== albumId);
    state.currentImmichAlbumId = null;
    document.getElementById('immich-album-view').classList.remove('active');
    document.getElementById('immich-view').classList.add('active');
    document.getElementById('back-btn').style.display = 'none';
    document.getElementById('header-title').textContent = 'Darkroom Log';
    renderImmichAlbumGrid();
  } catch(e) { alert('Failed to delete album.'); }
}

async function openImmichAlbum(albumId, albumName) {
  const gallery = document.getElementById('immich-album-gallery');
  gallery.innerHTML = '<div class="loading">Loading...</div>';
  document.getElementById('immich-album-name').textContent = albumName;
  document.getElementById('immich-view').classList.remove('active');
  document.getElementById('immich-album-view').classList.add('active');
  document.getElementById('immich-album-view').scrollTop = 0;
  document.getElementById('back-btn').style.display = 'flex';
  document.getElementById('header-title').textContent = albumName;
  state.viewingArchived = false;
  state.viewingTrash = false;
  const delBtn = document.querySelector('[data-action="deleteImmichAlbum"]');
  if (delBtn) delBtn.style.display = '';
  document.getElementById('back-btn').onclick = () => {
    document.getElementById('immich-album-view').classList.remove('active');
    document.getElementById('immich-view').classList.add('active');
    document.getElementById('back-btn').style.display = 'none';
    document.getElementById('header-title').textContent = 'Darkroom Log';
    exitImmichSelectMode();
  };
  try {
    const data = await fetch(`/api/immich/immich-albums/${albumId}`).then(r => r.json());
    state.currentImmichAlbumId = albumId;
    state.currentImmichAlbumAssets = data.assets || [];
    state.immichActiveChips = new Set();
    state.immichSelected = new Set();
    state.immichSelectMode = false;
    renderImmichSortBar();
    applyImmichFiltersAndSort();
  } catch(e) {
    gallery.innerHTML = '<div style="color:var(--red);padding:1rem">Error loading album</div>';
  }
}

function renderImmichSortBar() {
  ['taken','upload'].forEach(s => {
    const btn = document.getElementById('immich-sort-' + s);
    if (btn) btn.classList.toggle('active', state.immichSort === s);
  });
  const dir = document.getElementById('immich-sort-dir');
  if (dir) dir.textContent = state.immichSortDir === 'desc' ? '↓ Newest' : '↑ Oldest';
}

function setImmichSort(sort) {
  state.immichSort = sort;
  renderImmichSortBar();
  applyImmichFiltersAndSort();
}

function toggleImmichSortDir() {
  state.immichSortDir = state.immichSortDir === 'desc' ? 'asc' : 'desc';
  renderImmichSortBar();
  applyImmichFiltersAndSort();
}

function toggleImmichFilterPopup() {
  const popup = document.getElementById('immich-filter-popup');
  const backdrop = document.getElementById('immich-filter-backdrop');
  if (popup.style.display === 'none') {
    renderImmichFilterPopup();
    popup.style.display = 'block';
    backdrop.style.display = 'block';
  } else {
    popup.style.display = 'none';
    backdrop.style.display = 'none';
  }
}

function renderImmichFilterPopup() {
  const assets = state.currentImmichAlbumAssets;
  const cameras = [...new Set(assets.map(a => a.exifInfo?.model).filter(Boolean))].sort();
  const lenses = [...new Set(assets.map(a => a.exifInfo?.lensModel).filter(Boolean))].sort();
  const cities = [...new Set(assets.map(a => a.exifInfo?.city).filter(Boolean))].sort();
  const chip = (val) => `<button class="tag-filter${state.immichActiveChips.has(val) ? ' active' : ''}" data-action="toggleImmichChip" data-val="${val.replace(/"/g,'&quot;')}">${val}</button>`;
  let html = '';
  if (cameras.length) html += `<div style="font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:var(--text-dim);margin-bottom:0.5rem">Camera</div><div style="display:flex;flex-wrap:wrap;gap:0.3rem;margin-bottom:1rem">${cameras.map(chip).join('')}</div>`;
  if (lenses.length) html += `<div style="font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:var(--text-dim);margin-bottom:0.5rem">Lens</div><div style="display:flex;flex-wrap:wrap;gap:0.3rem;margin-bottom:1rem">${lenses.map(chip).join('')}</div>`;
  if (cities.length) html += `<div style="font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:0.15em;text-transform:uppercase;color:var(--text-dim);margin-bottom:0.5rem">Location</div><div style="display:flex;flex-wrap:wrap;gap:0.3rem;margin-bottom:1rem">${cities.map(chip).join('')}</div>`;
  if (!html) html = '<div style="color:var(--text-dim);font-size:11px">No filter options available.</div>';
  document.getElementById('immich-filter-popup-content').innerHTML = html;
}

function toggleImmichChip(val) {
  if (state.immichActiveChips.has(val)) state.immichActiveChips.delete(val);
  else state.immichActiveChips.add(val);
  const label = document.getElementById('immich-active-chip-label');
  if (label) label.textContent = state.immichActiveChips.size ? [...state.immichActiveChips].join(' · ') : '';
  renderImmichFilterPopup();
  applyImmichFiltersAndSort();
}

function applyImmichFiltersAndSort() {
  let assets = [...state.currentImmichAlbumAssets];
  if (state.immichSearchQuery) {
    const q = state.immichSearchQuery.toLowerCase();
    assets = assets.filter(a => (a.originalFileName || '').toLowerCase().includes(q));
  }
  if (state.immichActiveChips.size) {
    assets = assets.filter(a => {
      const vals = [a.exifInfo?.model, a.exifInfo?.lensModel, a.exifInfo?.city].filter(Boolean);
      return [...state.immichActiveChips].every(chip => vals.includes(chip));
    });
  }
  const dir = state.immichSortDir === 'asc' ? 1 : -1;
  if (state.immichSort === 'taken') {
    assets.sort((a, b) => dir * (new Date(a.localDateTime || a.fileCreatedAt) - new Date(b.localDateTime || b.fileCreatedAt)));
  } else {
    assets.sort((a, b) => dir * (new Date(a.createdAt) - new Date(b.createdAt)));
  }
  state.immichDisplayedAssets = assets;
  renderImmichGallery(assets);
}

function renderImmichGallery(assets) {
  const gallery = document.getElementById('immich-album-gallery');
  if (!assets) assets = state.immichDisplayedAssets.length ? state.immichDisplayedAssets : state.currentImmichAlbumAssets;
  if (!assets.length) {
    gallery.innerHTML = '<div style="text-align:center;padding:3rem;color:var(--text-dim)">No photos in this album.</div>';
    return;
  }
  const action = state.immichSelectMode ? 'toggleImmichAsset' : 'openImmichPhoto';
  gallery.innerHTML = '<div class="gallery-grid">' + assets.map((a, idx) => `
    <div class="gallery-item ${state.immichSelectMode ? 'selectable' : ''} ${state.immichSelected.has(a.id) ? 'selected' : ''}"
         data-action="${action}" data-id="${a.id}" data-idx="${idx}">
      <img src="${thumbSrc(a.id, {ver:a.updatedAt})}" loading="lazy" style="width:100%;height:100%;object-fit:cover">
      ${state.immichSelectMode ? `<div class="select-check${state.immichSelected.has(a.id) ? ' active' : ''}"></div>` : ''}
    </div>
  `).join('') + '</div>';
}

function toggleImmichSelectMode() {
  state.immichSelectMode = true;
  state.immichSelected = new Set();
  document.getElementById('immich-select-mode-btn').style.display = 'none';
  document.getElementById('immich-select-toolbar').style.display = 'flex';
  document.getElementById('immich-select-count').textContent = '0 selected';
  renderImmichGallery();
}

function exitImmichSelectMode() {
  state.immichSelectMode = false;
  state.immichSelected = new Set();
  lastImmichSelectedIdx = -1;
  document.getElementById('immich-select-mode-btn').style.display = 'inline-block';
  document.getElementById('immich-select-toolbar').style.display = 'none';
  renderImmichGallery();
}

let lastImmichSelectedIdx = -1;

function toggleImmichAsset(assetId, e) {
  const assets = state.immichDisplayedAssets.length ? state.immichDisplayedAssets : state.currentImmichAlbumAssets;
  const idx = assets.findIndex(a => a.id === assetId);
  if (e && e.shiftKey && lastImmichSelectedIdx >= 0) {
    const from = Math.min(lastImmichSelectedIdx, idx);
    const to = Math.max(lastImmichSelectedIdx, idx);
    for (let i = from; i <= to; i++) state.immichSelected.add(assets[i].id);
  } else {
    if (state.immichSelected.has(assetId)) state.immichSelected.delete(assetId);
    else state.immichSelected.add(assetId);
    lastImmichSelectedIdx = idx;
  }
  document.getElementById('immich-select-count').textContent = state.immichSelected.size + ' selected';
  updateImmichArchiveBtn();
  renderImmichGallery();
}

function openImmichAddToAlbum() {
  if (!state.immichSelected.size) { alert('Select at least one photo first.'); return; }
  openAddToAlbumModal([...state.immichSelected]);
}

function removeImmichSelectedFromAlbum() {
  if (!state.immichSelected.size) { alert('Select at least one photo first.'); return; }
  removeFromImmichAlbum([...state.immichSelected]);
}

function archiveImmichSelected() {
  if (!state.immichSelected.size) { alert('Select at least one photo first.'); return; }
  archiveImmichAssets([...state.immichSelected]);
}

function restoreImmichSelected() {
  if (!state.immichSelected.size) { alert('Select at least one photo first.'); return; }
  restoreImmichAssets([...state.immichSelected]);
}

function openImmichPhoto(assetId, idx) {
  state.displayedItems = state.immichDisplayedAssets.length ? state.immichDisplayedAssets : state.currentImmichAlbumAssets;
  state.lastClickedImmichEl = document.querySelector(`#immich-album-gallery [data-id="${assetId}"]`);
  showRecentDetail(assetId);
}

async function downloadImmichSelected() {
  const ids = [...state.immichSelected];
  if (!ids.length) { alert('Select at least one photo first.'); return; }
  for (const id of ids) {
    let filename = state.recentMeta[id]?.filename || null;
    if (!filename) {
      try {
        const m = await fetch('/api/immich/photo/' + id).then(r => r.json());
        filename = m.filename || (id + '.jpg');
        if (!state.recentMeta[id]) state.recentMeta[id] = {};
        state.recentMeta[id].filename = filename;
      } catch(e) { filename = id + '.jpg'; }
    }
    const r = await fetch('/api/immich/original/' + id);
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    await new Promise(r => setTimeout(r, 400));
  }
}

// ── IMMICH SETTINGS MODAL ─────────────────────────────────────────────────────

async function forceRefresh() {
  if (!confirm('Clear cache and reload? Login is preserved.')) return;
  try {
    if ('caches' in self) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch (e) {
    console.error('forceRefresh: cache clear failed', e);
  }
  location.reload();
}

async function openImmichSettings() {
  const modal = document.getElementById('immich-settings-modal');
  const list = document.getElementById('immich-settings-list');
  modal.style.display = 'flex';
  list.innerHTML = '<div class="loading">Loading all Immich albums...</div>';
  try {
    const [allAlbums, { albums: configuredIds }] = await Promise.all([
      fetch('/api/immich/immich-albums').then(r => r.json()),
      fetch('/api/settings/immich-albums').then(r => r.json())
    ]);
    const configured = new Set(configuredIds);
    list.innerHTML = (allAlbums || []).map(album => {
      const thumb = album.albumThumbnailAssetId
        ? `<img src="${thumbSrc(album.albumThumbnailAssetId)}" style="width:40px;height:40px;object-fit:cover;border-radius:3px;flex-shrink:0">`
        : '<div style="width:40px;height:40px;background:var(--surface2);border-radius:3px;flex-shrink:0"></div>';
      return `<label style="display:flex;align-items:center;gap:0.75rem;padding:0.5rem 0;border-bottom:1px solid var(--border);cursor:pointer">
        <input type="checkbox" data-album-id="${album.id}" ${configured.has(album.id) ? 'checked' : ''} style="width:16px;height:16px;flex-shrink:0;accent-color:var(--safe)">
        ${thumb}
        <div>
          <div style="font-size:13px;color:var(--text)">${album.albumName || 'Untitled'}</div>
          <div style="font-size:10px;color:var(--text-dim);font-family:'IBM Plex Mono',monospace">${album.assetCount || 0} photos</div>
        </div>
      </label>`;
    }).join('');
  } catch(e) {
    list.innerHTML = '<div style="color:var(--red)">Error loading albums</div>';
  }
}

function closeImmichSettings() {
  document.getElementById('immich-settings-modal').style.display = 'none';
}

async function saveImmichSettings() {
  const checkboxes = document.querySelectorAll('#immich-settings-list input[type="checkbox"]');
  const albums = [...checkboxes].filter(cb => cb.checked).map(cb => cb.dataset.albumId);
  await fetch('/api/settings/immich-albums', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ albums })
  });
  closeImmichSettings();
  state.immichAlbumsLoaded = false;
  loadImmichTab();
}

// ── EVENT LISTENERS ──────────────────────────────────────────────────────────
// Wired directly since app.js loads with defer (DOM is ready)

function wireListeners() {
  const w = (id, evt, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(evt, fn); };

  // Login
  w('btn-login', 'click', () => login());

  // Header
  w('btn-show-gallery', 'click', () => showGallery());
  w('add-print-btn', 'click', () => openAddPrintModal());
  w('btn-logout', 'click', () => logout());
  // Tap header (away from buttons/links) → scroll active view to top.
  // iOS Safari does this on the status bar natively; Android has no equivalent, so we wire
  // the same behavior here for both platforms. Whichever .view is .active is the scroller.
  const _hdr = document.querySelector('.header');
  if (_hdr) {
    _hdr.addEventListener('click', (e) => {
      if (e.target.closest('button, a, input, select, [role="button"]')) return;
      const v = document.querySelector('.view.active');
      if (v) v.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Tabs
  w('tab-prints', 'click', () => switchTab('prints'));
  w('tab-recent', 'click', () => switchTab('recent'));
  w('tab-albums', 'click', () => switchTab('albums'));
  w('tab-immich', 'click', () => switchTab('immich'));

  // Prints
  w('gallery-search', 'input', () => applyFilters());
  w('sort-recent', 'click', () => setSort('recent'));
  w('sort-oldest', 'click', () => setSort('oldest'));
  w('sort-title', 'click', () => setSort('title'));
  w('sort-sessions', 'click', () => setSort('sessions'));

  // Library
  w('recent-search', 'input', (e) => {
    handleRecentSearch(e.target.value);
    document.getElementById('btn-clear-recent-search').style.display = e.target.value ? 'block' : 'none';
  });
  // Tap into the search bar to reveal Search Mode/Select/Filters — stays
  // open while typing (closes via its backdrop or the Done button instead).
  w('recent-search', 'focus', openRecentFilterPopup);
  w('recent-filter-backdrop', 'click', closeRecentFilterPopup);
  w('refresh-thumbs', 'click', (e) => { refreshThumbnails(e.currentTarget); closeSortPopup(); });
  w('search-mode-text', 'click', () => setSearchMode('text'));
  w('search-mode-smart', 'click', () => setSearchMode('smart'));
  w('select-mode-btn', 'click', () => { toggleSelectMode(); closeRecentFilterPopup(); });
  w('btn-add-selection-album', 'click', () => addSelectionToAlbum());
  w('btn-download-selection', 'click', () => downloadSelectedAssets());
  w('btn-exit-select', 'click', () => exitSelectMode());
  w('lib-sort-upload', 'click', () => { setLibrarySort('upload'); closeSortPopup(); });
  w('lib-sort-taken', 'click', () => { setLibrarySort('taken'); closeSortPopup(); });
  w('lib-sort-edited', 'click', () => { setLibrarySort('edited'); closeSortPopup(); });
  w('lib-sort-dir', 'click', () => toggleLibrarySortDir());
  w('lib-sort-mode', 'click', () => toggleRecentMode());
  w('sort-chip-btn', 'click', toggleSortPopup);
  w('sort-backdrop', 'click', closeSortPopup);
  w('people-filter-input', 'input', () => filterPeopleChips());
  w('filter-camera', 'change', (e) => setFilterDropdown('cameras', e.target.value));
  w('filter-lens', 'change', (e) => setFilterDropdown('lenses', e.target.value));
  w('filter-state', 'change', (e) => setFilterDropdown('states', e.target.value));
  w('filter-city', 'change', (e) => setFilterDropdown('cities', e.target.value));
  w('filter-film', 'change', (e) => setFilterDropdown('films', e.target.value));
  w('filters-done-btn', 'click', closeRecentFilterPopup);
  w('btn-clear-chips', 'click', () => { clearRecentChip(); closeRecentFilterPopup(); });

  // Immich sort/filter
  // btn-immich-add-album removed — handled by data-action="openImmichAddToAlbum" delegation
  w('immich-sort-taken', 'click', () => setImmichSort('taken'));
  w('immich-sort-upload', 'click', () => setImmichSort('upload'));
  w('immich-sort-dir', 'click', () => toggleImmichSortDir());
  w('immich-filters-btn', 'click', () => toggleImmichFilterPopup());
  w('immich-filter-backdrop', 'click', () => toggleImmichFilterPopup());
  w('immich-album-search', 'input', (e) => { state.immichSearchQuery = e.target.value; applyImmichFiltersAndSort(); });

  // Albums
  w('btn-create-album', 'click', () => openCreateAlbumModal());
  const albumSortSel = document.getElementById('album-sort');
  if (albumSortSel) {
    albumSortSel.value = state.albumSort;
    albumSortSel.addEventListener('change', () => {
      state.albumSort = albumSortSel.value;
      try { localStorage.setItem('albumSort', state.albumSort); } catch (e) {}
      renderAlbumsGrid();
    });
  }

  // Album drag-to-reorder — CSP-safe delegated listeners
  const _albumGrid = document.getElementById('album-photo-grid');
  if (_albumGrid) {
    _albumGrid.addEventListener('dragstart', e => {
      const el = e.target.closest('[data-drag-idx]');
      if (el) dragStart(e, parseInt(el.dataset.dragIdx));
    });
    _albumGrid.addEventListener('dragover', e => dragOver(e));
    _albumGrid.addEventListener('drop', e => {
      const el = e.target.closest('[data-drag-idx]');
      if (el) dragDrop(e, parseInt(el.dataset.dragIdx));
    });
  }

  // Slideshow overlay + controls
  w('slideshow-overlay', 'click', () => showSlideshowControls());
  document.getElementById('slideshow-overlay')?.addEventListener('mousemove', () => { if (state.slideshow.active) showSlideshowControls(); });
  w('btn-ss-prev', 'click', () => slideshowPrev());
  w('slideshow-pause-btn', 'click', () => toggleSlideshow());
  w('slideshow-desc-btn', 'click', () => toggleSlideshowDesc());
  w('slideshow-music-btn', 'click', () => toggleSlideshowMusic());
  w('btn-ss-next', 'click', () => slideshowNext());
  w('ss-fs-btn', 'click', (e) => { slideshowFullscreen(); e.stopPropagation(); });
  w('btn-ss-close', 'click', () => closeSlideshow());

  // Slideshow settings modal
  w('btn-ss-modal-close', 'click', () => { stopPacePulse(); stopMusicPreview(); closeModal('slideshow-settings-modal'); });
  w('btn-ss-modal-cancel', 'click', () => { stopPacePulse(); stopMusicPreview(); closeModal('slideshow-settings-modal'); });
  w('toggle-show-title', 'click', () => { ssToggle('ss-show-title'); toggleSSTitleOptions(); });
  w('toggle-show-location', 'click', () => ssToggle('ss-show-location'));
  w('toggle-show-dates', 'click', () => ssToggle('ss-show-dates'));
  w('toggle-show-count', 'click', () => ssToggle('ss-show-count'));
  w('toggle-show-photo-title', 'click', () => ssToggle('ss-show-photo-title'));
  w('toggle-show-photo-description', 'click', () => ssToggle('ss-show-photo-description'));
  w('toggle-ss-fade-out-end', 'click', () => ssToggle('ss-fade-out-end'));
  w('toggle-ss-show-pace', 'click', () => ssToggle('ss-show-pace'));
  w('btn-ss-start', 'click', () => saveSlideshowSettingsAndStart());
  // Live: show/hide the pace slider when preset toggles to/from Custom
  w('ss-preset', 'change', (e) => {
    const customWrap = document.getElementById('ss-custom-pace');
    const beatWrap = document.getElementById('ss-beat-pace');
    const isBeat = e.target.value === 'beat' || e.target.value === 'beatfade';
    if (customWrap) customWrap.style.display = e.target.value === 'custom' ? 'block' : 'none';
    if (beatWrap) beatWrap.style.display = isBeat ? 'block' : 'none';
    if (e.target.value === 'custom') startPacePulse(); else stopPacePulse();
    if (isBeat) {
      const file = document.getElementById('ss-music-select')?.value || null;
      refreshBeatStatus(file);
    }
  });
  // Live: keep the pace label in sync with slider input, retiming the pulse
  w('ss-pace', 'input', (e) => {
    const label = document.getElementById('ss-pace-label');
    const bpm = Number(e.target.value) || 60;
    if (label) label.textContent = `${bpm} BPM · ${(8 * 60 / bpm).toFixed(1)}s/slide`;
    const presetEl = document.getElementById('ss-preset');
    if (presetEl && presetEl.value === 'custom') startPacePulse();
  });
  // Beat-preset BPM override slider — only consulted when the toggle is ON.
  w('ss-beat-bpm-override', 'input', (e) => {
    const label = document.getElementById('ss-beat-bpm-override-label');
    if (label) label.textContent = `${e.target.value} BPM`;
  });
  // Override toggle — shows/hides the slider row; scheduler reads the toggle.
  w('toggle-ss-beat-override', 'click', () => {
    ssToggle('ss-beat-override-enabled');
    const on = ssToggleVal('ss-beat-override-enabled');
    const row = document.getElementById('ss-beat-override-row');
    if (row) row.style.display = on ? 'flex' : 'none';
  });
  // Live: switch the music preview when user picks a different track; if the
  // Beat preset is active, kick off analysis on the new track.
  w('ss-music-select', 'change', (e) => {
    const presetEl = document.getElementById('ss-preset');
    if (presetEl && (presetEl.value === 'beat' || presetEl.value === 'beatfade')) {
      refreshBeatStatus(e.target.value || null);
    }
  });

  // Modals
  w('btn-close-create-album', 'click', () => closeModal('create-album-modal'));
  w('btn-create-album-confirm', 'click', () => createAlbum());
  w('btn-close-add-album', 'click', () => closeModal('add-to-album-modal'));
  w('btn-quick-create-add', 'click', () => quickCreateAndAdd());
  w('btn-quick-create-immich', 'click', () => quickCreateAndAddImmich());
  // Fullscreen overlay-level gestures. Pinch / pan / dblclick / ctrl+wheel
  // are owned by zoom.js attached to <img id="fullscreen-img">. Here we only
  // track 1-finger swipes for prev/next/close + tap-zones, and gate every
  // branch on _fsIsZoomed() so a pan-while-zoomed isn't reinterpreted.
  let _fsSwipeX = null, _fsSwipeY = null, _fsDidSwipe = false;
  const _fsEl = document.getElementById('fullscreen-overlay');
  _fsEl.addEventListener('touchstart', e => {
    _fsDidSwipe = false;
    if (e.touches.length === 1 && !_fsIsZoomed()) {
      _fsSwipeX = e.touches[0].clientX;
      _fsSwipeY = e.touches[0].clientY;
    } else {
      _fsSwipeX = _fsSwipeY = null;
    }
  }, {passive: true});
  _fsEl.addEventListener('touchend', e => {
    if (_fsSwipeX !== null && !_fsIsZoomed()) {
      const dx = e.changedTouches[0].clientX - _fsSwipeX;
      const dy = e.changedTouches[0].clientY - _fsSwipeY;
      if (Math.abs(dx) > 70 && Math.abs(dy) < 60) {
        _fsDidSwipe = true;
        dx < 0 ? fullscreenNavigate(1) : fullscreenNavigate(-1);
      } else if (dy > 70 && Math.abs(dy) > Math.abs(dx) * 1.5) {
        _fsDidSwipe = true;
        closeFullscreen();
      }
    }
    _fsSwipeX = _fsSwipeY = null;
  }, {passive: true});
  // Click handler defers its action by 280 ms so a double-tap can cancel it.
  // Without this, a double-tap-to-zoom races with the tap-zone nav and the
  // user toggles back-and-forth between fullscreen and the detail view.
  // Cancellation paths: (a) native dblclick on the <img> (mouse) and (b) the
  // manual touch double-tap detected inside zoom.js, which fires the
  // `onDoubleTap` callback we register at attach time (see openFullscreen).
  // Center-of-image is no longer a close zone — closes happen on background
  // clicks (black bars around the image), Esc, or swipe-down.
  let _fsClickTimer = null;
  function _fsCancelPendingClick() {
    if (_fsClickTimer) { clearTimeout(_fsClickTimer); _fsClickTimer = null; }
  }
  window._fsCancelPendingClick = _fsCancelPendingClick; // exposed for zoom.js callback
  w('fullscreen-overlay', 'click', e => {
    if (_fsDidSwipe) { _fsDidSwipe = false; return; }
    if (_fsIsZoomed()) return; // taps while zoomed do nothing — zoom.js owns the image
    if (Date.now() < (window._fsIgnoreClicksUntil || 0)) return; // post-double-tap suppression
    const onImage = e.target && e.target.id === 'fullscreen-img';
    const xPos = e.clientX;
    const vw = window.innerWidth;
    _fsCancelPendingClick();
    _fsClickTimer = setTimeout(() => {
      _fsClickTimer = null;
      if (onImage) {
        // Image tap-zones: left 25% prev, right 25% next, center close. The
        // close path is safe here despite the historical double-tap-bounce bug
        // because a double-tap cancels this timer via onDoubleTap (touch) or
        // dblclick (mouse) before it ever fires. The second click of a
        // double-tap also bails on the _fsIsZoomed() check at the top of this
        // handler since zoom.js has already toggled scale by then.
        if (xPos < vw * 0.25) { fullscreenNavigate(-1); }
        else if (xPos > vw * 0.75) { fullscreenNavigate(1); }
        else { closeFullscreen(); }
      } else {
        // Background click (outside the image bounds) also closes.
        closeFullscreen();
      }
    }, 280);
  });
  // Native dblclick (desktop mouse) cancels the deferred click action so the
  // double-click-to-zoom doesn't bounce out of fullscreen first.
  document.getElementById('fullscreen-img').addEventListener('dblclick', _fsCancelPendingClick);
  w('btn-close-add-print', 'click', () => closeModal('add-print-modal'));
  w('immich-search', 'input', (e) => searchImmich(e.target.value));
  w('btn-create-print', 'click', () => createPrint());
  w('btn-close-add-session', 'click', () => closeModal('add-session-modal'));
  w('select-paper', 'change', (e) => handlePaperChange(e.target));
  w('t-single', 'click', () => setTechnique('single'));
  w('t-split', 'click', () => setTechnique('split'));
  w('btn-save-session', 'click', () => saveSession());

  // Delegated handlers for dynamic form inputs
  document.addEventListener('input', (e) => {
    if (e.target.classList.contains('input-aperture')) autoPrefixF(e.target);
    if (e.target.classList.contains('input-hash')) autoPrefixHash(e.target);
  });

  // Delegated keydown for dynamically generated tag input
  document.addEventListener('keydown', (e) => {
    if (e.target.classList.contains('tag-add-input')) handleTagKey(e);
  });
}


// ─── COMPREHENSIVE EVENT DELEGATION ─────────────────────────────────────────
// Handles all dynamically generated UI interactions
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const id = el.dataset.id;
  const val = el.dataset.val;

  switch(action) {
    // Filter chips
    case 'searchByPerson': searchByPerson(id, el.dataset.name); break;
    case 'searchByImmichTag': searchByImmichTag(el.dataset.tag); break;
    case 'clearRecentSearch': clearRecentSearch(); break;

    // Library
    case 'recentItemClick':
      if (state.selectMode) toggleAssetSelect(id, e);
      else showRecentDetail(id);
      break;
    case 'openFullscreen': openFullscreen(el.dataset.url); break;
    case 'navPrev': navigateRecent(-1); break;
    case 'navNext': navigateRecent(1); break;
    case 'printNavPrev': navigatePrint(-1); break;
    case 'printNavNext': navigatePrint(1); break;
    case 'openAddToAlbumModal': openAddToAlbumModal(id); break;
    case 'addToImmichAlbum': addToImmichAlbum(id); break;
    case 'switchAlbumTab': switchAlbumModalTab(el.dataset.tab); break;
    case 'removeFromImmichAlbumDetail': removeFromImmichAlbum(id); break;
    case 'archiveFromDetail': archiveImmichAssets(id); break;
    case 'restoreFromDetail': restoreImmichAssets(id); break;
case 'shareSelected': shareSelected(id, el.dataset.filename, el.dataset.desc); break;
    case 'copyEmbedUrl': copyEmbedUrl(id); break;
    case 'deleteImmichAsset': deleteImmichAsset(id, el.dataset.filename); break;
    case 'shareRecent': shareRecent(id, el.dataset.filename, el.dataset.desc, el.dataset.size); break;
    case 'executeShare': executeShare(); break;
    case 'closeShareModal': closeShareModal(); break;

    // Albums
    case 'openAlbum': openAlbum(id); break;
    case 'openSlideshowSettings': openSlideshowSettings(); break;
    case 'toggleAlbumEdit': toggleAlbumEdit(); break;
    case 'toggleAlbumSelectMode': toggleAlbumSelectMode(); break;
    case 'copyShareLink': copyShareLink(el.dataset.url); break;
    case 'albumPhotoClick':
      if (state.albumSelectMode) toggleAlbumPhotoSelect(id, e);
      else if (!state.albumEditMode) showAlbumPhotoDetail(id, parseInt(el.dataset.idx));
      break;
    case 'removeFromAlbum': e.stopPropagation(); removeFromAlbum(id); break;
    case 'openAlbumSlideshow': e.stopPropagation(); openAlbumSlideshow(parseInt(el.dataset.idx)); break;
    case 'addToAlbum': addToAlbum(id); break;
    case 'downloadSelectedAlbumPhotos': downloadSelectedAlbumPhotos(); break;
    case 'removeSelectedFromAlbum': removeSelectedFromAlbum(); break;

    // Immich Albums tab
    case 'openImmichAlbum': openImmichAlbum(id, el.dataset.name); break;
    case 'openArchivedView': openArchivedView(); break;
    case 'openTrashView': openTrashView(); break;
    case 'deleteImmichAlbum': deleteImmichAlbum(); break;
    case 'openImmichPhoto': openImmichPhoto(id, el.dataset.idx); break;
    case 'toggleImmichAsset': toggleImmichAsset(id, e); break;
    case 'toggleImmichSelectMode': toggleImmichSelectMode(); break;
    case 'exitImmichSelectMode': exitImmichSelectMode(); break;
    case 'downloadImmichSelected': downloadImmichSelected(); break;
    case 'openImmichAddToAlbum': openImmichAddToAlbum(); break;
    case 'removeImmichSelectedFromAlbum': removeImmichSelectedFromAlbum(); break;
    case 'archiveImmichSelected': archiveImmichSelected(); break;
    case 'restoreImmichSelected': restoreImmichSelected(); break;
    case 'restoreFromTrashSelected': restoreFromTrashSelected(); break;
    case 'permanentDeleteImmichSelected': permanentDeleteImmichSelected(); break;
    case 'restoreFromTrashDetail': restoreFromTrashAssets(id); break;
    case 'permanentDeleteDetail': permanentDeleteAssets(id); break;
    case 'forceRefresh': forceRefresh(); break;
    case 'openImmichSettings': openImmichSettings(); break;
    case 'closeImmichSettings': closeImmichSettings(); break;
    case 'saveImmichSettings': saveImmichSettings(); break;
    case 'setImmichSort': setImmichSort(el.dataset.sort); break;
    case 'toggleImmichSortDir': toggleImmichSortDir(); break;
    case 'toggleImmichFilterPopup': toggleImmichFilterPopup(); break;
    case 'toggleImmichChip': toggleImmichChip(el.dataset.val); break;

    // Prints
    case 'setTagFilter': setTagFilter(el.dataset.tag); break;
    case 'showDetail': showDetail(id); break;
    case 'startEditTitle': startEditTitle(); break;
    case 'removeTag': removeTag(el.dataset.tag); break;
    case 'showTagInput': showTagInput(); break;
    case 'renameAlbum': renameAlbum(id); break;
    case 'deleteAlbum': deleteAlbum(id); break;
    case 'deletePrint': deletePrint(); break;
    case 'editSession': editSession(id); break;
    case 'deleteSession': deleteSession(id); break;
    case 'saveTitle': saveTitle(); break;
    case 'cancelEditTitle': cancelEditTitle(decodeURIComponent(el.dataset.title)); break;
    case 'openAddSessionModal': openAddSessionModal(); break;

    // Immich search
    case 'selectImmich':
      try { selectImmich(JSON.parse(el.dataset.item)); } catch(err) {}
      break;
  }
});

wireListeners();
