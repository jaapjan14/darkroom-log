# Changelog

## v1.5.30 (2026-04-26)

### Print detail — show albums the print is in
- New "In albums" row on the print detail page, just below the tag row. Lists every Darkroom album whose `assets[]` contains the print's `immichId` as a clickable orange-bordered chip. Clicking a chip dispatches the existing `openAlbum` action (no new wiring), so it slides into the album view exactly as if you'd opened it from the Albums tab.
- Lazy-loads `state.albums` inside `showDetail` if the user hasn't yet visited the Albums tab in this session — without that, opening a print detail directly (e.g. from the gallery) found `state.albums = undefined` and silently rendered no chips even when the print clearly was in albums.
- New CSS in `index.html`: `.print-albums-row`, `.print-albums-label`, `.album-chip` — uses `var(--safe)` and `var(--safe-glow)` to match the existing accent colour.

### Recent (Immich) photo info — show albums the asset is in
- New "📁 Albums" row in the Recent detail view's exif table, listing every Darkroom album whose `assets[]` contains the asset's Immich ID. Clicking a chip opens that album. Mirrors the print-detail "In albums" row added in v1.5.30 — uses the same `.album-chip` styling, and lazy-loads `state.albums` if Recent was opened before the Albums tab.

### Recent view "+ Album" modal — lazy-load albums
- The boot-time `fetch('/api/albums')` is fire-and-forget, so a fast "+ Album" tap on the Recent view could open the modal before `state.albums` was populated → modal showed "No albums yet" even when albums existed. `renderDarkroomAlbumPickList` is now async and pulls `/api/albums` on demand if `state.albums` isn't an array yet, with a "Loading albums…" placeholder while the fetch is in flight.
- Removed the `catch (e) { state.albums = [] }` from `showDetail`'s lazy-load — it was trampling load-in-progress state on a transient fetch failure and leaving the Recent view modal stuck on "No albums yet".

### Cache
- Bumped `app.js?v=38` → `v=41` and SW shell cache `darkroom-v59` → `darkroom-v60`.

---


## v1.5.29 (2026-04-25)

### Print tab — fix arrow keys leaking from session modal
Bug: opening "+ Session" on a print and then pressing left/right arrow while filling in the form silently moved `state.currentPrintId` to a different print (because the keydown handler still saw `detail-view` as `active` even when a modal was layered on top). Save then attached the new session to whichever print the arrow keys had drifted to — so people would log a session against the wrong print.

- **Global keydown guard** (`app.js` line 989). Added `if (document.querySelector('.modal-overlay.active')) return;` at the top of the navigation handler so arrow keys / Esc / space stop firing slideshow / recent-detail / detail-view nav while any modal is open. Inputs inside the modal continue to receive keystrokes normally — the handler doesn't preventDefault, it just doesn't route the keys to nav helpers.
- **Defense in depth — capture print id at modal-open** (`openAddSessionModal`, `editSession`, `saveSession`). New `state.sessionPrintId` snapshots `state.currentPrintId` when the session modal opens. `saveSession` uses `state.sessionPrintId ?? state.currentPrintId` for the fetch URL and the `state.prints.find(...)` lookup, then clears the snapshot. So even if some other code path mutates `state.currentPrintId` while the modal is open, the session lands on the print the user actually meant.

### Cache
- Bumped SW shell cache `darkroom-v58` → `darkroom-v59`.

---


## v1.5.28 (2026-04-25)

### Public album detail view — trackpad gesture parity
- **Two-finger trackpad swipe up over the image area in detail view → close → back to grid.** Mirrors the library `.detail-left` wheel handler in `app.js` line-for-line, just targeting `#album-detail-left` and calling `albumDetailClose()`. Suppressed while fullscreen is layered on top, and resets the accumulator on any wheel event outside the image area so a normal scroll through the EXIF panel doesn't bleed into a back-gesture.

### Cache
- Bumped `album.js?v=31` → `v=32` and SW shell cache `darkroom-v57` → `darkroom-v58`.

---


## v1.5.27 (2026-04-25)

### Public album: detail view + cleaner fullscreen
Restructured the public album single-photo experience to mirror the main app's library mode rather than overloading the fullscreen overlay with metadata.

