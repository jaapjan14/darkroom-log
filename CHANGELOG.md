# Changelog

## v1.5.12 (2026-04-23)

### UI
- **Library detail view: sharp on retina without blocking first paint.** After v1.5.10 swapped the initial detail-view src to the 1440 px `preview`, images looked noticeably soft on 3×-DPR phones — the preview is right at the threshold for a retina-width render. Brought back the background-upgrade to `original`, but now debounced: preview loads immediately (~600 KB, fast first paint), then after 400 ms of dwell the original is quietly fetched and swapped in. Rapid navigation cancels the pending upgrade so you don't waterfall 5–10 MB originals when swiping through photos. Identity check on swap prevents a stale upgrade from replacing a newer navigation's preview.

### Service Worker
- Cache bumped `darkroom-v44` → `darkroom-v45`

---

## v1.5.11 (2026-04-23)

### UI
- **Library detail view: larger image on mobile.** Landscape photos were rendering at their natural aspect-ratio height (~25% of viewport on a phone portrait screen). The `.detail-image` mobile rule had only a `max-height` cap and no floor, so shorter aspect ratios never filled the pane. Added `min-height: 55vh` with `object-fit: contain`; landscape images now occupy at least 55% of the viewport (letterboxed top/bottom) while portrait images still render at natural size up to 80vh. Also stripped the hardcoded inline `max-width`/`max-height`/`width:auto`/`height:auto` on the `<img>` that was overriding the class rule.

### Service Worker
- Cache bumped `darkroom-v43` → `darkroom-v44`

---

## v1.5.10 (2026-04-23)

### Performance
- **Library detail view no longer auto-loads the full original**, which was silently downloading a 5–10 MB file every time you clicked a photo — painful on mobile. Detail view now uses the ~600 KB Immich `preview` (1440 px, plenty sharp for a phone screen) via `/api/immich/thumb/:id?size=preview`, and the full original only loads when you explicitly tap to fullscreen.
- **Thumb endpoint now takes a `size` query param**: `size=thumbnail` (default, grid) returns Immich's 256 px small thumb; `size=preview` returns the 1440 px preview. Grid stays tiny, detail stays sharp.
- **Initial Library page 500 → 250 photos.** Halves the initial payload (fewer thumbs requested, smaller metadata response, less DOM work) so the first paint feels snappier on mobile. The "Load More" button still pulls the next page when you scroll to the end.

### Fixed
- **v1.5.9 regression: detail view went blurry** — after the grid-thumb size drop to 256 px, the detail panel (which reused the same thumb URL) rendered a pixelated version while waiting for the full original to download over mobile. Fixed by wiring detail view to `preview` size directly.

### Service Worker
- Cache bumped `darkroom-v42` → `darkroom-v43`

---

## v1.5.9 (2026-04-23)

