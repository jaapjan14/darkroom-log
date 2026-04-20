# Changelog

## v1.4.2 (2026-04-19)

### Bug Fixes
- **Library filter chips now selectable** — `loadRecentMetaBatch` was calling `updateRecentFilterChips()` on every photo fetch, destroying and recreating chip buttons so rapidly that click events were dropped. Removed the spurious call; filter options are populated by `fetchFilterOptions()` only.
- **Service worker regex fix** — SW regex `/\/(app|album)\.js$/` didn't match paths with query strings (`?v=N`), causing `app.js` to be served cache-first and deliver stale code. Fixed by removing `$` anchor; combined with `?v` cache-busting on `index.html`.
- **outsideClick switched to `mousedown`** — filter popup outside-click listener now fires before any chip re-render can detach `e.target`.
- **Search result size bumped 60 → 250** — combined, text, smart, and person search all return up to 250 results before "Load More".
- **Library page size 50 → 500** — "Load More" only appears after 500 photos per page.
- **Filter popup listener leak** — each open added a new `mousedown` listener without removing the previous one; now tracked via `_outsideClickHandler` and removed before re-adding.
- **Shift-click selection bleeds between albums** — `lastSelectedIdx` now reset on `openAlbum()`.
- **Immich/album select state not cleared on tab switch** — `switchTab()` resets `albumSelectMode`, `albumSelected`, `lastSelectedIdx`, and calls `exitImmichSelectMode()`.
- **Immich select state persists across album opens** — `immichSelected` and `immichSelectMode` now reset at top of `openImmichAlbum()`.
- **Print titles with apostrophes break cancel** — `data-title` attribute encoded with `encodeURIComponent` on write, decoded on read.
- **Print arrow navigation follows grid sort order** — arrows now navigate `state.displayedPrints` (filtered/sorted) instead of raw `state.prints`.
- **Slideshow music fade interval orphaned on rapid open/close** — replaced local var with `ssMusicFade` module variable; interval self-cancels if audio object is replaced.
- **quickCreateAndAdd crash on server error** — added try/catch with user-facing alert if album creation fails before `addToAlbum` is called.
- **Search mode switch leaks chip filters** — switching between Smart and Text search now clears active chips, person filter, and smart results.
- **Duplicate HTML id attributes** — cleaned up redundant `id` attributes on sort buttons and slideshow controls; removed spurious `id="btn-slideshow"` from embed-hero div in `album.html`.

### Service Worker
- Cache bumped to `darkroom-v24`

---

## v1.4.1 (2026-04-19)

### Architecture
- **Container-per-tab** — `body { overflow: hidden }`, each `.view.active` is `position: fixed; top: 92px; overflow-y: auto`. All tabs preserve scroll position while a photo detail is open — the grid stays mounted underneath.

### Prints Tab
- Print detail is now a `position: fixed` overlay (`z-index: 50`) — gallery grid stays active underneath, matching Library/Albums/Immich behavior
- **Swipe down** → dismiss with fade (no inertia bleed-through via 230ms fade-out)
- **Left/right swipe** → navigate prev/next print
- **Tap left 25% / right 25%** edge zones → navigate prev/next print
- **Arrow keys** → navigate prev/next print
- **Tap image** → fullscreen
- Fixed gallery grid bleeding through detail overlay
- Fixed image vertical alignment (top-aligned)

### Bug Fixes
- **Sessions sort (newest first)** — moved sort to server-side in `/api/prints` endpoint; client-side sort was unreliable due to service worker caching

### Service Worker
- Cache bumped to `darkroom-v8`

---

## v1.4 (2026-04-18)

### New Features
- **Immich Albums tab** — browse Immich albums as a grid; tap to open an album, sort/filter photos within it, use select mode, add to Darkroom albums
- **Immich photo detail** — tap any photo in an Immich album to open full detail (metadata, EXIF, map, fullscreen, download, share, delete)
- **Filter/chip bar in Immich** — filter by camera, lens, or location within an album

### Navigation Architecture
- `recent-detail-view` is now a `position: fixed` overlay (`z-index: 50`, below sticky header at `z-index: 100`)
- Underlying grid stays active and keeps scroll position while a photo is open — no scroll-restoration code needed
- Eliminated the "flash to top" bug across Library, Albums, and Immich tabs

### Gestures
- **Swipe down** in photo detail → back to grid
- **Left/right swipe** → prev/next photo (Library, Albums, Immich)
- **Tap left 25% / right 25%** → prev/next photo (invisible hit zones)
- **ESC / trackpad scroll up** → back
- Back button present on all tabs (Prints, Library, Albums, Immich)

### Service Worker
- Cache bumped to `darkroom-v7`
- Network-first for `app.js` and `album.js` to ensure JS updates always load fresh

---

## v1.3.0 (2026-04-16)

### Features
- **Library tab** — browse full Immich library with sort, text/smart search, filter chips (camera, lens, location, people)
- **Albums** — full grid view, select mode with shift-click range selection, download originals with original filenames
- **Photo detail from album** — click any photo to open detail view, back returns to album
- **Public album page** — shareable `/album/:slug` with Ken Burns slideshow, music, title cards
- **Squarespace embed** — cinematic hero banner embed via `?embed` param
- **Slideshow settings** — title card, byline, photo count, music selection, description toggle
- **Fullscreen button** in slideshow

### Security
- External JS (`app.js`, `album.js`) — zero inline scripts in HTML
- CSP `unsafe-inline` removed from `script-src` — A+ score 115/100, 10/10 tests
- Comprehensive event delegation replacing all dynamic `onclick=` handlers
- Login rate limiting: 10 attempts per 15 minutes per IP
- HSTS, Referrer-Policy, X-Frame-Options, Permissions-Policy headers

## v1.1.0 (2026-04-13)

### Features
- Initial public release
- Darkroom print logging with session tracking
- Immich photo integration
- Split-grade and single-grade workflow
- Tag filtering
- Album creation and management
- Basic slideshow