- **New detail view (`#album-detail-view`).** Tapping a thumbnail in `/album/<slug>` now opens a two-column layout (3:2 grid on ≥768px, stacked on mobile) — image on one side, library-style EXIF panel (description on top, then `📅 Date / 📷 Camera / 🔭 Lens / 📍 Location` rows) on the other. Mirrors the `.detail-layout` / `.exif-row-item` pattern from `index.html` line-for-line, just with `album-` prefix on the class names. Header has back button (← grid), counter, and prev/next arrows. Swipe horizontal on the image = navigate; swipe down = back to grid; arrow keys + Esc on desktop.
- **Pure fullscreen viewer (`#album-fs-overlay`) now image-only.** No metadata panel, no counter — just the photo + ✕ close button. Same pinch-zoom (1×–5×), pan-when-zoomed, double-tap-toggle, swipe-down-to-close, tap-zone-navigate that shipped in v1.5.23. Closing returns to the detail view underneath at the same photo.
- **Tap the image inside detail view to enter fullscreen.** A small ⤢ corner hint and `cursor: zoom-in` signal it's interactive. Synthetic-click after a swipe is suppressed so swiping doesn't accidentally enter fullscreen.
- **Removed the ⊕ "View Original" button** from the slideshow controls. Pinch-zoom in fullscreen now covers that need; the "open in new tab" affordance was only there before pinch-zoom existed.
- **Privacy:** detail view never surfaces filename, file size, or GPS coordinates. City/state are shown (server already returned these); country is shown as a sub-line. The expanded `/api/public/photo/:id` endpoint from v1.5.26 already excludes lat/long, so no server change.

### Cache
- Bumped `album.js?v=30` → `v=31` and SW shell cache `darkroom-v56` → `darkroom-v57`.

---


## v1.5.26 (2026-04-25)