### Performance
- **Metadata N+1 eliminated — Library now opens ~60× faster on mobile.** Previously, opening the Library fetched 500 asset ids from `/api/immich/recent`, then fired 500 sequential `/api/immich/photo/:id` requests with a 50ms sleep between each to populate filter chips and search. On a phone-hotspot HAR trace this was 500 × ~125ms = **~62 seconds** before the Library was fully usable. The server already had access to the full `exifInfo` on each asset from Immich's `/search/metadata` response — it was stripping it out. `/api/immich/recent` now folds `description`, `model`, `lens`, `city`, `state`, `country`, `fNumber`, `exposureTime`, `iso`, `takenAt`, dimensions, etc. into each asset object. Client populates `state.recentMeta` from that response in one pass. Net: 501 requests → 1 request, no sleep loop.
- **Same metadata fold applied to all search endpoints** — `text-search`, `smart-search`, `combined-search`, and `person-search` all now return full metadata in their asset arrays, so smart/person/chip searches also render filter-ready results immediately rather than trickling in over the following minute.
- **Thumbnails ~10× smaller.** `/api/immich/thumb/:id` was proxying `size=preview` (Immich's 1440px preview, ~645 KB each) when the grid only needs the small `size=thumbnail` (~50 KB). On the same HAR trace that was ~13 MB just for the 20 visible thumbs. Switched to `size=thumbnail` for the authed grid. Full-screen viewing still pulls `/api/immich/original/:id` unchanged. (Public-album thumb proxy left on `preview` — og:image needs the larger variant for social cards.)

### Service Worker
- Cache bumped `darkroom-v41` → `darkroom-v42`

### Notes for self-hosters
- Restart the container to pick up the new server-side asset mapper and thumb-size switch.
- First page load after deploy will hit a cold Immich thumbnail cache at the new `thumbnail` size — Immich will generate them on demand; subsequent loads are near-instant.

---

## v1.5.8 (2026-04-23)

### Fixed
- **Popup "Clear" button left the active person chip selected** — the filter popup's inline Clear button calls `clearRecentChip`, which only reset `recentActiveChips` and left `recentActivePerson` untouched. Hitting Clear with Ruby (or any person) selected kept her highlighted. `clearRecentChip` now also clears the active person and re-renders the chips.
- **Typing in the Library search dropped the active person filter** — `handleRecentSearch` was clearing `recentActivePerson` on every keystroke as a side-effect of the earlier "empty search leaves chip active" fix. Combined with `searchByPerson` auto-populating the input with the person's name, typing to refine (e.g., "Ruby" + "beach") caused the next word to trump the person. `handleRecentSearch` now preserves the active person and composes the query on top of it.
- **Smart/text search did not intersect with an active person** — `text-search` and `smart-search` endpoints accepted `model`/`lensModel`/`city` but not `personId`, so server-side intersection wasn't possible. Both endpoints now accept `personId` and forward it as `personIds: [...]` to Immich. Client `runSmartSearch` / `runTextSearch` always pass `state.recentActivePerson` from state.
- **Person name auto-populated the search box** — `searchByPerson` wrote the selected person's name into the `recent-search` input, conflating "person filter" with "text query" in a single control. The input now stays empty (or keeps the user's text) and the active person is surfaced in the chip label as `👤 Name · chip · chip`.
- **Active chip label didn't show the active person** — the `active-chip-label` only reflected chips, so with only a person active nothing indicated the filter state. Label now leads with `👤 Person` when a person filter is active.

### Service Worker
- Cache bumped `darkroom-v40` → `darkroom-v41`

---

## v1.5.7 (2026-04-23)

### Performance
- **Thumbnail HTTP caching** — Immich thumbnail proxy now emits `Cache-Control` headers so browsers skip re-fetching unchanged thumbnails. Authenticated thumbs cache for 1 day (`private, max-age=86400`); public album thumbs cache for 30 days (`public, max-age=2592000`) and are safe to edge-cache behind a CDN.
- **Service worker: stale-while-revalidate for thumbnails** — thumbnails now render instantly from the SW cache with a background fetch refreshing the cached copy, matching the Immich PWA pattern. Dramatically snappier on mobile and over slower external networks.
- **Dedicated thumbnail cache that survives app updates** — thumbs live in `darkroom-thumbs-v1` instead of being wiped every time the app-shell cache version bumps. A FIFO cap of 500 entries keeps the cache bounded to respect iOS Safari's stricter storage quota.

### Added
- **✕ Clear button next to the Library search** — single click clears the search box, any active person filter, all active filter chips, and smart results. Removes the need to click each chip individually to get back to a clean Library view.

