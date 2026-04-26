
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
  currentRecentId: null,
  currentRecentIndex: -1,
  fullscreenOpen: false,
  recentMeta: {},
  filterOptions: null,
  librarySort: 'upload',
  librarySortDir: 'desc',
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

function setLibrarySort(sort) {
  state.librarySort = sort;
  document.querySelectorAll('[id^="lib-sort-"]').forEach(b => b.classList.remove('active'));
  document.getElementById('lib-sort-' + sort).classList.add('active');
  state.recentPage = 1;
  state.recentItems = [];
  fetchRecentPage();
}

function toggleLibrarySortDir() {
  state.librarySortDir = state.librarySortDir === 'desc' ? 'asc' : 'desc';
  const btn = document.getElementById('lib-sort-dir');
  if (btn) btn.textContent = state.librarySortDir === 'desc' ? '↓ Newest' : '↑ Oldest';
  state.recentPage = 1;
  state.recentItems = [];
  fetchRecentPage();
}

async function loadRecent() {
  state.recentPage = 1;
  state.recentItems = [];
  state.recentLoaded = true;
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
      takenAt: a.takenAt || a.localDateTime || a.fileCreatedAt || ''
    };
  }
}

async function fetchRecentPage() {
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
  const r = await fetch(`/api/immich/recent?page=${state.recentPage}&size=${size}&sort=${state.librarySort}&dir=${state.librarySortDir}`);
  const data = await r.json();
  const items = data.assets || [];
  absorbAssetMeta(items);
  state.recentItems = [...state.recentItems, ...items];
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
        takenAt: meta.takenAt || ''
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
  const grid = document.getElementById('recent-grid');
  grid.innerHTML = '<div class="loading">Searching...</div>';
  try {
    // Categorize chips using filterOptions if available, otherwise send all as unknown
    const opts = state.filterOptions || {};
    const cameraSet = new Set(opts.cameras || []);
    const lensSet = new Set(opts.lenses || []);
    const citySet = new Set(opts.cities || []);
    // If filterOptions not loaded, categorize by trying all fields on server
    const cameras = cameraSet.size ? chips.filter(c => cameraSet.has(c)) : [];
    const lenses = lensSet.size ? chips.filter(c => lensSet.has(c)) : [];
    const cities = citySet.size ? chips.filter(c => citySet.has(c)) : [];
    // For uncategorized chips (when filterOptions not loaded), pass as unknowns
    const known = new Set([...cameras, ...lenses, ...cities]);
    const unknowns = chips.filter(c => !known.has(c));
    const r = await fetch('/api/immich/combined-search', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ cameras, lenses, cities, unknowns, personId, size: 250, page: 1 })
    });
    const data = await r.json();
    const items = data.assets || [];
    state.recentSmartResults = items;
    state.searchPage = 1;
    absorbAssetMeta(items);
    renderRecentGrid(items);
    loadRecentMetaBatch(items.map(a => a.id));
    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.style.display = items.length === 250 ? 'block' : 'none';
      loadMoreBtn.onclick = async () => {
        state.searchPage++;
        const r2 = await fetch('/api/immich/combined-search', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ cameras, lenses, cities, personId, size: 250, page: state.searchPage })
        });
        const d2 = await r2.json();
        state.recentSmartResults = [...state.recentSmartResults, ...(d2.assets || [])];
        renderRecentGrid(state.recentSmartResults);
        loadMoreBtn.style.display = (d2.assets || []).length === 250 ? 'block' : 'none';
      };
    }
  } catch(e) {
    grid.innerHTML = '<div class="loading">Search failed.</div>';
  }
}