### Public album single-photo viewer — metadata panel
- **Bottom-anchored metadata panel mirroring the library detail layout.** When you tap a thumbnail in `/album/<slug>`, the new fullscreen viewer (introduced in v1.5.23) now shows three lines of metadata over a soft black-gradient fade at the bottom of the overlay:
  1. **Description** — italic, near-white, two-line clamped (Lightroom Caption / IPTC `dc:description` field)
  2. **Exposure** — `1/250s · f/2.8 · ISO 400 · 35mm` (mono, slightly dim)
  3. **Gear & context** — `📅 Sat, Oct 14, 2024 · 📷 Fujifilm X-T5 · 🔭 XF 35mm F1.4 R · 📍 Seattle, WA` (mono, dim, wraps on narrow screens)
  
  Updates as you navigate prev/next via swipe or tap zones. Per-photo metadata is fetched once and cached in the existing `assetMeta` map (which the slideshow's description path already populated). `_albFsRenderMeta` clears stale rows immediately on navigation so the previous photo's data doesn't linger while the new fetch resolves; bails on completion if the user navigated away mid-flight. Skips action buttons (`+ Album` / Share / Archive / Delete) — those are owner-only views in the library and don't belong on a public link.
- **Server: expanded `/api/public/photo/:id`** to return the full set of fields needed for the panel — `description`, `make`, `model`, `lens`, `fNumber`, `shutterSpeed`, `iso`, `focalLength`, `takenAt`, `city`, `state`, `country`. Previously returned only `description`. Same per-asset access model as the existing public `/thumb` and `/original` endpoints (any asset id served if known — no per-album gate, consistent with how the rest of the public API works). **Container restart required** for the new endpoint to take effect.

### Cache
- Bumped `album.js?v=29` → `v=30` and SW shell cache `darkroom-v55` → `darkroom-v56`.

---


## v1.5.25 (2026-04-25)

### Mobile UX
- **Library Load More: removed redundant client-side sort. Root cause finally identified.** Debug instrumentation showed `render-FULL: mismatchAt: 58` on every Load More — the prefix-match in the append-only fast path was failing at item 58 of 250, even though stable sort and no tie-break (v1.5.24) should have preserved order. The actual culprit: the client-side sort itself. Server returns each page sorted by `createdAt` desc, but `createdAt` is minute-resolution in some Immich items, so page-1's tail items can have the same timestamp as page-2's head items. When the combined `[...page1, ...page2]` array is re-sorted client-side, those equal-timestamp items get re-grouped by stable sort in their array order — but the resulting cluster order doesn't always match what the server produced for a single-page query that included those same items. Result: a subtle prefix shuffle that started ~item 58, breaking fast-path detection on every Load More.
  
  Fix: removed the client-side sort block in `applyRecentFilters` entirely. The server already sorts by the requested key, and `setLibrarySort` / `toggleLibrarySortDir` both reset state and re-fetch on change — so client sort was pure redundant work that was actively hurting. Filter logic stays untouched. With server order preserved through the append, the fast path in `renderRecentGrid` now sees an exact prefix match, calls `insertAdjacentHTML('beforeend', ...)` for the new tiles only, and the existing DOM above doesn't move at all. Removed the temporary debug strip from v1.5.24's instrumented build.

### Cache
- Bumped `app.js?v=37` → `v=38` and SW shell cache `darkroom-v54` → `darkroom-v55`.

---


## v1.5.24 (2026-04-25)

### Mobile UX
- **Library Load More on Upload-Date sort: removed the id tie-break that was causing major content shuffle.** v1.5.20 added `tie = (a, b) => a.id < b.id ? -1 : ...` to break ties when two items had identical `createdAt`, on the theory that ties were causing instability. They weren't — `Array.sort` is stable since ES2019, so equal-keyed items keep their input order. The server already returns each page in a deterministic order, so `[...page1, ...page2]` flows through the sort with page-1 items first, then page-2 items (within each timestamp group). Adding the tie-break re-ordered everything by `id` within each group — interleaving page-2 items *between* page-1 items at identical timestamps (which is exactly what bulk-imported batches look like). Result: jumping into a totally different content set at the same scroll, even though the anchor photo stayed pinned. Removing the tie-break lets the append-only fast path in `renderRecentGrid` see the page-1 prefix unchanged and just append the new tiles.

### Cache
- Bumped `app.js?v=35` → `v=36` and SW shell cache `darkroom-v52` → `darkroom-v53`.

---


## v1.5.23 (2026-04-25)

### Public album single-photo viewer
- **Replaced the slideshow-paused single-photo view with a clean library-style fullscreen viewer.** v1.5.17 had repurposed the slideshow overlay (with a `ssSinglePhoto` flag to suppress Ken Burns) for tap-a-thumbnail viewing, but the cross-fade transition between slots was still firing on every navigation, and pinch-zoom was constrained by the slot/animation system. Result: animation noise and limited zoom. Mirrored the print-tab `#fullscreen-overlay` instead — black background, single static `<img>`, no fade, no Ken Burns. Pinch 1×–5×, 1-finger pan when zoomed, double-tap toggle 1×/2.5×, swipe-horizontal to navigate, swipe-down or center-tap to close, left/right tap zones for prev/next, Esc/arrow keys on desktop, ⊕ close button. Slideshow path (▶ button on title card / header) is untouched and unchanged. Removed the `ssSinglePhoto` branch from `showKBSlide`.

### Cache
- Bumped `album.js?v=28` → `v=29` and SW shell cache `darkroom-v51` → `darkroom-v52`.

---


## v1.5.22 (2026-04-25)

### Mobile UX
- **Library Load More: residual cumulative drift fixed.** v1.5.21's append-only fast path was firing correctly (DOM didn't tear down), but Jacob still saw a few-rows-back drift that accumulated across multiple Load Mores. Two suspected causes — (a) Android Chrome's address-bar collapse/expand on tap shifts the visual viewport, and (b) the focused load-more-btn can trigger an implicit scroll-into-view as the button's DOM position moves down on each append. Three-layer fix in `loadMoreRecent` / `fetchRecentPage`:
  1. Blur `load-more-btn` (and any active element) at the start of `loadMoreRecent` so no focused element is around to be auto-scrolled-into-view.
  2. Snapshot `scrollTop` on **both** `#recent-view` (desktop's real scroller) and `document` (Android's likely scroller) before render. Force-restore both after — whichever moved gets pinned back.
  3. Anchor-based fine correction (from v1.5.19) re-runs across two `requestAnimationFrame`s as a final pass, in case visual-viewport changes outpaced the scrollTop restore.

### Cache
- Bumped `app.js?v=34` → `v=35` and SW shell cache `darkroom-v50` → `darkroom-v51`.

---


## v1.5.21 (2026-04-25)