### Fixed
- **"+ Print" button did nothing** — click handler was wired to a non-existent element id, so `addEventListener` silently no-op'd and the button never opened the Add Print modal.
- **Immich search box in Add Print modal did nothing** — `<input>` had duplicate `id` attributes (`id="immich-search" ... id="immich-search-input"`); the second is ignored by browsers, so the input listener wired to `immich-search-input` silently no-op'd. Typing produced no search. Same silent-fail pattern as the + Print bug.
- **Person search: clearing the search box left the person chip selected** — `handleRecentSearch` cleared `state.recentSmartResults` but not `state.recentActivePerson`, so the chip stayed visually active and the filter stayed internally applied. It now clears the person filter on any typed/cleared input so new searches run from a clean state.
- **Person search state leaked across tab switches** — `switchTab` didn't reset `recentActivePerson`, so after a person search you couldn't do a smart search or change tabs without inconsistent state hanging around. Leaving the Library tab now resets the active person, smart results, and search input.
- **Person filter + filter chip (e.g., Ruby + Anacortes) did not intersect** — with a person chip active, clicking a metadata chip routed through `runSmartSearch` using the person's name as the query string, which discarded the face-based person filter and showed whatever matched the chip alone. `combined-search` now accepts `personId` and forwards it as `personIds: [...]` to Immich so the server does a proper intersection. `setRecentChip` and `searchByPerson` both now route to the combined search when person + chips are both active.
- **App shell was long-cached by upstream proxies**, causing JS/HTML updates to take up to a day to reach users. Server now emits `Cache-Control: no-cache, must-revalidate` on `*.html`, `*.js`, and `manifest.json`, and `Cache-Control: no-cache` on `sw.js`. Static images still get a 1-day cache. Release updates now propagate to browsers on first revalidation after deploy.

### Service Worker
- Cache bumped `darkroom-v33` → `darkroom-v40`

### Notes for self-hosters
- No configuration changes required. Restart the container to pick up the new server-side headers. Browsers will install the new service worker on the next visit.
- If users report stale thumbnails after an Immich re-process, they can clear site data once or wait up to the `max-age` window; the service worker's background refresh will catch it sooner.

---

## v1.5.6 (2026-04-21)

### Public Album
- **Header redesign** — replaced separate toolbar with integrated header; "Jacob Lakatua Photography" branding with lakatua.me link, slideshow button inline
- **Grid photo click opens single image view** — clicking a photo opens it paused in the slideshow overlay (zoom effect, controls visible) rather than starting a full autoplay slideshow
- **Swipe-down to close** — swipe down on mobile closes the slideshow overlay back to the grid

### Internal App Slideshow
- **Ken Burns fixes backported** — all three root-cause fixes (live CSS var, inline animation, scheduleNext timing) applied to internal slideshow to match public album quality
- **Fullscreen button** — `⤢` button added to slideshow controls; wired with mousemove handler to keep controls visible on hover
- **Swipe-down to close** — swipe down closes the internal slideshow overlay
- **Pause stops music** — pausing the slideshow now pauses audio; unpausing resumes it

---

## v1.5.5 (2026-04-21)

### Ken Burns Transition Fix
Three root causes of mid-cycle animation jumps resolved:
- **Live CSS variable bug** — `--kb-start`/`--kb-end` are resolved dynamically inside `@keyframes`, so updating them in `prepareSlot()` during pre-load caused an immediate position snap on the running animation. Variables now set in `show()` only, right before animation restart.
- **Animation torn off during fade-out** — animation was controlled by `.ss-slide.ss-visible .ss-img`, so removing `ss-visible` to trigger the opacity fade also stopped the animation mid-frame, snapping the image to `transform: none` while still visible. Animation now applied as inline style on the `<img>` element, persisting independently of parent class changes.
- **Timing lock** — `scheduleNext()` was called from `ssNext()` (when the transition was requested), not from `show()` (when the image became visible). This locked slot B transitions to exact 14s multiples — coinciding with the animation's own completion boundary on images 3, 7, 11. `scheduleNext()` now fires from inside `show()`.

---

## v1.5.4 (2026-04-21)

### New Features
- **Trash view** — permanently delete assets from Immich (bypass 30-day trash); view and restore archived assets
- **Create Immich album** — create a new Immich album from within the app and optionally add selected assets
- **OG meta tags** on `/album/:slug` — `og:title`, `og:image`, `og:description`, `twitter:card` injected server-side so Substack, iMessage, and other crawlers generate rich link cards
- **Public album defaults to slideshow** — bare `/album/:slug` opens the title card with a circular orange play button; `?gallery` shows the photo grid
- **Substack embed support** — `substack.com` and `*.substack.com` added to CSP `frame-ancestors`; `lakatua.com` / `lakatua.me` also added

### Bug Fixes
- `isArchived` field now included in photo info responses

---

## v1.4.3 (2026-04-19)

### Dependencies
- **multer upgraded to 2.x** — resolves known vulnerabilities in multer 1.x; music upload tested and confirmed working

---

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