async function runTextSearch(q, append = false) {
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

let _outsideClickHandler = null;
function toggleFiltersPopup() {
  const popup = document.getElementById('recent-filter-popup');
  const opening = popup.style.display === 'none';
  popup.style.display = opening ? 'block' : 'none';
  if (_outsideClickHandler) {
    document.removeEventListener('mousedown', _outsideClickHandler);
    _outsideClickHandler = null;
  }
  if (opening) {
    updateRecentFilterChips();
    setTimeout(() => {
      _outsideClickHandler = function(e) {
        if (!popup.contains(e.target) && e.target.id !== 'filters-btn') {
          popup.style.display = 'none';
          document.removeEventListener('mousedown', _outsideClickHandler);
          _outsideClickHandler = null;
        }
      };
      document.addEventListener('mousedown', _outsideClickHandler);
    }, 0);
  }
}

function updateRecentFilterChips() {
  const opts = state.filterOptions || {};
  const cameras = opts.cameras || [];
  const lenses = opts.lenses || [];
  const cities = opts.cities || [];
  const people = opts.people || [];
  const building = opts.building;
  const chip = (label, val) => `<button class="tag-filter${state.recentActiveChips.has(val) ? ' active' : ''}" data-action="setRecentChip" data-val="${val}">${label}</button>`;
  const personChip = (p) => `<button class="tag-filter${state.recentActivePerson === p.id ? ' active' : ''}" data-action="searchByPerson" data-id="${p.id}" data-name="${p.name}">${p.name}</button>`;
  const camEl = document.getElementById('chip-cameras');
  const lensEl = document.getElementById('chip-lenses');
  const cityEl = document.getElementById('chip-cities');
  const peopleEl = document.getElementById('chip-people');
  const loadingMsg = building ? '<span style="color:var(--text-dim);font-size:11px">Building index...</span>' : '<span style="color:var(--text-dim);font-size:11px">None found</span>';
  if (camEl) camEl.innerHTML = cameras.map(c => chip(c, c)).join('') || loadingMsg;
  if (lensEl) lensEl.innerHTML = lenses.map(l => chip(l, l)).join('') || loadingMsg;
  if (cityEl) cityEl.innerHTML = cities.map(c => chip(c, c)).join('') || loadingMsg;
  if (peopleEl) peopleEl.innerHTML = people.map(p => personChip(p)).join('') || loadingMsg;

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
  return {
    model: chips.find(c => cameraSet.has(c)),
    lensModel: chips.find(c => lensSet.has(c)),
    city: chips.find(c => citySet.has(c))
  };
}

function setRecentChip(val) {
  if (state.recentActiveChips.has(val)) {
    state.recentActiveChips.delete(val);
  } else {
    state.recentActiveChips.add(val);
  }
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
    if (p) parts.push('👤 ' + p.name);
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
  state.recentActivePerson = null;
  state.recentActiveChips = new Set();
  state.recentSmartResults = [];
  updateRecentFilterChips();
  updateActiveChipLabel();
  applyRecentFilters();
}

function renderRecentGrid(items) {
  state.displayedItems = items; // track what's currently shown for navigation
  const grid = document.getElementById('recent-grid');
  if (!items.length) { grid.innerHTML = '<div class="loading">No recent uploads.</div>'; return; }
  const renderItem = a => `
    <div class="gallery-item ${state.selectMode ? 'selectable' : ''} ${state.selectedAssets && state.selectedAssets.has(a.id) ? 'selected' : ''}"
         id="sel-${a.id}"
         data-action="recentItemClick" data-id="${a.id}">
      <img src="/api/immich/thumb/${a.id}" alt="${a.originalFileName}" loading="lazy" onerror="this.style.background='#1a1a1a'">
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

async function renderRecentDetail(assetId) {
  const content = document.getElementById('recent-detail-content');
  content.innerHTML = '<div class="loading">Loading...</div>';

  let meta = {};
  try { const r = await fetch(`/api/immich/photo/${assetId}`); meta = await r.json(); } catch(e) {}

  // Lazy-load Darkroom albums so the "In albums" row works even when the
  // user opened Recent first and never visited the Albums tab.
  if (!Array.isArray(state.albums)) {
    try {
      const r = await fetch('/api/albums');
      const data = await r.json();
      if (Array.isArray(data)) state.albums = data;
    } catch (e) { /* leave for other loaders */ }
  }
  const assetAlbums = (state.albums || []).filter(a => (a.assets || []).includes(assetId));

  const idx = state.currentRecentIndex;
  const displayedItems = state.displayedItems || state.recentItems;
  const total = displayedItems.length;
  const hasPrev = idx > 0;
  const hasNext = idx < total - 1;

  // Format date
  const takenDate = meta.takenAt ? new Date(meta.takenAt).toLocaleDateString('en-US', {weekday:'short', year:'numeric', month:'short', day:'numeric'}) : '';
  const takenTime = meta.takenAt ? new Date(meta.takenAt).toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit'}) : '';

  // Map
  const hasGPS = meta.latitude && meta.longitude;
  const mapUrl = hasGPS ? `https://www.openstreetmap.org/export/embed.html?bbox=${meta.longitude-0.01},${meta.latitude-0.01},${meta.longitude+0.01},${meta.latitude+0.01}&layer=mapnik&marker=${meta.latitude},${meta.longitude}` : '';
  const immichLocation = [meta.city, meta.state].filter(Boolean).join(', ');

  content.innerHTML = `
    <div class="detail-layout">
      <div class="detail-left">
        <div style="position:relative;width:100%;height:100%;display:flex;align-items:flex-start;justify-content:center">
          <img class="detail-image"
               src="/api/immich/thumb/${assetId}?size=preview"
               data-full="/api/immich/original/${assetId}"
               alt="${meta.filename || ''}"
               data-action="openFullscreen" data-url="/api/immich/original/${assetId}"
               style="cursor:zoom-in"
               onload="scheduleDetailUpgrade(this)">
          <div data-action="navPrev" style="position:absolute;left:0;top:0;width:25%;height:100%;cursor:pointer;z-index:10"></div>
          <div data-action="navNext" style="position:absolute;right:0;top:0;width:25%;height:100%;cursor:pointer;z-index:10"></div>
        </div>
      </div>
      <div class="detail-right">
        <div style="padding:0.5rem 1rem;display:flex;flex-direction:column;gap:0.4rem;border-bottom:1px solid var(--border)">
          <div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap">
            ${hasPrev ? `<button class="nav-arrow" data-action="navPrev">‹</button>` : `<div style="width:28px"></div>`}
            ${hasNext ? `<button class="nav-arrow" data-action="navNext">›</button>` : ''}
            <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text-dim);margin-right:0.25rem">${idx+1} / ${total}</div>
            <button class="btn btn-ghost btn-sm" data-action="openAddToAlbumModal" data-id="${assetId}">+ Album</button>
            ${state.viewingFromAlbum ? `<button class="btn btn-ghost btn-sm" data-action="removeFromAlbum" data-id="${assetId}">− Remove</button>` : ''}
            ${state.previousView === 'immich-album-view' && !state.viewingArchived && !state.viewingTrash ? `<button class="btn btn-ghost btn-sm" data-action="removeFromImmichAlbumDetail" data-id="${assetId}">− Remove</button>` : ''}
            <button class="btn btn-ghost btn-sm" data-action="downloadRecent" data-id="${assetId}" data-filename="${meta.filename}">↓ DL</button>
          </div>
          <div style="display:flex;gap:0.4rem">
            ${state.viewingTrash ? `
              <button class="btn btn-ghost btn-sm" data-action="restoreFromTrashDetail" data-id="${assetId}">Restore</button>
              <button class="btn btn-danger btn-sm" data-action="permanentDeleteDetail" data-id="${assetId}" data-filename="${meta.filename}">🗑 Delete Forever</button>
            ` : `
              <button class="btn btn-ghost btn-sm" data-action="shareRecent" data-id="${assetId}" data-filename="${meta.filename}" data-desc="${(meta.description||'').replace(/'/g, '&apos;')}">↑ Share</button>
              <button class="${meta.isArchived ? 'btn btn-ghost btn-sm' : 'btn btn-danger btn-sm'}" data-action="${meta.isArchived ? 'restoreFromDetail' : 'archiveFromDetail'}" data-id="${assetId}">${meta.isArchived ? 'Restore' : 'Archive'}</button>
              <button class="btn btn-danger btn-sm" data-action="deleteImmichAsset" data-id="${assetId}" data-filename="${meta.filename}">🗑</button>
            `}
          </div>
        </div>
        <div class="detail-meta">
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
          </div>
        </div>
      </div>
    </div>
  `;
}

async function shareRecent(assetId, filename, description) {
  try {
    const imgRes = await fetch('/api/immich/original/' + assetId);
    const blob = await imgRes.blob();
    const fname = filename || assetId + '.jpg';
    const file = new File([blob], fname, { type: 'image/jpeg' });
    const shareData = { files: [file] };
    if (description) shareData.text = description;
    if (navigator.share && navigator.canShare(shareData)) {
      await navigator.share(shareData);
    } else {
      alert('Sharing not supported in this browser');
    }
  } catch(e) {
    if (e.name !== 'AbortError') alert('Share failed: ' + e.message);
  }
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
  // Remove from local state and navigate back or to next photo
  if (state.displayedItems) state.displayedItems = state.displayedItems.filter(a => a.id !== assetId);
  if (state.recentItems) state.recentItems = state.recentItems.filter(a => a.id !== assetId);
  delete state.recentMeta[assetId];
  if (state.displayedItems && state.displayedItems.length > 0) {
    const nextIdx = Math.min(state.currentRecentIndex, state.displayedItems.length - 1);
    await showRecentDetail(state.displayedItems[nextIdx].id);
  } else {
    goBackFromDetail();
  }
}

async function downloadRecent(assetId, filename) {
  const fname = filename || assetId + '.jpg';
  const r = await fetch('/api/immich/original/' + assetId);
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
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
function scheduleDetailUpgrade(img) {
  if (_detailUpgradeTimer) { clearTimeout(_detailUpgradeTimer); _detailUpgradeTimer = null; }
  if (_detailUpgradeLoader) { _detailUpgradeLoader.onload = null; _detailUpgradeLoader.src = ''; _detailUpgradeLoader = null; }
  const full = img.dataset.full;
  if (!full) return;
  _detailUpgradeTimer = setTimeout(() => {
    _detailUpgradeLoader = new Image();
    _detailUpgradeLoader.onload = () => {
      if (!document.body.contains(img)) return;
      if (img.dataset.full !== full) return; // user navigated; stale upgrade
      img.src = full;
      delete img.dataset.full;
      _detailUpgradeLoader = null;
    };
    _detailUpgradeLoader.src = full;
  }, 400);
}

function navigatePrint(dir) {
  const prints = state.displayedPrints || state.prints;
  const idx = prints.findIndex(p => p.id === state.currentPrintId);
  if (idx === -1) return;
  const next = prints[idx + dir];
  if (!next) return;
  if (state.fullscreenOpen) {
    document.getElementById('fullscreen-img').src = '/api/immich/original/' + next.immichId;
  }
  showDetail(next.id);
}

async function navigateRecent(dir) {
  const displayedItems = state.displayedItems || state.recentItems;
  const newIdx = state.currentRecentIndex + dir;
  if (newIdx < 0 || newIdx >= displayedItems.length) return;
  state.currentRecentIndex = newIdx;
  state.currentRecentId = displayedItems[newIdx].id;
  if (state.fullscreenOpen) {
    document.getElementById('fullscreen-img').src = '/api/immich/original/' + state.currentRecentId;
  }
  await renderRecentDetail(state.currentRecentId);
}

// Fullscreen pinch-zoom state (the overlay opened by tapping the print/library detail image)
let _fsZoom = { scale: 1, tx: 0, ty: 0 };
function _fsIsZoomed() { return _fsZoom.scale > 1.001; }
function _fsApplyZoom() {
  const img = document.getElementById('fullscreen-img');
  if (!img) return;
  if (_fsIsZoomed()) {
    img.style.transform = `translate(${_fsZoom.tx}px,${_fsZoom.ty}px) scale(${_fsZoom.scale})`;
  } else {
    img.style.transform = '';
  }
}
function _fsResetZoom() {
  _fsZoom = { scale: 1, tx: 0, ty: 0 };
  _fsApplyZoom();
}

function openFullscreen(src) {
  _fsResetZoom();
  document.getElementById('fullscreen-img').src = src;
  document.getElementById('fullscreen-overlay').classList.add('active');
  state.fullscreenOpen = true;
}

function closeFullscreen() {
  _fsResetZoom();
  document.getElementById('fullscreen-overlay').classList.remove('active');
  state.fullscreenOpen = false;
}

function fullscreenNavigate(dir) {
  _fsResetZoom();
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
  } else if (inPrintDetail && Math.abs(dx) > 50 && Math.abs(dy) < 50) {
    dx < 0 ? navigatePrint(1) : navigatePrint(-1);
  } else if (inRecent && dy > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) {
    goBackFromDetail();
  } else if (inRecent && Math.abs(dx) > 50 && Math.abs(dy) < 50) {
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

function renderAlbumsGrid() {
  const grid = document.getElementById('albums-grid');
  if (!state.albums.length) {
    grid.innerHTML = '<div class="album-empty" style="grid-column:1/-1">No albums yet.<br>Tap + Album to create one.</div>';
    return;
  }
  grid.innerHTML = state.albums.map(a => `
    <div class="album-item" data-action="openAlbum" data-id="${a.id}">
      ${a.assets.length ? `<img src="/api/immich/thumb/${a.assets[0]}" loading="lazy" onerror="this.style.background='#1a1a1a'">` : '<div class="album-item-empty" style="width:100%;height:100%"></div>'}
      <div class="album-item-info">
        <div class="album-item-title">${a.title}</div>
        <div class="album-item-count">${a.assets.length} photo${a.assets.length !== 1 ? 's' : ''}</div>
      </div>
    </div>
  `).join('');
}

function openAlbum(albumId) {
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
      <img src="/api/immich/thumb/${assetId}" loading="lazy" onerror="this.style.background='#1a1a1a'" style="cursor:pointer">
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
  state.recentItems = album.assets.map(id => ({ id, originalFileName: '', createdAt: '' }));
  state.displayedItems = state.recentItems;
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
  try {
    const r = await fetch('/api/immich/assets/archive', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    if (!r.ok) throw new Error('Failed');
    state.currentImmichAlbumAssets = state.currentImmichAlbumAssets.filter(a => !ids.includes(a.id));
    applyImmichFiltersAndSort();
    if (state.immichSelectMode) exitImmichSelectMode();
    if (document.getElementById('recent-detail-view').classList.contains('active')) goBackFromDetail();
  } catch(e) { alert('Archive failed.'); }
}

async function restoreImmichAssets(assetIds) {
  const ids = Array.isArray(assetIds) ? assetIds : [assetIds];
  const count = ids.length;
  if (!confirm(`Restore ${count} photo${count !== 1 ? 's' : ''} from archive?\n\nThey will reappear in the main Immich library.`)) return;
  try {
    const r = await fetch('/api/immich/assets/restore', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    if (!r.ok) throw new Error('Failed');
    // Update isArchived flag in local state rather than removing from view
    state.currentImmichAlbumAssets = state.currentImmichAlbumAssets.map(a =>
      ids.includes(a.id) ? { ...a, isArchived: false } : a
    );
    applyImmichFiltersAndSort();
    if (state.immichSelectMode) exitImmichSelectMode();
    if (document.getElementById('recent-detail-view').classList.contains('active')) {
      await renderRecentDetail(state.currentRecentId);
    }
  } catch(e) { alert('Restore failed.'); }
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
  const newAssets = [...album.assets];
  toAdd.forEach(id => { if (!newAssets.includes(id)) newAssets.push(id); });
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
}

async function quickCreateAndAdd() {
  const title = document.getElementById('quick-album-name').value.trim();
  if (!title) return;
  try {
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

// ── SLIDESHOW ─────────────────────────────────────────────────────────────────

function startSlideshow() {
  openAlbumSlideshow(0);
}

async function openAlbumSlideshow(startIdx) {
  const album = state.currentAlbum;
  if (!album || !album.assets.length) return;
  state.slideshow = { active: true, index: startIdx, timer: null, paused: false };
  ssActiveSlot = 'a';
  ssDescVisible = true;
  document.getElementById('slideshow-slide-a').innerHTML = '';
  document.getElementById('slideshow-slide-b').innerHTML = '';
  document.getElementById('slideshow-overlay').classList.add('active');
  // Start music
  startSlideshowMusic(album.slideshowSettings || {});
  // Show title card first if enabled, otherwise go straight to first slide
  await showTitleCard(album);
  showSlide(startIdx);
  scheduleNext();
  showSlideshowControls();
}

// ── SLIDESHOW SETTINGS ──────────────────────────────────────────────────────

function openSlideshowSettings() {
  const album = state.currentAlbum;
  if (!album || !album.assets.length) return;
  const settings = album.slideshowSettings || {};
  // Restore saved settings
  ssSetToggle('ss-show-title', settings.showTitle || false);
  document.getElementById('ss-byline').value = settings.byline || 'JJ Lakatua';
  ssSetToggle('ss-show-location', settings.showLocation || false);
  ssSetToggle('ss-show-dates', settings.showDates || false);
  ssSetToggle('ss-show-count', settings.showCount || false);
  toggleSSTitleOptions();
  loadMusicList(settings.musicFile || null);
  document.getElementById('slideshow-settings-modal').classList.add('active');
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
  const settings = {
    showTitle: ssToggleVal('ss-show-title'),
    byline: document.getElementById('ss-byline').value.trim(),
    showLocation: ssToggleVal('ss-show-location'),
    showDates: ssToggleVal('ss-show-dates'),
    showCount: ssToggleVal('ss-show-count'),
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
  closeModal('slideshow-settings-modal');
  openAlbumSlideshow(0);
}

async function showTitleCard(album) {
  const settings = album.slideshowSettings || {};
  if (!settings.showTitle) return;
  const card = document.getElementById('ss-title-card');
  const content = document.getElementById('ss-title-card-content');
  let html = `<div class="ss-title-main">${album.title}</div>`;
  html += `<div style="width:60px;height:1px;background:var(--safe);margin:1.5rem auto"></div>`;
  if (settings.byline) html += `<div class="ss-title-sub">Photography by ${settings.byline}</div>`;
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

let ssAudio = null;
let ssMusicFade = null;
function startSlideshowMusic(settings) {
  if (ssMusicFade) { clearInterval(ssMusicFade); ssMusicFade = null; }
  if (ssAudio) { ssAudio.pause(); ssAudio = null; }
  if (!settings.musicFile) return;
  ssAudio = new Audio('/api/albums/music/' + encodeURIComponent(settings.musicFile));
  ssAudio.loop = true;
  ssAudio.volume = 0;
  ssAudio.play().catch(() => {});
  const targetAudio = ssAudio;
  let vol = 0;
  ssMusicFade = setInterval(() => {
    if (ssAudio !== targetAudio) { clearInterval(ssMusicFade); ssMusicFade = null; return; }
    vol = Math.min(vol + 0.05, 0.8);
    ssAudio.volume = vol;
    if (vol >= 0.8) { clearInterval(ssMusicFade); ssMusicFade = null; }
  }, 100);
}

function stopSlideshowMusic() {
  if (ssMusicFade) { clearInterval(ssMusicFade); ssMusicFade = null; }
  if (!ssAudio) return;
  const targetAudio = ssAudio;
  let vol = ssAudio.volume;
  ssMusicFade = setInterval(() => {
    if (ssAudio !== targetAudio) { clearInterval(ssMusicFade); ssMusicFade = null; return; }
    vol = Math.max(vol - 0.05, 0);
    ssAudio.volume = vol;
    if (vol <= 0) { clearInterval(ssMusicFade); ssMusicFade = null; ssAudio.pause(); ssAudio = null; }
  }, 80);
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

function cancelSlideCleanup() {
  ssCleanupTimers.forEach(t => clearTimeout(t));
  ssCleanupTimers = [];
  // Hide the inactive slot cleanly without touching the visible one
  const inactiveSlot = ssActiveSlot === 'a' ? 'b' : 'a';
  const inactiveEl = document.getElementById('slideshow-slide-' + inactiveSlot);
  if (inactiveEl) { inactiveEl.classList.remove('ss-visible'); inactiveEl.style.zIndex = 1; }
}

function showSlide(idx) {
  const album = state.currentAlbum;
  const counter = document.getElementById('slideshow-counter');
  counter.textContent = (idx + 1) + ' / ' + album.assets.length;
  state.slideshow.index = idx;

  // Show description
  const descEl = document.getElementById('slideshow-description');
  const assetId = album.assets[idx];
  if (descEl) {
    if (state.recentMeta[assetId]?.description) {
      descEl.textContent = state.recentMeta[assetId].description;
    } else {
      descEl.textContent = '';
      fetch('/api/immich/photo/' + assetId).then(r => r.json()).then(m => {
        if (!state.recentMeta[assetId]) state.recentMeta[assetId] = {};
        state.recentMeta[assetId].description = m.description || '';
        if (state.slideshow.index === idx && descEl) descEl.textContent = m.description || '';
      }).catch(() => {});
    }
  }

  const move = KB_MOVES[idx % KB_MOVES.length];
  const nextSlot = ssActiveSlot === 'a' ? 'b' : 'a';
  const currentEl = document.getElementById('slideshow-slide-' + ssActiveSlot);
  const nextEl = document.getElementById('slideshow-slide-' + nextSlot);
  const url = '/api/immich/original/' + album.assets[idx];
  const thumbUrl = '/api/immich/thumb/' + album.assets[idx];

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
    const t1 = setTimeout(() => { currentEl.classList.remove('ss-visible'); }, 1500);
    const t2 = setTimeout(() => {
      currentEl.style.zIndex = 1;
      ssActiveSlot = nextSlot;
      ssCleanupTimers = ssCleanupTimers.filter(t => t !== t1 && t !== t2);
    }, 3500);
    ssCleanupTimers.push(t1, t2);
  };

  if (img.complete && img.naturalWidth > 0) { show(); }
  else { img.onload = show; img.onerror = show; }

  // Preload next image
  const preloadIdx = (idx + 1) % album.assets.length;
  const pre = new Image();
  pre.src = '/api/immich/original/' + album.assets[preloadIdx];
}

let ssHideTimer = null;
let ssDescVisible = true;

function toggleSlideshowMusic() {
  const btn = document.getElementById('slideshow-music-btn');
  if (ssAudio) {
    if (ssAudio.paused) {
      ssAudio.play();
      if (btn) btn.style.color = '';
    } else {
      ssAudio.pause();
      if (btn) btn.style.color = 'var(--text-dim)';
    }
  }
}

function toggleSlideshowDesc() {
  ssDescVisible = !ssDescVisible;
  const descEl = document.getElementById('slideshow-description');
  const btn = document.getElementById('slideshow-desc-btn');
  if (descEl) descEl.style.opacity = ssDescVisible ? '1' : '0';
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

function scheduleNext() {
  if (state.slideshow.timer) clearTimeout(state.slideshow.timer);
  if (!state.slideshow.paused) {
    state.slideshow.timer = setTimeout(() => {
      slideshowNext();
    }, 7000);
  }
}

function slideshowNext() {
  const album = state.currentAlbum;
  const nextIdx = (state.slideshow.index + 1) % album.assets.length;
  if (state.slideshow.timer) clearTimeout(state.slideshow.timer);
  cancelSlideCleanup();
  showSlide(nextIdx);
  scheduleNext();
}

function slideshowPrev() {
  const album = state.currentAlbum;
  const prevIdx = (state.slideshow.index - 1 + album.assets.length) % album.assets.length;
  if (state.slideshow.timer) clearTimeout(state.slideshow.timer);
  cancelSlideCleanup();
  showSlide(prevIdx);
  scheduleNext();
}

function toggleSlideshow() {
  state.slideshow.paused = !state.slideshow.paused;
  document.getElementById('slideshow-pause-btn').textContent = state.slideshow.paused ? '▶' : '❚❚';
  if (!state.slideshow.paused) {
    if (!ssAudio) startSlideshowMusic(state.currentAlbum?.slideshowSettings || {});
    else ssAudio.play().catch(() => {});
    showSlide(state.slideshow.index);
    scheduleNext();
  } else {
    if (state.slideshow.timer) clearTimeout(state.slideshow.timer);
    if (ssAudio) ssAudio.pause();
  }
}

function closeSlideshow() {
  if (state.slideshow.timer) clearTimeout(state.slideshow.timer);
  cancelSlideCleanup();
  state.slideshow = { active: false, index: 0, timer: null, paused: false };
  document.getElementById('slideshow-overlay').classList.remove('active');
  const card = document.getElementById('ss-title-card');
  if (card) { card.style.opacity = '0'; card.style.display = 'none'; }
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
  if (!document.hidden && !state.slideshow.active && ssAudio) {
    ssAudio.pause();
    ssAudio = null;
  }
});

// ── SELECTION MODE ──────────────────────────────────────────────────────────
function toggleSelectMode() {
  state.selectMode ? exitSelectMode() : enterSelectMode();
}

function enterSelectMode() {
  state.selectMode = true;
  state.selectedAssets = new Set();
  document.getElementById('select-mode-btn').style.display = 'none';
  document.getElementById('select-actions').style.display = 'flex';
  const items = state.recentSmartResults && state.recentSmartResults.length ? state.recentSmartResults : state.recentItems;
  renderRecentGrid(items);
}

function exitSelectMode() {
  state.selectMode = false;
  state.selectedAssets = new Set();
  document.getElementById('select-mode-btn').style.display = 'inline-block';
  document.getElementById('select-actions').style.display = 'none';
  const items = state.recentSmartResults && state.recentSmartResults.length ? state.recentSmartResults : state.recentItems;
  renderRecentGrid(items);
}

function toggleAssetSelect(assetId) {
  if (state.selectedAssets.has(assetId)) {
    state.selectedAssets.delete(assetId);
  } else {
    state.selectedAssets.add(assetId);
  }
  document.getElementById('select-count').textContent = state.selectedAssets.size + ' selected';
  // Update checkmark on thumbnail
  const el = document.getElementById('sel-' + assetId);
  if (el) el.classList.toggle('selected', state.selectedAssets.has(assetId));
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
      <img src="/api/immich/thumb/${p.immichId}" alt="${p.title}" loading="lazy" onerror="this.style.background='#1a1a1a'">
      <div class="gallery-item-info">
        <div class="gallery-item-title">${p.title}</div>
        <div class="gallery-item-count">${p.sessions?.length || 0} session${(p.sessions?.length || 0) !== 1 ? 's' : ''}</div>
      </div>
    </div>
  `).join('');
}

async function showDetail(printId) {
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
  content.innerHTML = '<div class="loading">Loading...</div>';

  let meta = {};
  try { const r = await fetch(`/api/immich/photo/${print.immichId}`); meta = await r.json(); } catch(e) {}

  const sessions = (print.sessions || []).slice().sort((a, b) => Number(b.id) - Number(a.id));
  // Lazy-load Darkroom albums if the user opened a print detail before ever
  // visiting the Albums tab — without this, state.albums is undefined here
  // and the "In albums" row stays empty even for prints that ARE in albums.
  // IMPORTANT: do NOT set state.albums = [] on failure. That trampled a
  // load-in-progress on a separate code path (the Recent view's "+ Album"
  // modal) and made it render "No albums yet" forever.
  if (!Array.isArray(state.albums)) {
    try {
      const r = await fetch('/api/albums');
      const data = await r.json();
      if (Array.isArray(data)) state.albums = data;
    } catch (e) { /* leave state.albums to other loaders */ }
  }
  // Albums this print belongs to — looked up by Immich asset ID against the
  // already-loaded state.albums.
  const printAlbums = (state.albums || []).filter(a => (a.assets || []).includes(print.immichId));
  content.innerHTML = `
    <div class="detail-layout">
      <div class="detail-left">
        <div style="position:relative;width:100%;height:100%;display:flex;align-items:flex-start;justify-content:center">
          <img class="detail-image" src="/api/immich/original/${print.immichId}" alt="${print.title}" data-action="openFullscreen" data-url="/api/immich/original/${print.immichId}" style="cursor:zoom-in;touch-action:manipulation">
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
    el.innerHTML = '<div class="search-results">' + items.map(i => `<div class="search-result-item" data-action="selectImmich" data-item='${JSON.stringify(i).replace(/'/g, "&#39;")}'>${i.filename}</div>`).join('') + '</div>';
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
    const thumb = album.albumThumbnailAssetId ? `/api/immich/thumb/${album.albumThumbnailAssetId}` : '';
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
      <img src="/api/immich/thumb/${a.id}" loading="lazy" style="width:100%;height:100%;object-fit:cover">
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
        ? `<img src="/api/immich/thumb/${album.albumThumbnailAssetId}" style="width:40px;height:40px;object-fit:cover;border-radius:3px;flex-shrink:0">`
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
  w('recent-search', 'input', (e) => handleRecentSearch(e.target.value));
  w('search-mode-text', 'click', () => setSearchMode('text'));
  w('search-mode-smart', 'click', () => setSearchMode('smart'));
  w('select-mode-btn', 'click', () => toggleSelectMode());
  w('btn-add-selection-album', 'click', () => addSelectionToAlbum());
  w('btn-download-selection', 'click', () => downloadSelectedAssets());
  w('btn-exit-select', 'click', () => exitSelectMode());
  w('lib-sort-upload', 'click', () => setLibrarySort('upload'));
  w('lib-sort-taken', 'click', () => setLibrarySort('taken'));
  w('lib-sort-dir', 'click', () => toggleLibrarySortDir());
  w('filters-btn', 'click', () => toggleFiltersPopup());
  w('filters-done-btn', 'click', () => toggleFiltersPopup());
  w('btn-clear-chips', 'click', () => { clearRecentChip(); toggleFiltersPopup(); });

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
  w('btn-ss-modal-close', 'click', () => closeModal('slideshow-settings-modal'));
  w('btn-ss-modal-cancel', 'click', () => closeModal('slideshow-settings-modal'));
  w('toggle-show-title', 'click', () => { ssToggle('ss-show-title'); toggleSSTitleOptions(); });
  w('toggle-show-location', 'click', () => ssToggle('ss-show-location'));
  w('toggle-show-dates', 'click', () => ssToggle('ss-show-dates'));
  w('toggle-show-count', 'click', () => ssToggle('ss-show-count'));
  w('btn-ss-start', 'click', () => saveSlideshowSettingsAndStart());

  // Modals
  w('btn-close-create-album', 'click', () => closeModal('create-album-modal'));
  w('btn-create-album-confirm', 'click', () => createAlbum());
  w('btn-close-add-album', 'click', () => closeModal('add-to-album-modal'));
  w('btn-quick-create-add', 'click', () => quickCreateAndAdd());
  w('btn-quick-create-immich', 'click', () => quickCreateAndAddImmich());
  // Fullscreen: tap zones (left 25% prev / right 25% next / center close) + swipe-nav when not zoomed,
  // 2-finger pinch-zoom (1×–5×), 1-finger pan when zoomed, double-tap to toggle 1×/2.5×.
  let _fsSwipeX = null, _fsSwipeY = null, _fsDidSwipe = false;
  let _fsPinch = null, _fsPan = null, _fsLastTap = 0;
  const _fsEl = document.getElementById('fullscreen-overlay');
  const _fsDist = (t1, t2) => Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  _fsEl.addEventListener('touchstart', e => {
    _fsDidSwipe = false;
    if (e.touches.length >= 2) {
      _fsPinch = { d: _fsDist(e.touches[0], e.touches[1]), s: _fsZoom.scale, tx: _fsZoom.tx, ty: _fsZoom.ty };
      _fsSwipeX = _fsSwipeY = null;
      _fsPan = null;
    } else if (e.touches.length === 1) {
      if (_fsIsZoomed()) {
        _fsPan = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx: _fsZoom.tx, ty: _fsZoom.ty };
        _fsSwipeX = _fsSwipeY = null;
      } else {
        _fsSwipeX = e.touches[0].clientX;
        _fsSwipeY = e.touches[0].clientY;
      }
    }
  }, {passive: true});
  _fsEl.addEventListener('touchmove', e => {
    if (_fsPinch && e.touches.length >= 2) {
      const d = _fsDist(e.touches[0], e.touches[1]);
      let s = _fsPinch.s * (d / _fsPinch.d);
      s = Math.max(1, Math.min(5, s));
      _fsZoom.scale = s;
      if (s <= 1.001) { _fsZoom.tx = 0; _fsZoom.ty = 0; }
      _fsApplyZoom();
      e.preventDefault();
    } else if (_fsPan && e.touches.length === 1 && _fsIsZoomed()) {
      _fsZoom.tx = _fsPan.tx + (e.touches[0].clientX - _fsPan.x);
      _fsZoom.ty = _fsPan.ty + (e.touches[0].clientY - _fsPan.y);
      _fsApplyZoom();
      e.preventDefault();
    }
  }, {passive: false});
  _fsEl.addEventListener('touchend', e => {
    if (_fsPinch && e.touches.length < 2) {
      _fsPinch = null;
      if (_fsZoom.scale <= 1.001) _fsResetZoom();
      _fsDidSwipe = true; // suppress the synthetic click after pinch
    }
    if (_fsPan && e.touches.length === 0) { _fsPan = null; _fsDidSwipe = true; }
    // 1-finger swipe nav / close — only when not zoomed and we tracked a swipe start
    if (_fsSwipeX !== null && !_fsIsZoomed()) {
      const dx = e.changedTouches[0].clientX - _fsSwipeX;
      const dy = e.changedTouches[0].clientY - _fsSwipeY;
      if (Math.abs(dx) > 40 && Math.abs(dy) < 60) {
        _fsDidSwipe = true;
        dx < 0 ? fullscreenNavigate(1) : fullscreenNavigate(-1);
      } else if (dy > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) {
        _fsDidSwipe = true;
        closeFullscreen();
      }
    }
    _fsSwipeX = _fsSwipeY = null;
    // Double-tap toggle (only on a clean single-touch end, no pinch/pan in flight)
    if (e.changedTouches.length === 1 && e.touches.length === 0 && !_fsPinch && !_fsPan) {
      const now = Date.now();
      if (now - _fsLastTap < 320) {
        if (_fsIsZoomed()) _fsResetZoom();
        else { _fsZoom = { scale: 2.5, tx: 0, ty: 0 }; _fsApplyZoom(); }
        _fsDidSwipe = true; // suppress click that would otherwise navigate/close
        _fsLastTap = 0;
      } else {
        _fsLastTap = now;
      }
    }
  }, {passive: true});
  w('fullscreen-overlay', 'click', e => {
    if (_fsDidSwipe) { _fsDidSwipe = false; return; }
    if (_fsIsZoomed()) return; // taps while zoomed do nothing — avoid surprise close/navigate
    const xPos = e.clientX;
    const vw = window.innerWidth;
    if (xPos < vw * 0.25) { fullscreenNavigate(-1); }
    else if (xPos > vw * 0.75) { fullscreenNavigate(1); }
    else { closeFullscreen(); }
  });
  // Desktop: ctrl/cmd + wheel to zoom (matches browser image-zoom convention)
  _fsEl.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    _fsZoom.scale = Math.max(1, Math.min(5, _fsZoom.scale * factor));
    if (_fsZoom.scale <= 1.001) _fsResetZoom();
    else _fsApplyZoom();
  }, { passive: false });
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
    case 'setRecentChip': setRecentChip(val); break;
    case 'searchByPerson': searchByPerson(id, el.dataset.name); break;
    case 'clearRecentSearch': clearRecentSearch(); break;

    // Library
    case 'recentItemClick':
      if (state.selectMode) toggleAssetSelect(id);
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
case 'downloadRecent': downloadRecent(id, el.dataset.filename); break;
    case 'deleteImmichAsset': deleteImmichAsset(id, el.dataset.filename); break;
    case 'shareRecent': shareRecent(id, el.dataset.filename, el.dataset.desc); break;

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