### Mobile UX
- **Library Load More: append-only fast path in `renderRecentGrid`.** v1.5.18–v1.5.20 tried to *restore* scroll position after a full grid rebuild (save scrollTop, anchor on a visible item, two-pass rAF, stable sort tie-break). All of those left some residual jump — Jacob's bug report: "jumps up four-five rows" on the Upload-Date sort. Root cause is that `renderRecentGrid` was rewriting `grid.innerHTML` from scratch on every render, tearing down ~250 already-decoded thumbnail `<img>` elements and re-creating them with `loading="lazy"`. Even with aspect-ratio reservation, the layout-then-decode cycle plus any tiny sort-instability at the page-1/page-2 boundary added up to a noticeable upward shift.

  New approach: detect the case where the new items array is a strict prefix-extension of what's already rendered (i.e. children[i].dataset.id === items[i].id for all current children, and items.length > children.length). In that case, insert only the new tiles via `insertAdjacentHTML('beforeend', ...)`. Existing DOM is untouched, scroll position is preserved by definition, and decoded thumbnails are not re-fetched. Sort changes / filter changes / search results still take the full rebuild path. Anchor-restore logic from v1.5.19 stays as a safety net for any rebuild that happens to fire on Load More (shouldn't, with the tie-break in v1.5.20, but cheap insurance).

### Cache
- Bumped `app.js?v=33` → `v=34` and SW shell cache `darkroom-v49` → `darkroom-v50`.

---


## v1.5.20 (2026-04-25)

### Mobile UX
- **Library Load More on Upload-Date sort: still some residual jump after v1.5.19.** Two follow-up changes:
  1. **Two-pass anchor restoration.** First rAF runs after `innerHTML`'s initial layout; second rAF runs after any follow-up reflow from lazy `<img>` decoding, font swaps, or grid track relayout. The first pass pins the anchor; the second corrects for any sub-pixel drift introduced by images decoding into their reserved aspect-ratio boxes.
  2. **Stable sort tie-break on `id`.** If two items had identical `createdAt` (or identical `localDateTime`), the previous comparator returned 0 and `Array.sort`'s stability hinged on whether browser/JS engine actually preserves it for the specific input pattern. At the page-1/page-2 boundary this could subtly reshuffle items the user was looking at. Now ties break deterministically on `id`, so re-sorting after Load More produces the exact same head-of-list every time.

### Cache
- Bumped `app.js?v=32` → `v=33` and SW shell cache `darkroom-v48` → `darkroom-v49`.

---


## v1.5.19 (2026-04-25)

### Mobile UX
- **Library Load More: anchor-based scroll restoration.** v1.5.18's save/restore of `#recent-view.scrollTop` did not survive on the testing phone — likely the actual scroll container on Android Chrome is `document.scrollingElement`, not the fixed-position view, so reading `scrollTop` returned 0 and "restoring" pinned the user at the top. New approach is anchor-based: before re-render, find the topmost grid item currently in viewport and record its DOM id + `getBoundingClientRect().top`. After render, locate the same item by id and adjust scroll by the delta needed to put it back at the same offset. Walks up the DOM to find the real scroll container (any ancestor with `overflow-y: auto/scroll` and overflowing content), falls back to `window.scrollBy` otherwise. Robust to sort instability (items shifting around) since the anchor follows the item, not the pixel offset. Deferred to `requestAnimationFrame` so layout has settled after `innerHTML` replacement.

### Cache
- Bumped `app.js?v=31` → `v=32` and SW shell cache `darkroom-v47` → `darkroom-v48`.

---


## v1.5.18 (2026-04-25)

### Mobile UX
- **Pinch-to-zoom + pan in the print/library fullscreen viewer.** Tapping the detail image opens `/api/immich/original/<id>` in `#fullscreen-overlay`; the overlay now supports 2-finger pinch (1×–5×), 1-finger pan once zoomed, and double-tap to toggle 1×/2.5×. Tap-zone navigation (left 25% prev / right 25% next / center close) and swipe-nav are auto-suppressed while zoomed so panning doesn't accidentally close the photo. Ctrl/Cmd+wheel zooms on desktop. Same JS-implemented zoom as the public album viewer in v1.5.17 (native browser pinch-zoom can't reach into a fixed-position overlay).
- **Library Load More now preserves scroll position.** Previously, sorting by upload date and clicking Load More dropped you at a disorienting offset — `renderRecentGrid` rewrites the grid via `innerHTML = ...`, and any subtle re-sort shuffle in the now-larger array left the user staring at content that was no longer where it had been. Fix: `fetchRecentPage` now snapshots `#recent-view.scrollTop` before render and restores it after, but only on Load More (page > 1). First-page loads and sort changes still scroll to top as before.
- **Tap the header to scroll active view to top.** iOS Safari has this on the status bar natively; Android does not. Tapping anywhere on `.header` (away from buttons/links) now smooth-scrolls whichever `.view.active` is currently mounted.

### Cache
- Bumped `app.js?v=30` → `v=31` and SW shell cache `darkroom-v46` → `darkroom-v47` so the new code reaches phones that have the page service-worker-cached.

---


## v1.5.17 (2026-04-25)

### Public album viewer (mobile)
- **Pinch-to-zoom and pan in the public album single-photo view.** Triggered by feedback from an Android viewer who couldn't inspect detail without long-pressing → "open image in new tab." Tapping a thumbnail in `/album/<slug>` now opens the image in a still-frame viewer (Ken Burns suppressed in single-photo mode) with proper 2-finger pinch-zoom (1× → 5×) and 1-finger pan once zoomed. Double-tap toggles between fit and 2.5×. Swipe-to-navigate and swipe-down-to-close are auto-disabled while zoomed so panning doesn't accidentally trigger them. Native browser pinch-zoom can't reach into a fixed-position overlay, so this is implemented in JS (touchstart/move/end with `touch-action:none` on `.ss-img`).
- **"View Original" button (⊕) added to slideshow controls.** Opens `/api/public/original/<id>` in a new tab — gives mobile users an instant escape hatch to the browser's native image viewer for absolute-full-resolution inspection. Visible in both slideshow and single-photo modes.
- Bumped `album.js?v=27` → `v=28` and SW shell cache `darkroom-v45` → `darkroom-v46` so the new code reaches phones that have the page service-worker-cached.

---


## v1.5.16 (2026-04-24)

### SEO / Discovery
- **Added `/sitemap.xml`** generated dynamically from `albums.json`. Includes the homepage (priority 1.0) and one entry per album (priority 0.8). `<lastmod>` is set from the mtime of `albums.json`, so every time you publish or edit an album the sitemap reflects it on the next request — no rebuild step. Helps Google find new albums without depending on manual submission or backlinks.
- **robots.txt now references the sitemap** via a `Sitemap:` directive at the top of the file (standard convention; all major search crawlers honor it).
- **Added Content Signals declaration** in robots.txt: `Content-Signal: ai-train=no, search=yes, ai-input=no` (per draft-romm-aipref-contentsignals / contentsignals.org). Machine-readable equivalent of search engines may index, AI scrapers may not train on or use as input. Doesn't enforce anything (robots.txt is advisory) but lets respectful AI crawlers know your preference declaratively, instead of having to maintain a sprawling per-bot `Disallow` list as new AI bots launch.

---


## v1.5.15 (2026-04-24)

### SEO / Social
- **Expanded robots.txt allowlist for more link-preview crawlers.** v1.5.13 only allowed `facebookexternalhit`, `Facebot`, and `Twitterbot`. Added `meta-externalagent` + `meta-externalfetcher` (Meta's newer crawlers — some FB/Messenger preview traffic moved to these), plus `LinkedInBot`, `Slackbot` + `Slackbot-LinkExpanding`, `Discordbot`, `TelegramBot`, `WhatsApp`, and `Applebot` (Spotlight/Siri, sometimes used for iMessage). `User-agent: *` still `Disallow: /` so search engines and AI scrapers stay out.

---


## v1.5.14 (2026-04-24)

### SEO / Social
- **Album OG tags now include image dimensions and type.** Added `og:image:width`, `og:image:height`, `og:image:type`, `og:image:secure_url`, and `og:image:alt` to the `/album/:slug` render. Width/height are pulled live from Immich's `exifInfo` (`exifImageWidth`/`exifImageHeight`) with a 2 s timeout — falls back to a tag-less render if Immich is slow or down. Helps Facebook/Messenger render the large card before downloading the image, and prevents iMessage/Slack from falling back to a small thumbnail when they can't measure dimensions themselves.

---


## v1.5.13 (2026-04-23)

### SEO / Social
- **Added `public/robots.txt` so Open Graph link previews load.** Allows `facebookexternalhit`, `Facebot`, and `Twitterbot` (the crawlers FB/Messenger/iMessage/Twitter use to fetch OG metadata for link cards) while keeping `Disallow: /` for everyone else. Without this, those crawlers were getting blocked and album links pasted into chats showed no preview image.

---


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
