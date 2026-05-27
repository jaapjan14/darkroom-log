# Changelog

## v1.5.61 (2026-05-26)

### Post-release audit fixes (5 items)
A focused audit of the v1.5.55–60 cellular/perf work turned up one robustness gap and several minor items; all fixed here.

1. **Fullscreen viewer: type-agnostic error fallback** (`_fsLoadProgressive` / `_albFsLoadProgressive`). The mobile first-paint uses the sharp-based `/api/public/display` endpoint, which 502s on non-raster originals (video / RAW / TIFF). Added an `img.onerror` fallback to Immich's own thumbnail (renders a frame for any asset type). Also hardened the original-swap: it now swaps **only on `onload`** (a broken original can no longer clobber a good first paint — previously `onerror` also swapped, which would render a video/RAW original into the `<img>`).
2. **Library queries filtered to `type:'IMAGE'`** (`server.js`): the date-taken sort and combined-search `search/metadata` bodies now exclude videos, so they can't leak into the grid/sort in the first place. (The upload sweep already filtered.)
3. **Detail-view nav arrows during load**: `renderRecentDetail` and `showDetail` now render the prev/next arrows + counter in **phase 1** (they need no metadata), so the visible arrows are present immediately instead of appearing only after the metadata fetch resolves.
4. **Neighbour prefetch deferred**: `_fsPreloadNeighbors` / `_albFsPreloadNeighbors` now fire **after the current original lands** (in its `onload`) instead of immediately, so the prefetch can't compete with the current photo's load on weak 5G.
5. **Nav-gen consistency**: `renderRecentDetail` now defaults `myGen` to `++_navGen` on a fresh open (matching `showDetail`), so an in-flight render from a prior photo is properly invalidated.
- Cache-bust app.js v=247 → v=248, album.js v=60 → v=61; SHELL_CACHE v115 → v116; package.json → 1.5.61.

## v1.5.60 (2026-05-26)

### Fullscreen instant-feedback now mobile-only + no "size jump"
- **Issue with v1.5.59**: The tiny thumbnail (`?size=thumbnail`, ~250px) used as the instant first-paint stage rendered at its *small intrinsic size* — the fullscreen `<img>` is `max-width/height:100%` (sized to the image so `zoom.js` clamping works), so the photo appeared **small-centered then grew to full** on each nav ("jumps back then forward"). Couldn't fix with `width:100%` because `zoom.js` reads `img.clientWidth` as the rendered image size.
- **Fix**: First-paint stage is now the **adaptive display variant** (`/api/public/display/<id>-<ssDisplayWidth>.jpg` / `_dispUrl`) instead of the tiny thumbnail. It's light (~200–300 KB) *and* ≥ the device width, so on a phone it paints **full-screen** immediately — fast feedback, no shrink-then-grow. Then the full original streams in for zoom.
- **Mobile-only** (`_isMobileUA()` / new `_albIsMobile()`): desktop reverts to plain ~1440px preview → original. On a large monitor the display variant can be narrower than the screen (slight grow), and desktop connections are fast enough not to need the feedback stage.
- Neighbor prefetch now warms the adjacent **display variants** (mobile only) so the next prev/next tap is instant.
- Applied to both viewers (`album.js` `_albFsLoadProgressive`, `app.js` `_fsLoadProgressive`).
- Cache-bust app.js v=246 → v=247, album.js v=59 → v=60; SHELL_CACHE v114 → v115.
- **Release housekeeping**: `package.json` version aligned 1.5.44 → 1.5.60 (had drifted behind the app). Repo re-synced from the NAS (source of truth) and pushed to GitHub — this also backfilled v1.5.54.1 (the May 21 slideshow display variant) and the previously-uncommitted beat-detection libs (`audio-engine.js`, `essentia-*`). Multi-arch image (linux/amd64 + linux/arm64) republished to Docker Hub `:1.5.60` / `:latest`, and the Hub overview refreshed.

## v1.5.59 (2026-05-26)

### Fullscreen viewer — instant nav feedback on 5G (album + library)
- **Why**: After v1.5.58, the album still "skipped 3–4 photos on a tap" on 5G. Verified the throttle was live (checked the Cloudflare-served file, not just origin) and that one physical tap mechanically = one advance. The real cause: in the **fullscreen** viewer, nav loaded a ~670 KB preview then the ~20 MB original, so the on-screen image didn't visibly change for a second-plus — the tap felt dead, the user re-tapped, and each tap advanced. The 350 ms throttle only catches accidental double-fires, not deliberate re-taps ~700 ms apart. (v1.5.58's display-variant speed-up went into the two-column detail view, not the fullscreen viewer being navigated.)
- **Fix (both `album.js` `_albFsLoadProgressive` and `app.js` `_fsLoadProgressive`)**: 3-stage progressive load — **tiny thumbnail (`?size=thumbnail`, ~16 KB, paints almost instantly) → sharp preview → full original**. The thumbnail gives immediate visual confirmation the tap registered, so you stop re-tapping. Stages are chained (order guaranteed) and each swap is gated on the photo still being current (gen/id guard), so a slow load can't clobber the image after you've navigated on.
- **Neighbor prefetch**: each viewer now prefetches the adjacent photos' tiny thumbnails (`_albFsPreloadNeighbors` / `_fsPreloadNeighbors`), so the instant-paint stage is already cached on the next prev/next tap.
- Applied to both the public album viewer and the main library fullscreen for uniformity.
- Cache-bust app.js v=245 → v=246, album.js v=58 → v=59; SHELL_CACHE v113 → v114.

## v1.5.58 (2026-05-26)

### Public album nav — stop the "jumps two photos" + faster repaint on 5G
- **Bug**: In the shared album view, clicking/tapping prev or next sometimes advanced two photos. Worse on 5G.
- **Root cause (mechanical)**: `albumDetailNavigate` and `albumFsNavigate` (`album.js`) had **no throttle** — unlike the library's `navigateRecent` (400ms guard). A ghost-click, finger jitter, or key auto-repeat incremented the index twice. The existing stale-render guard (`if (albFs.idx !== forIdx) return`) only blocks stale *metadata* from painting; it doesn't stop the double-increment.
- **Root cause (5G aggravator)**: The detail view set `img.src` straight to `/api/public/original/<id>` — a multi-MB Z8 original per nav step. On cellular the image went blank for seconds, so a tap felt dead and you re-tapped (often >400ms later, so a throttle alone wouldn't catch it).
- **Fix**:
  1. Added a shared 350ms nav throttle (`_albNavThrottled`) guarding both `albumDetailNavigate` and `albumFsNavigate` → one tap = one photo, absorbing ghost-clicks/jitter/key-repeat.
  2. Detail-view nav now loads the lightweight **display variant** (`/api/public/display/<id>-<ssDisplayWidth>.jpg`, the same sharp-resized path the slideshow uses) instead of the full original, with a CSP-safe `onerror` fallback to the original. Repaints in well under a second on 5G, so taps feel responsive and you stop re-tapping. Tapping the image still opens true fullscreen, which loads the full original progressively — no loss for pixel-peeping.
- Cache-bust album.js v=57 → v=58.

## v1.5.57 (2026-05-26)

### Sorting a filtered library view no longer empties the grid
- **Bug**: In the Library tab, applying a tile/chip filter (e.g. a lens model) and then clicking **Upload date**, **Date taken**, or the newest/oldest direction toggle showed **"No photos."**
- **Root cause**: Immich's `/search/metadata` endpoint (used by `combined-search`) **does not return `exifInfo`** — confirmed by direct query. So `mapAssetWithMeta` (`server.js`) emits empty `lens`/`model`/`city` for every filtered result. Clicking a chip renders the server results directly (fine), but the sort toggles (`setLibrarySort` / `toggleLibrarySortDir` / `toggleRecentMode`) reset state, refetched the **unfiltered** `/api/immich/recent`, and then ran `applyRecentFilters()` — a **client-side substring re-filter** that tests the active chip against `recentMeta`. With `lens`/`model`/`city` blank, the only non-empty field was the filename, so `chips.every(c => searchable.includes(c))` failed for every item → empty grid. Hits the film/manual-lens library hardest (no auto-EXIF lens; lens names are curated separately).
- **Fix (Option B — client-side sort)**: When a chip/person filter is active, the sort toggles now skip the unfiltered `/recent` refetch + re-filter entirely and instead re-sort the already-loaded `state.recentSmartResults` client-side, using fields that **are** present in the search response (`createdAt` for upload, `takenAt`/`localDateTime`/`fileCreatedAt` for taken). New helpers `isRecentFilterActive` / `sortRecentResults` / `resortActiveFilterIfPresent` in `app.js`. The tile path (`runMultiChipSearch`) also applies the current sort on initial render and on "load more" so order stays consistent across pages.
- **Not done (deferred)**: Option A — re-querying the server with the new sort so the ordering spans result pages not yet loaded — only matters if a single filter returns >250 results. `combined-search` would need to accept `sort`/`dir`, and Immich's `order` can't cleanly express upload-vs-taken. Documented for future revisit.
- Cache-bust app.js v=244 → v=245; SHELL_CACHE v112 → v113.

## v1.5.56 (2026-05-26)

### Prints detail view — same image-first fix as the library
- Applied the v1.5.55 two-phase fix to the Prints-tab detail view (`showDetail`), which had the identical pattern: it `await`ed `/api/immich/photo/:id` (10s abort) — and sometimes `/api/albums` — before writing the `<img>`, so on a cold/slow connection the print couldn't start loading until the JSON returned, and a timeout showed "Failed to load print."
- **Fix**: Phase 1 paints the image immediately with a "Loading details…" placeholder (title/sessions/tags are local `print` data; only EXIF comes from `meta`); Phase 2 fetches metadata in parallel (abort 10s → 15s) and patches only the right-hand panel via `outerHTML`. A metadata failure now costs just the EXIF sidebar, not the print, and navigation keeps working.
- Done for uniformity with the library detail view — same code shape in both paths, no divergence to guess about later. (Usually masked on Prints by warm cache since it's a small stable set; this covers the cold-open case.)
- Cache-bust app.js v=243 → v=244; SHELL_CACHE v111 → v112.

## v1.5.55 (2026-05-26)

### Cellular performance — shared-album grid + library detail view
Two independent fixes after slow/janky loading was reported on a 5G phone connection (shared album link **and** native library).

**1. Shared-album grid pulled full previews instead of thumbnails**
- **Problem**: The public album grid (`album.js`) loaded `/api/public/thumb/<id>`, which `server.js` hardcoded to Immich's `size=preview` (~1440px, ~600–670 KB per cell). A 30-photo album = ~18 MB of grid thumbnails on cellular. No `decoding="async"` and no `width`/`height` meant each large JPEG decoded on the main thread and reflowed the grid as it landed — the "janky/glitchy" scroll.
- **Fix**:
  - `server.js` `/api/public/thumb/:id` now honors `?size=thumbnail` (passes through Immich's small WebP, ~10–40 KB). Default stays `preview` so the slideshow background, lightbox preview stage and embed-hero are untouched.
  - `album.js` grid now requests `?size=thumbnail` and adds `decoding="async"` + `width="300" height="300"` — parity with the native library grid (`app.js:770`).
- Net: grid bytes on the shared link drop ~20–30×, no main-thread decode stall, no reflow.
- Cache-bust album.js v=56 → v=57.

**2. Library detail view blocked the image behind the metadata fetch**
- **Problem**: `renderRecentDetail` (`app.js`) `await`ed `/api/immich/photo/:id` (10s abort) — and *then* a second serial `/api/albums` fetch — **before** the `<img>` was ever written to the DOM. On slow 5G the photo couldn't start downloading until the JSON round-tripped, and if it exceeded the 10s abort the user got "Failed to load photo. Check connection and try again." even though the image itself was fine.
- **Fix**: Split into two phases. Phase 1 paints the image immediately (it only needs the assetId) with a "Loading details…" placeholder panel. Phase 2 fetches metadata in parallel (abort raised to 15s) and patches **only** the right-hand info panel via `outerHTML`, leaving the already-loading image untouched. A metadata failure now costs just the EXIF sidebar, not the photo — the image stays viewable and navigation still works.
- Cache-bust app.js v=242 → v=243; SHELL_CACHE v110 → v111 (re-caches `/` so the new app.js version ref ships).
- **Note / possible follow-up**: the Prints-tab detail view (`renderPrintDetail`) still uses the old gated pattern. Left untouched this pass (out of the reported "library" scope); same fix would apply if Prints browsing on cellular feels slow.

## v1.5.54.1 (2026-05-21) — Slideshow display variant [backfilled 2026-05-26]
_Shipped to the NAS on 2026-05-21 but never logged or synced to the repo; documented retroactively during the v1.5.55–60 sync. Today's display-variant work (v1.5.58+) builds on this._

### Black-frame fix on poor wifi — server-resized slideshow images
- **Bug**: The slideshow loaded the full Immich original (6800+px, 5–22 MB) for every slide. On a slow connection a slide could fail to decode and fade out to a broken `<img>` — a visible black frame.
- **Server** (`server.js`): new `GET /api/public/display/:filename` — accepts `<uuid>-<width>.jpg` (preferred, keeps the `.jpg` extension so Cloudflare edge-caches it) or `<uuid>.jpg?w=<n>`. Width clamped 480–2400, default 1920. Sharp pipeline: lanczos3 resize, tiered unsharp mask (≤1200 / ≤1600 / none), q88 mozjpeg, 4:2:0 chroma, sRGB ICC. `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`. Originals stay on `/api/public/original/:id` for the lightbox/zoom.
- **Client** (`album.js`): `ssDisplayWidth` chosen at startup from `navigator.connection` (saveData/2g → 960, 3g or downlink <1.5 Mbps → 1280, else 1920); `_measureAndAdapt` steps the ladder down after slow loads; `_preloadAhead` prefetches upcoming slides; `_attachSlideImgHandlers` falls back to the thumbnail proxy on error instead of a black frame.
- Bytes-on-wire (one frame): original 21.9 MB → display@1920 661 KB / @1280 289 KB / @960 202 KB.
- Cache-bust album.js v=53 → v=55.

## v1.5.54 (2026-05-19)

### Embed slideshow stuck on slide 1 — fixed re-entry on startSlideshow
- **Bug**: Slideshow embedded via `<DarkroomBanner>` on lakatua.me sat on the first photo forever despite the music playing and beats detecting normally. Standalone `/album/<slug>` URL was unaffected.
- **Root cause**: The embed-hero play button had **four stacked click triggers**:
  1. `embed-hero` click via `w()` helper (album.js:980)
  2. `.embed-hero-overlay` click (album.js:984)
  3. `embed-hero` click via direct addEventListener (album.js:989)
  4. Document-level data-action delegator catching `data-action="startSlideshow"` (album.js:1009)

  A single tap fired all four `startSlideshow()` calls. Each one re-ran `openSlideshow(0)` → re-called `scheduleNext` with a non-null `ssBeatIdx` from the previous call, stepping it forward by 16 beats every time. The last call (4×) scheduled slide 2 for ~31 seconds out instead of the intended ~7.2 sec (16 beats at 132.8 BPM). Each subsequent slide compounded similarly — slideshow appeared frozen.
- **Fix**: One-line re-entry guard at the top of `startSlideshow()`:
  ```js
  if(document.getElementById('ss-overlay').classList.contains('active')) return;
  ```
  `openSlideshow` adds `.active` to `#ss-overlay` synchronously on its first line, so duplicate calls #2/#3/#4 see it's already active and bail. Standalone path unaffected — that flow uses `openSlideshowPaused`'s dynamically-created title-card play button which has only one handler.
- **How it was found**: Reproduced headlessly via Playwright on this Mac; needed DNS override (`--host-resolver-rules=MAP darkroom.jjlnas.com <CF-edge-IP>`) to bypass Chromium's Private Network Access block, since this Mac's local DNS resolves darkroom.jjlnas.com to the LAN IP. Added `console.log` instrumentation to `scheduleNext`, observed 4 rapid calls with `ssBeatIdx` stepping 32 → 48 → 64 → 80, traced back to handler duplication.
- Verified fix: counter advances 1 → 2 → 3 → 4 at ~7-9 sec intervals as expected.
- Cache-bust album.js v=52 → v=53.

## v1.5.53 (2026-05-19)

### Android gallery taps fixed after slideshow close
- **Bug**: On Android Chrome (and any Blink-based mobile browser), closing the slideshow returned the user to a visually-correct gallery grid that silently refused to respond to thumbnail taps. iOS was unaffected.
- **Root cause**: `openSlideshowPaused`'s play-button handler calls `ss-overlay.requestFullscreen()` on touch-primary devices (album.js:160–166). Android Chrome honors that on `<div>` elements; iOS WebKit rejects it (only `<video>` can go fullscreen on iOS). On Android, `ss-overlay` becomes `document.fullscreenElement`. When `ssClose()` removed the `.active` class, CSS hid the overlay via `display:none` — but Android kept the element as the fullscreen-priority input target, swallowing all gallery taps below.
- **Fix**: `ssClose()` now calls `document.exitFullscreen()` (or the webkit-prefixed variant) when a fullscreen element exists. One block, gated so iOS is a no-op (fullscreenElement is never set there).
- Cache-bust album.js v=50 → v=51.

### How to verify
- Open any public album on Android: `https://darkroom.jjlnas.com/album/<slug>`
- Tap ▶ to start slideshow → enters Android fullscreen
- Tap ✕ to close → URL bar reappears (sign that fullscreen exited)
- Tap any thumbnail in the grid → detail view opens normally

## v1.5.52 (2026-05-19)

### Detail toolbar collapsed from 3 rows to 2
- **Share buttons consolidated**: the `↑ S / ↑ M / ↑ L / ↑ XL` four-button row collapsed into a single `<select>` size picker + one `↑ Share` button. Default is M (1–1.5MB SMS-friendly). Tooltip on the picker preserves the original per-size hints (S/M/L file ranges, XL = original).
- **`↓ DL` button absorbed into XL**: `downloadRecent()` deleted. On desktop, XL share has always taken the same `/api/immich/original` → `<a download>` path that DL used — they were the same action. On mobile, XL routes through `navigator.share` as before. Net: one fewer button, identical behavior on desktop, share-sheet path on mobile.
- **Archive + Trash promoted to row 1**: now sit next to + Album / − Remove / nav arrows, leaving row 2 for export controls only (share picker + share button + embed picker + embed button).
- **Trash mode still has just Restore + Delete Forever** (no export row).
- Cache-bust app.js v=240 → v=241.

### Why
The embed picker added in v1.5.51 made the existing top row wrap unexpectedly on the narrow detail panel viewport. Rather than chase that one wrap, restructured the whole detail toolbar so all export actions share a row, all state actions share another, and total height drops from three wrapping rows to two clean rows.

## v1.5.51 (2026-05-19)

### Embed size picker + max-USM tier for low-res renders
- **UI**: replaced the single ⧉ Embed button with an inline `<select>` size picker (1024 / 1200 / 1280 / 1400 / 1600 / 2048 / 2400) + copy button. Defaults to 1400, no localStorage — always resets per session.
- **Server**: split sharpening into three tiers instead of two.
  - `width ≤ 1200` → max USM `sigma=0.9, m1=0, m2=3` (closest LR analog: Sharpen for Screen Standard). Rescues 1024 & 1200 which were soft after the prior Flickr-mild pass at 5.7–6.6× downscales.
  - `1200 < width ≤ 1280` → unchanged Flickr-mild USM `sigma=0.5, m1=0, m2=2`.
  - `width > 1280` → no USM (unchanged).
- **Picked sigma=0.9 over 1.0** after side-by-side on an a49a191a Leica M7 frame: 1.0 nudged into "processed" territory on hard edges; 0.9 holds.
- Existing 1024 URLs in forum posts re-render with the new max-USM recipe. No URL changes; only the image bytes differ.
- Compression unchanged across all sizes: q95 / mozjpeg / 4:4:4 / sRGB ICC.
- Cache-bust app.js v=239 → v=240.

## v1.5.50 (2026-05-19)

### Embed default width 1600 → 1400
Dropped the default copy-embed URL one tier to give Fred Miranda posts a
slightly smaller intrinsic render (FM does not CSS-cap, so source size ==
display size). Proxy still supports any width via filename suffix or ?w=.

## v1.5.49 (2026-05-19)

### Forum embed quality overhaul — natural sharpness via larger output size
Final pipeline for `/embed/<assetId>-<size>.jpg`:
- **Source**: pulls Immich `/assets/{id}/original` (not the preview thumbnail
  it was using before — the old path double-resampled an already-lossy
  ~1440px JPEG down to 1024 and visibly softened the result)
- **Resize**: single lanczos3 downscale to the requested width
- **Size-conditional output sharpening**:
  - `width ≤ 1280` (1024 and below): subtle Flickr-style USM applied —
    `sharpen({ sigma: 0.5, m1: 0, m2: 2 })`. m1=0 means flat areas (skies,
    out-of-focus foliage) are not sharpened at all, so no grain crunch.
    This is the same recipe Flickr uses on its `_b` 1024 size: visible
    edge improvement, no halos. At ratios ≥5× the resize takes out enough
    detail that a light USM pass is the right call.
  - `width > 1280` (1600 default, 2048): no USM. The downscale ratio
    drops below 4.3×; lanczos3 produces clean edges naturally. Any USM
    pass past this point reads as "processed" rather than sharp.
- **Encoding**: JPEG quality 95 + mozjpeg + `chromaSubsampling: '4:4:4'`
  (no chroma blur on color edges). sRGB ICC profile preserved via
  `withMetadata({ icc: 'srgb' })`.
- **Default size bumped 1024 → 1600.** When the URL has no width suffix
  (`<id>.jpg`), the response is 1600px wide. Explicit suffixes still work
  (`<id>-1024.jpg`, `<id>-2048.jpg`, etc., capped at 2400). Math context:
  Flickr's old `_b` 1024 came from a 2048px LR export (2× downscale, almost
  no detail loss). Our pipeline pulls full 6800px originals, so 1024 means a
  6.7× downscale that no amount of post-processing can fully recover; 1600
  brings the ratio down to ~4.3× and looks naturally crisp.

**Recommendation**: use `<id>.jpg` or `<id>-1600.jpg` for new forum posts.
Existing `<id>-1024.jpg` embeds still work and look better than before
(real original source + 4:4:4 + ICC + q95), just not as crisp as 1600.

Client-side: the **Copy Embed URL** action in the Darkroom Log lightbox now
generates `<id>-1600.jpg` URLs (was `<id>-1024.jpg`). Anyone copying a fresh
embed link from the app gets the better default automatically. `app.js`
bumped to `?v=238`, SW shell cache bumped to `darkroom-v110`.

Cache: existing Cache-Control unchanged (24h fresh + 7d stale-while-revalidate).
URLs unchanged. Forum posts upgrade automatically as edge caches expire;
CF cache purge accelerates that to instant.

File sizes at q95: 1024 ~315KB, 1600 ~670KB, 2048 ~1MB. All cached at the
CDN after first hit per asset.

Files: `server.js` (`/embed/:filename` handler).

---

## v1.5.48 (2026-05-19)

### Title sync from LR plugin — closes the metadata-only-PATCH title gap
- New endpoint `POST /api/lr-title` accepts `{ assetId, title }` from the
  lr-immich Lightroom plugin during its metadata-only PATCH path. Auth is the
  caller's Immich API key (read from `x-api-key`), validated by forwarding to
  Immich's `/users/me` and cached in-process for 5 minutes so a publish batch
  of N photos only pays one round-trip.
- Title index entries now carry a `source` field (`'lr'` or `'scan'`). LR
  pushes are authoritative: the 6-hour background JPEG-byte scanner skips
  entries with `source: 'lr'` so it can't clobber a title that was synced via
  the API. New scan entries are tagged `'scan'`.
- Motivation: lr-immich v0.5.0+'s metadata-only PATCH path (caption/GPS/date)
  doesn't touch JPEG bytes. Immich's asset model has no native `title` field,
  so LR title-only edits previously had no way to land in Darkroom without
  forcing a full JPEG re-render. Now they ride along on the same fast PATCH
  publish — title shows up within ~1s, no re-render.
- Existing photos that already have title baked into JPEG IPTC bytes are
  untouched: scanner still reads them, fallback works for non-LR uploads.
- Files: `server.js` (+45 lines: validation helper, backfill guard, new
  endpoint). No client-facing JS, no SW bump needed. Restart container.

### Title sync — lightbox detail endpoint patched
- Follow-up: the single-photo endpoint `GET /api/immich/photo/:id` (which
  powers the lightbox / photo detail view) was bypassing `_titleIndex`
  entirely — it called `fetchAssetTitle()` directly, which re-reads JPEG
  bytes via a Range request to Immich. So a title pushed via
  `POST /api/lr-title` would land in titles.json (and show in search
  results), but the lightbox view kept reading JPEG bytes and showed
  nothing.
- Fix: lightbox endpoint now checks `_titleIndex` first. If an entry
  exists with `source: 'lr'` it's used directly (authoritative). Otherwise
  falls back to the JPEG-byte scan (preserves existing behavior for
  non-LR uploads and older photos that never got pushed).
- Files: `server.js` (~5 lines in the `/api/immich/photo/:id` handler).
  Restart container.

---

## v1.5.47 (2026-05-17)

### Library — Full Sweep upload button regenerated (face-recognition refresh wired in)
- The `#lib-sort-mode` toggle (the "Last 7d · Full sweep →" button next to the sort buttons, visible only when the Upload Date sort is active) was originally added in commit 6557de4 on 2026-05-16. The button's HTML stub stayed in `index.html`, but the supporting JavaScript in `public/app.js` was silently lost in some subsequent regeneration of that file. The deployed server still supports `mode=window|full` on `/api/immich/recent` and still serves `POST /api/filters/refresh-people`, but with no front-end glue the button was orphaned: never un-hid itself, no click handler bound.
- Restored: `state.recentMode` / `state.recentWindowDays` initialized to `'window'` / `7`; `setLibrarySort()` now calls `updateRecentModeButton()` so the toggle becomes visible on Upload Date and re-hides on Date Taken; `fetchRecentPage()` appends `&mode=…&windowDays=…` to the request URL when the sort is `upload`; the click handler `w('lib-sort-mode', 'click', () => toggleRecentMode())` is back in `initEventDelegation`.
- Face-recognition refresh wired in for real this time: `toggleRecentMode()` now fire-and-forgets `POST /api/filters/refresh-people` after kicking the grid reload. The original 6557de4 commit added the endpoint but never called it from the front-end — meaning newly-tagged faces from Immich never showed up in the People filter without a full filter-cache rebuild. They do now, on every Full Sweep toggle.
- Files: `public/app.js` (state, `toggleRecentMode`, `updateRecentModeButton`, `setLibrarySort` hook, `fetchRecentPage` URL, click handler) → cache-busted to `?v=237`; `public/sw.js` shell cache → `darkroom-v109`. `index.html` button stub unchanged. `server.js` unchanged.
- **Operational note from the restore session:** After the front-end deploy, the live response still appeared to omit the just-uploaded historical photos. Cause turned out to be a stale `_uploadSweepCache` (in-process, 5-min TTL — but persisting across sessions in container memory). A `docker restart darkroom` cleared it; first Full Sweep click after restart did a fresh `_fetchAllTimelineAssets()` and the 2024 uploads landed at the top of the createdAt-desc sort as expected. If the same symptom recurs after a bulk upload, the fastest path is a container restart — or wait 5 min and click Full Sweep, which forces a refetch on the next request past TTL.

### Known gap — back-filled
- The CHANGELOG previously jumped from v1.5.45 (`app.js?v=74`, SW `v=96`) straight to v1.5.46 below, leaving ~14 cache-bust versions of `app.js` (v=75 → v=222) and a stack of SW bumps undocumented. Back-filled as the `v1.5.45.5 — back-fill` entry below v1.5.46: Web Audio engine, beat-aligned scheduler, four new slideshow presets (Quick / Beat / Beat Fade / Custom), per-photo title+description overlay, album title-card + auto date-range, fade-out at end, pace-pulse preview, music+description toggles. Sub-version attribution wasn't recoverable; consolidated into one entry.

---

## v1.5.46 (2026-05-17)

### Slideshow description toggle — actually hides when off
- Per-photo "Show description (caption)" toggle now defaults to OFF and is
  treated as off unless explicitly set to `true` — matching the title
  toggle's semantics. Previously the runtime used `!== false`, so for any
  album where `slideshowSettings.showPhotoDescription` was `undefined`
  (e.g. albums that hadn't had slideshow settings re-saved since the
  per-photo overlays landed), the description would render despite the
  UI appearing unchecked. Title toggle was already correct.
- Files: `public/app.js` (toggle init at ~L2040, runtime check at ~L2274),
  cache-busted to `?v=222`.

### Slideshow audio — fix Safari "silent Web Audio" after multiple track selections
- `audio-engine.js` now explicitly calls `oac.close()` on each
  `OfflineAudioContext` used in `_toMono44100` for analysis resampling.
  WebKit counts unclosed (Offline)AudioContexts against a per-document
  quota; after ~6 track previews/analyses, new AudioContexts on the page
  would still report `state: "running"` but produce no audible output,
  while HTMLAudio kept working. Quitting Safari entirely was the only
  way to recover the live state.
- Files: `public/audio-engine.js` (closes OAC after `startRendering`),
  cache-busted to `?v=10`; `public/index.html` references updated.

---

## v1.5.45.5 — back-fill (2026-05-11 → 2026-05-17)

**Pre-restore back-fill.** The CHANGELOG had a hole between v1.5.45
(`app.js?v=74`, SW `v=96` on 2026-05-11) and v1.5.46 above (`app.js?v=222`,
SW `v=107` on 2026-05-17). Roughly 14 cache-bust versions of `app.js`
shipped to the NAS in that window, plus a new sibling `public/audio-engine.js`,
plus essentia.js / WASM bundles for in-browser BPM analysis. Sub-version
attribution isn't recoverable; this single entry consolidates the
slideshow / album / audio work that landed in that period.

### New: Web Audio engine for slideshow music (`public/audio-engine.js`)
- New `window.DarkroomAudio` global. Replaces the prior `<audio>`-element
  playback because HTMLAudio's `currentTime` reports ~100–300 ms behind
  actual audio output, making beat-locked visual scheduling drift
  permanently. Web Audio's `AudioContext.currentTime` is the same clock
  the audio is generated against — sample-accurate.
- Lifecycle: `ensureCtx()` (idempotent, must fire from a user-gesture
  handler before any `await`) → `loadTrack(file)` (fetch + decode +
  cache) → `playMusic(file, {fadeMs, loop, volume})` → `pauseMusic`
  (remembers offset) / `stopMusic` (doesn't) / `getMusicTime()` (live
  position in seconds, sample-accurate) / `scheduleClick(ctxTime)` (one
  metronome tick at exact audio time, used for in-context BPM previews).
- Track + analysis caches (`Map<file, AudioBuffer>` and
  `Map<file, {bpm, beats:[seconds], confidence}>`) survive across
  preview / play cycles. Concurrent `analyzeTrack()` calls share a single
  in-flight Promise.
- Essentia.js worker (`public/essentia-worker.js` + the WASM bundle
  `essentia-wasm.umd.js` + `essentia.js-core.js`) does the BPM / beat-grid
  detection off the main thread. Results posted back to `DarkroomAudio`
  and cached per-file.
- Pause / stop / fade ramps via per-source `GainNode` (each
  `AudioBufferSourceNode` gets its own — Web Audio sources are one-shot).
- Click tick is a 40 ms dual-tone (2.5 kHz + 5 kHz) with exponential
  decay, built once at engine init; bright enough to cut through music.

### New: Slideshow presets (Classic / Quick / Beat / Beat Fade / Custom)
- The slideshow gained four new render paths alongside the existing
  Classic (Ken Burns + 1.5 s opacity crossfade) path. Each is a
  standalone function so Classic's frozen animation timing isn't
  disturbed:
  - `showSlideSlide(idx, direction)` — **Quick** preset. No Ken Burns;
    a 1.8 s horizontal slide-in (`ss-slide-h-from-right` /
    `ss-slide-h-from-left`) with the outgoing slot exiting in the same
    direction. 6 s hold.
  - `showSlideBeatFade(idx)` — **Beat Fade** preset. Same beat-aligned
    scheduler as Beat but no motion; just a crisp 400 ms opacity
    crossfade on each beat-aligned tick (`ss-fade-quick`).
  - Beat / Beat Fade share `scheduleNext()`'s beat-grid scheduling
    (below). Custom is constant-BPM; Quick / Classic use fixed time.
- `slideshowPrev()` re-anchors the beat grid (`beatIdx = beatPtnIdx =
  null`) so backward nav resyncs from the current music position
  instead of stepping the old grid backward.

### New: Beat-aligned scheduler with pattern support
- `scheduleNext()` for Beat / Beat Fade walks the
  Essentia-detected beats array using `DarkroomAudio.getMusicTime()`,
  finds the next beat that's at least `dur * 0.5` seconds away, and
  schedules `setTimeout(slideshowNext, target - musicSec)` so the slide
  change lands on that exact audio sample.
- `paceBeatsEvery` accepts a constant (`"8"`) or comma-separated pattern
  (`"8,4"`); `_parseBeatPattern()` validates → array of positive ints
  ≤ 64, falls back to `[8]`. The scheduler cycles through the pattern
  per slide via `state.slideshow.beatPtnIdx`.
- Two scheduling paths:
  1. **Override** (`paceBpmOverrideEnabled === true` + numeric
     `paceBpmOverride ≥ 40`): synthesizes a beat grid from
     `analysis.beats[0]` as the phase offset, walks the pattern from
     there. Used when Essentia's detected BPM is wrong or absent.
  2. **Auto**: walks Essentia's detected `analysis.beats` array
     directly, snapping the first slide to a multiple of `pattern[0]`
     so cadence starts on a clean barline.
- **Catch-up logic** in both paths: if a slow image load advances
  `musicSec` past the next target beat, the scheduler walks the pattern
  (and beats array) forward until the target is comfortably ahead.
  Prevents the failure mode where `delay = max(50, negative)` fires
  the next slide instantly and every late slide cascades.
- `_currentSlideHoldMs()` returns the hold for the *current* pattern
  step (correct mid-pattern); `_slideDurationMs()` returns a
  representative (first-step) duration used for fallback timing and
  the minAhead computation.
- Debug logs (`console.log('[beat-schedule] ...')`) are retained in
  both override + auto paths to aid future BPM-drift diagnosis.

### New: Per-photo title + description overlay (`_renderPerPhotoOverlay`)
- Title and description overlays render on each slide for any preset
  whose render path calls `_renderPerPhotoOverlay(idx)` (currently:
  Classic via showSlide, Quick via showSlideSlide, Beat Fade via
  showSlideBeatFade — explicitly added to Quick + Beat Fade because
  only Classic had it originally).
- Overlay shows iff `slideshowSettings.showPhotoTitle === true` /
  `showPhotoDescription === true` (strict-true; matches v1.5.46's
  description-toggle semantics fix).
- **Adaptive fade timings** keyed off the actual slide hold duration:
  - `≥ 6 s`: 1000 ms fade-in/out, 800 ms delay past image fade
  - `≥ 3.5 s`: 600 ms fades, baseline delay
  - `≥ 2.2 s` (~4-beat): 400 ms fades, delay tightened so the title
    appears before the next slide arrives
  - `< 2.2 s`: 300 ms fades, minimal 200 ms delay
  - `< 1.4 s` (≤2-beat @ 120 BPM): overlays **suppressed entirely** —
    can't fit a readable fade-in/hold/fade-out cycle.
- Per-element fade-in / fade-out timers are stashed on the DOM node
  (`titleEl._slideTitleTimer`, `descEl._slideDescFadeOutTimer` etc.)
  and cleared at the top of each new slide so a fast skip doesn't
  leak ghost titles.
- `toggleSlideshowDesc()` (✦ button in slideshow controls) toggles both
  overlays as one unit.

### New: Album title card + auto date-range
- `showTitleCard(album)` — pre-roll card before the first slide.
  Shows album title (always when `showTitle` is on), and conditionally:
  `byline` ("Photography by …"), location, date range, photo count.
  Fades in via two-rAF gate, holds 3.5 s, fades out 1 s.
- `_computeAlbumDateRange(album)` — fetches each asset's `takenAt`
  (using the `state.recentMeta` cache when available, falling back to
  `/api/immich/photo/<id>`), finds the min/max, returns a formatted
  range via `_formatDateRange()`. Capped at a 2 s `Promise.race`
  timeout so a slow Immich call can't delay the slideshow start
  indefinitely.
- `_formatDateRange()` handles four cases: same day ("Nov 16, 2024"),
  same month/year ("Nov 2024"), same year different months
  ("Nov — Dec 2024"), different years ("Nov 2024 — Mar 2025").
- Manual override: `slideshowSettings.dateRange` string wins over the
  auto-computed range when set.

### New: Fade-out at end-of-album
- `fadeOutSlideshow()` — when `slideshowSettings.fadeOutAtEnd === true`
  and `slidesShown >= album.assets.length`, the slideshow fades to
  black over 6 s while `DarkroomAudio.stopMusic({fadeMs: 6000})` fades
  the music in parallel, then `closeSlideshow()`. Opt-in per album;
  default (looping, no fade) is unchanged.

### New: In-settings pace-pulse preview
- `startPacePulse()` / `stopPacePulse()` — visible while the **Custom**
  preset is the selected one in the slideshow-settings modal. A
  growing/shrinking opacity-pulse on the `#ss-pace-pulse` element
  flashes at the slider's current BPM so the user can tap-match the
  music in their head before committing.

### New: Slideshow music-toggle + description-toggle controls
- `toggleSlideshowMusic()` — ♪ button in slideshow controls.
  Pause-with-200 ms-fade if currently playing; resume from the current
  album's `musicFile` (or the engine's last music file) if not.
- `toggleSlideshowDesc()` — ✦ button. See per-photo overlay above.
- Both controls auto-hide via `showSlideshowControls()` (3 s timer).

### New: Beat-analysis status surface (`refreshBeatStatus`)
- Live status line under the music-track picker in the slideshow-settings
  modal: `Select a music track to begin analysis` → `Analyzing track…`
  (with worker progress stages: `Analyzing: decode (12%)…`) → on
  completion `Detected: 124.0 BPM · 482 beats · confidence 0.87`, or
  `Detection failed — try BPM override or pick another preset` on
  failure. Backed by `DarkroomAudio.getAnalysisStatus(file)` and
  `window.onBeatAnalysisProgress` hooks posted from the Essentia worker.

### New: Forum-embed URL copy (`copyEmbedUrl`)
- "⧉ Embed" button in the photo detail-view header. Copies
  `${origin}/embed/<assetId>-1024.jpg` to the clipboard
  (`navigator.clipboard.writeText` with a `prompt()` fallback for
  permission-blocked contexts) so the URL drops cleanly into forum
  `[img]` BBCode at a sensible 1024px width. Companion to the
  Leica-forum-friendly server-side 1024 embed path.

### New: Music engine routing — `startSlideshowMusic` / `stopSlideshowMusic`
- Replaces the prior HTMLAudio path with `DarkroomAudio.playMusic(file,
  { fadeMs: 1600, loop: true, volume: 0.85 })` for slideshow entry and
  `DarkroomAudio.stopMusic({ fadeMs: 800 })` for exit.
- Settings-modal music preview shares the same single music slot via
  `startMusicPreview` / `stopMusicPreview` at 0.6 volume — so previewing
  a track while a slideshow is queued doesn't double up.

### Pre-existing infrastructure touched
- `index.html` got new `<script>` tags for `audio-engine.js`,
  `essentia-worker.js`, `essentia.js-core.js`, `essentia-wasm.umd.js`,
  plus `<div id="ss-pace-pulse">`, `<div id="ss-title-card">`,
  `<div id="slideshow-photo-title">`, `<div id="slideshow-description">`
  and the ✦ / ♪ control buttons.
- SW (`public/sw.js`) cache key bumped repeatedly in this window
  (`darkroom-v96` → … → `darkroom-v107`); `STATIC` precache list
  unchanged (essentia / engine load on demand via `<script defer>`).

---

## v1.5.45 (2026-05-11)

### Add to album — prepends instead of appending
- `addToAlbum()` in `app.js` was appending new photos to the END of the album's asset list. Result: when Jacob added a just-edited photo to an album, he had to scroll all the way to the bottom of the album to see it. Surprising — the mental model is "show me what I just added."
- Now prepends: new adds land at index 0 (top of the grid). Multi-select adds preserve their selection order — the first selected photo lands at index 0, second at index 1, etc., with the existing album behind them.
- Edge case unchanged: if the album already has a cover, it stays. If not, the new top-of-list photo becomes the cover (which matches the old behavior on an empty album, since the first add was always at index 0 there too).

### Cache
- Bumped `app.js?v=73` → `v=74` and SW shell cache `darkroom-v95` → `darkroom-v96`. Client-only fix; no server.js change, no container restart needed.

---

## v1.5.44 (2026-05-11)

### Share button — preserve EXIF/IPTC/XMP metadata in resized JPEGs
- Sharp's `.jpeg()` drops all metadata by default. The v1.5.43 server-side resize chain (S/M/L share + the new 1800px small thumb tier) had no `.withMetadata()` call, so every shared / share-cached JPEG since 1.5.43 was stripped of EXIF (camera, lens, shutter, aperture, ISO, date taken), GPS, IPTC caption/title, and XMP keywords. Receivers saw a plain JPEG with no metadata even though the source had full metadata.
- Fixed at both call sites: `/api/immich/download/:id?size=...` and `/api/immich/thumbnail/:id?size=small`. Sharp now chains `.withMetadata()` before `.jpeg()`, so the encoded output carries every EXIF/IPTC/XMP tag from the source through to the recipient.
- Cleared 39 stale entries in `/data/share-cache` so previously-cached metadata-stripped JPEGs don't keep getting served. New cache entries will be re-encoded with metadata on next request.
- Knock-on: metadata adds ~50-300 KB per file depending on the size of embedded XMP develop history and preview thumbnails. The Leica-forum 2.7 MB ceiling (Large) and other byte targets still hold — the quality-iteration loop just may drop quality slightly more aggressively to compensate.

### Privacy note
- `withMetadata()` preserves *everything*, including GPS. If a public-share path ever wants GPS stripped while keeping camera/date, that's a follow-on — would need per-tag rewrite via exiftool or a sharp metadata-filter dance.

### Cache
- No client-side bumps; server.js change only. Container restart was enough to take effect.

---

## v1.5.42 (2026-05-01)

### CSP — allow Astro portfolio iframe embed
- Added `https://lakatua-me.pages.dev` and `https://*.lakatua-me.pages.dev`
  to the `frame-ancestors` directive in server.js, so the Astro portfolio's
  `<DarkroomBanner album={slug} />` component can iframe
  `https://darkroom.jjlnas.com/album/<slug>?embed`. (Already documented in
  the project's reference docs; this entry exists so the CHANGELOG matches
  the deployed CSP.)

### Two-step share UX — fixes Safari iOS NotAllowedError on slow connections
- Previously the Share button called `navigator.share()` directly with the
  fetched blob. On slow connections — or with the larger images coming
  from the new server-side encoder (v1.5.43) — the fetch could take long
  enough that iOS Safari revoked the transient user-activation granted by
  the original tap, surfacing as `NotAllowedError`. The share itself
  hadn't started; the OS just refused to show the share sheet.
- Phase 1: tap the Share size button → modal opens with a spinner
  ("Preparing image…"). The fetch runs while the modal is up.
- Phase 2: when the blob is ready, the modal flips to a green "Tap to
  share" button. The user's *fresh* tap on that button is the gesture
  that's passed into `navigator.share()` — well within Safari's
  transient-activation window. AbortError (cancel) and InvalidStateError
  (double-tap re-entry) are still suppressed.
- Desktop fallback unchanged: the Mac share sheet has no Save-to-Disk
  option, so desktop bypasses share() entirely and triggers a Blob-URL
  download instead. Visual feedback: same spinner during the fetch so the
  user knows something is happening on slow connections.

### Phone-landscape detail view
- Phones in landscape (width > 600px from regular media query but
  `max-height: 500px`) used to render the detail layout's two-pane grid,
  squeezing the photo into the left pane and the metadata into a narrow
  right column.
- Now landscape on phones drops back to a stacked layout: photo
  full-width at the top (max 92vh, object-fit:contain), metadata below
  in its natural reading order.
- Tab bar is hidden in this orientation — rotate to portrait to switch
  tabs. Header is pinned to the **bottom** of the viewport so Back / Out
  are still reachable while the image gets the full top of the screen.
- iPad landscape (height ~768px+) is excluded by the `max-height: 500px`
  ceiling and continues to use the grid layout.

### iOS double-tap → synthetic click suppression in the fullscreen viewer
- iOS Safari fires a synthetic click event ~300ms after the second
  touchend of a double-tap. zoom.js handles the touch-double-tap
  immediately to toggle zoom, so by the time the synthetic click arrives
  the "bail if zoomed" guard in the click handler doesn't fire (zoom has
  already toggled back off, or the touch state has settled). Result: a
  double-tap to zoom would also trigger the click handler's
  prev/next/close action a fraction of a second later.
- Stamp `_fsLastDoubleTapAt = Date.now()` from zoom.js's onDoubleTap
  callback, and drop any click on the fullscreen image that lands within
  600ms of it.

### Force Refresh button in the print/photo detail view
- New `🔄 Refresh` button (data-action="forceRefresh") next to the existing
  detail-view header buttons. Clears the service-worker cache and reloads.
- Escape hatch for when a stale SW cache is suspected — saves the user
  from having to know about DevTools / Application / unregister.

### Race-free navigation across all photo views
- A monotonically increasing nav-generation counter is bumped on every
  navigation (Library detail, Album detail, Print detail, fullscreen
  prev/next, swipe). Async work (fetches, image decodes, etc.) captures
  the gen value at start and bails when it returns if a newer nav has
  happened in the meantime.
- Fixes: on slow connections, tapping past the cooldown to skip several
  photos would render whichever stale fetch landed last — frequently the
  wrong image for the current URL. Now stale results are dropped silently.
- A 400ms cooldown on the nav handlers prevents a stray double-click or a
  queued click-plus-swipe from skipping an image when the user only
  intended to advance once.
- Applied to: `renderRecentDetail`, `showDetail`, `_fsLoadProgressive`,
  and the prev/next/close paths in the fullscreen and detail overlays.

### Progressive image loading on detail / fullscreen
- Detail and fullscreen views now load through a tiered progressive chain
  instead of going straight to the full preview.
- **Mobile** (multi-signal: UA, touch points, viewport, pointer:coarse):
  thumbnail → small → preview → original. Mobile's slower data and the
  detail view's smaller layout don't need the full original up-front;
  showing the thumbnail in <100ms and upgrading in the background feels
  instant.
- **Desktop**: preview → original. Skip the lower tiers because desktop
  is typically fast and the larger viewport asks for detail sooner.
- Implementation is generic: on `img.onload`, look at `data-next`,
  preload that source in a detached `Image`, then swap `img.src` on
  preload-complete. The browser fires onload again, the function runs
  again, and if `data-next` is set anew the chain advances. Stale-tier
  guard (`img.dataset.next !== next`) drops upgrades after the user has
  navigated away.

---

## v1.5.43 (2026-05-05)

### Server-side sized download — replaces v1.5.33's client-side canvas downscale
- The S/M/L/XL share menu (added v1.5.33) previously downloaded the full
  Immich preview JPEG and downscaled it client-side via canvas. That
  worked but: (a) hit the device's memory hard for large originals on
  iOS, (b) couldn't guarantee a byte ceiling, (c) burned bandwidth even
  on the smallest tier, (d) JPEG re-encode from canvas is consistently
  worse than mozjpeg.
- New `/api/immich/download/:id?size=<small|medium|large|xlarge>` does the
  resize + JPEG encode on the server using `sharp` + mozjpeg.
- **Size targets** (max longest edge / max byte ceiling):
  - `small`  — 1200px / 500 KB.  iMessage / SMS-friendly.
  - `medium` — 2400px / 1.5 MB. General messaging (Signal, WhatsApp).
  - `large`  — 4200px / **2.7 MB hard ceiling**. Sized specifically for
                **the Leica forum's 2.7 MB upload limit** — the encoder
                iterates JPEG quality down (start q=95, step -5, floor
                q=50) until the output lands under the ceiling.
  - `xlarge` — full original, Q100, streamed through unchanged.
- New dependency: `sharp` (added to package.json — verify it's in the
  Dockerfile's runtime stage).
- Removed client-side canvas downscale from `shareRecent`.

### Disk cache for the new sized download endpoint
- Encoded outputs are written to `/data/share-cache/<assetId>-<size>-<tag>.jpg`,
  where `<tag>` is the asset's Immich `updatedAt` (stripped of dashes /
  colons / dots / TZ markers).
- Cache hit returns the file directly with `X-Cache: HIT`. Cache miss
  re-encodes and writes via an atomic temp+rename so concurrent
  generations don't clobber.
- `updatedAt`-based key means an Immich republish from Lightroom
  auto-invalidates without needing a manual flush — old entries become
  orphans that can be pruned later.
- Same disk-cache pattern was retrofitted onto the existing thumbnail
  endpoint for a new `?size=small` tier (1800px / q80, also disk-cached)
  used by the progressive chain's mid-tier on mobile.

### `visibility: 'timeline'` on /api/immich/recent
- v1.5.40 fix moved over from `/api/immich/recent` to ensure
  `/search/metadata` calls pass `visibility: 'timeline'` on both the
  `taken`-sort branch and the upload-sort branch. (This may have already
  been live as part of the v1.5.40 deploy; included here for
  completeness — verify against `git show` before tagging.)

### Cache bumps
- `app.js?v=50` → `v=73` across the changes above
- SW shell `darkroom-v69` → `darkroom-v95`

---

## v1.5.41 (2026-04-29)

### Delete button — align with v1.5.39 archive pattern
- Companion fix to v1.5.40. Server side was already correct: Immich's `/search/metadata` excludes trashed items by default (verified empirically — 0 trashed assets in a 1000-asset default response), and v1.5.40's `visibility: 'timeline'` excludes archived too. But the *client* delete handler (`deleteImmichAsset`) wasn't following the v1.5.39 archive pattern, so a deleted photo could persist in the grid until the next full refetch.
- Specifically, the old delete code only filtered `state.displayedItems` and `state.recentItems`. It missed `state.recentSmartResults` (the "Smart Search" cache) and never called `applyRecentFilters()` (the canonical re-render path). So if you deleted from a smart-search result set, or stayed on the same view long enough, the deleted tile could still be sitting in the rendered DOM.
- Fix: filter all three source lists (`recentItems`, `displayedItems`, `recentSmartResults`), drop `recentMeta[id]`, then call `applyRecentFilters()` — same shape as the archive handler.
- Bumped `app.js?v=51` → `v=52` and SW shell cache `darkroom-v68` → `darkroom-v69`.

---


## v1.5.40 (2026-04-29)

### Archived (and trashed) photos no longer reappear in the Library grid
- After v1.5.39, archive succeeded server-side and the photo correctly disappeared from the grid client-side — but on any subsequent fetch (scroll, tab switch, reload) archived photos came right back. Same for a deleted baby photo.
- Root cause: `/api/immich/recent` was calling Immich's `/search/metadata` with `{ size, page }` and no visibility filter. Immich's metadata search returns *all* assets by default (timeline + archive), so every poll re-populated `state.recentItems` with the just-archived assets, undoing the v1.5.39 client-side filter.
- Fix: pass `visibility: 'timeline'` on both POST bodies in `/api/immich/recent` (the `taken`-sort branch and the upload-sort branch). Matches the pattern already used by `/api/immich/archived` (which passes `visibility: 'archive'`). Server change only — no client/cache bump needed.

---


## v1.5.39 (2026-04-29)

### Archive button — actually removes the photo from the Library grid
- v1.5.38 fixed the server-side 204-parse bug, so archive no longer surfaces the spurious "Archive failed" alert. But the photo wasn't disappearing from the Library grid afterwards, even though the archive succeeded server-side.
- Root cause: v1.5.32's UI-refresh code called `renderRecentGrid()` with no arguments. That function expects an `items` array, sets `state.displayedItems = items`, and renders. With `items === undefined`, it was setting `state.displayedItems` to `undefined` and then iterating nothing — silent no-op. The archived photo stayed in the DOM because the grid was never re-rendered with the filtered list.
- Fix: drop the archived ids from every list that feeds the Library grid (`state.recentItems`, `state.displayedItems`, `state.recentSmartResults`) and then call `applyRecentFilters()` — the canonical path that picks the right source list, runs the active filter chips / search query, and re-renders. Same path the rest of the app uses.

### Cache
- Bumped `app.js?v=50` → `v=51` and SW shell cache `darkroom-v67` → `darkroom-v68`.

---


## v1.5.38 (2026-04-28)

### Archive button — actual root cause fixed (server-side)
- v1.5.32 hardened the *client* against an undefined-state crash in `archiveImmichAssets`, but Jacob kept seeing "Archive failed" even though the photo was actually disappearing from the library. The real bug was on the server: `/api/immich/assets/archive` and `/api/immich/assets/restore` were doing `await r.json()` on Immich's response, but Immich's bulk-update endpoint returns **HTTP 204 No Content with an empty body**. Calling `.json()` on an empty body throws `Unexpected end of JSON input` → falls into the catch → returns HTTP 500 → client's `r.ok` is false → "Archive failed" alert. The archive itself succeeded on the Immich side every time; only the proxy was lying.
- Fixed both endpoints by returning `res.status(204).end()` instead of trying to parse a body that isn't there. v1.5.32's defensive client-side guards stay (good belt-and-suspenders) but they're no longer the active fix.
- Requires a container restart so server.js change takes effect (no client cache change).

### Cache
- No client-side bumps. server.js change only.

---


## v1.5.37 (2026-04-28)

### Public album fullscreen viewer — actually decodes the hi-res original now
- v1.5.36 wired up the makeZoomer + 2-stage progressive load, but zooming still showed soft pixels even on a known hi-res photo. Root cause: `album.html`'s `.album-fs-overlay img` CSS rule had a baked-in `will-change: transform`. zoom.js dynamically toggles `style.willChange = 'transform'` during gestures and clears it (`= ''`) 220 ms after the last interaction so Safari can re-rasterize from the source bitmap — but with the CSS rule asserting `will-change: transform` permanently, clearing the inline style fell back to CSS and Safari stayed in "composited at layout size" mode, ignoring the high-res decode.
- The main app's `index.html` already had the explicit comment about this trap (lines 203–205) and intentionally omitted both `will-change` and `transform-origin` from its `.fullscreen-overlay img` rule. The album page never inherited that lesson. Fixed by deleting `will-change:transform` and `transform-origin:center center` from the album rule and copying the same warning comment over.
- Net effect: zoom in on a public-album photo now actually shows real detail from the originally-uploaded hi-res file (after the brief preview→original swap finishes).

### Cache
- Bumped SW shell cache `darkroom-v66` → `darkroom-v67`. No JS changes; CSS-only fix in `album.html`.

---


## v1.5.36 (2026-04-28)

### Public album fullscreen viewer — full Library-tab zoom parity
Same `makeZoomer` controller the main app's fullscreen viewer uses (from the existing `/zoom.js` — **not modified**, just included now on the public page) and the same 2-stage progressive load.

- **`zoom.js` is now loaded on the public album page** via a new `<script src="/zoom.js?v=2">` tag in `album.html`, before `album.js`. Zero edits to `zoom.js` itself (it remains `v=2`, see `feedback-zoom-js-frozen.md`).
- **`album.js` — replaced the custom album-fs zoom with `makeZoomer`.** Out: the inline `albFs.scale/tx/ty` state, the touch pinch / pan / double-tap detection, the ctrl+wheel zoom handler, and the desktop dblclick toggle that v1.5.35 had added. In: a single `_albFsZoomer` reference, attached on `albumFsOpen` (after the image's first stage loads, since `clamp()` reads clientWidth/Height), reset on `albumFsNavigate` (the `<img>` element survives, so the zoomer carries through), destroyed on `albumFsClose`. Pinch / wheel / ctrl+wheel / drag-pan / native dblclick / mobile double-tap are all owned by zoom.js now — variable scale up to 8×, mouse-anchored zoom-toward-cursor, pan-when-zoomed.
- **2-stage progressive image load (`_albFsLoadProgressive`).** Mirrors the main app's `_fsLoadProgressive`: set `img.src` to `/api/public/thumb/:id` first (Immich preview ≈1440px, decodes fast), preload `/api/public/original/:id` in a detached `<Image>`, then re-set `img.src` to the original on preload complete. The `src=` re-assignment forces Safari to re-decode the bitmap at the natural resolution — without it, Safari caches the initial-decode bitmap at layout size and zoomed views look soft no matter how high-res the source. This is the actual fix for the "zoom lacks detail" symptom after yesterday's hi-res re-upload.
- **Wire-up cleanup.** `wireAlbumFs` is now just the swipe-to-nav-or-close handler (when not zoomed) plus the click handler. The click handler keeps the v1.5.35 bounce guard (drop click-2 within 500 ms of opening) and the 280 ms deferred prev/next/close — zoom.js's `onDoubleTap` callback (registered in `_albFsAttachZoomer`) cancels the deferred close on both desktop dblclick and mobile double-tap.
- **Slideshow (`ss-overlay`) is unchanged** from v1.5.35 — kenburns still runs against the custom `ssZoom` path, plus the desktop dblclick zoom toggle from v1.5.35. No `makeZoomer` there because zoom.js's transform would fight kenburns (this was the v1.5.35 zoom.js incident).

### Cache
- Bumped `album.js?v=33` → `v=34` and SW shell cache `darkroom-v65` → `darkroom-v66`. `zoom.js` is unchanged at `v=2`. `app.js` is unchanged at `v=50`.

---


## v1.5.35 (2026-04-28)

### Public album (`/album/<slug>`) — desktop double-click zoom + bounce-fix
Three small additions to `album.js` only. `app.js`, `zoom.js`, and the main app are not touched.

- **Album fullscreen viewer (`album-fs-overlay`) — bounce guard.** Double-clicking the photo in the album detail view was opening the pure-fullscreen viewer on click 1, then closing it on click 2 because click 2 landed on the overlay's center 50% which was wired to `albumFsClose`. `albumFsOpen` now stamps `_albFsJustOpenedAt = Date.now()` and the overlay's click handler drops any click that arrives within 500 ms of it. Click 2 of the bouncing dblclick is therefore a no-op and fullscreen stays open.
- **Album fullscreen viewer — desktop double-click toggles zoom.** Previously desktop only had ctrl/cmd+wheel zoom in this viewer; touch had double-tap. New `dblclick` listener on `album-fs-img` mirrors the touch double-tap: cancels any pending single-click action and toggles between 1× and 2.5× (same scale numbers as the existing touch path). Single-click prev/next/close is now deferred 280 ms so the dblclick can cancel it before it fires (matches the main app's fullscreen-overlay click pattern).
- **Slideshow (`ss-overlay`) — desktop double-click toggles zoom.** New `dblclick` listener on each of `ss-img-a` / `ss-img-b` toggles `ssZoom` between 1× and 2.5×, calling the existing `applyZoomTransform()`. Touch double-tap was already in place; this brings desktop to parity. No bounce guard needed here since the slideshow doesn't open from a click on a photo, so click-2 of a dblclick can't hit a "just-opened" close path.

### Cache
- Bumped `album.js?v=32` → `v=33` and SW shell cache `darkroom-v64` → `darkroom-v65`.

---


## v1.5.34 (2026-04-28)

### Share button — silence the spurious "share() is already in progress" alert
- The macOS / iOS native share sheet was opening fine on first tap, but a duplicate click (mobile WebKit can dispatch a click twice; or the user just double-tapped) reentered `shareRecent` while the first `navigator.share()` was still pending. Web Share rejects the second call with `InvalidStateError: share() is already in progress` — the share itself succeeded, but the user saw a "Share failed" alert behind the share sheet anyway.
- Added an `_shareInFlight` module-level guard so re-entries while a share is pending are dropped on the floor. Also extended the catch-block whitelist to swallow `InvalidStateError` alongside the existing `AbortError` (user-cancel) suppression — both are routine, not real failures.

### Cache
- Bumped `app.js?v=49` → `v=50` and SW shell cache `darkroom-v63` → `darkroom-v64`.

---


## v1.5.33 (2026-04-28)

### Share button — pick S / M / L / XL
- Detail view's single `↑ Share` is now a 4-button group: `↑ S`, `↑ M`, `↑ L`, `↑ XL`. Tooltips spell out the trade-off (size on disk vs. resolution).
- Sizes:
  - **Small** — ~600px long edge, ~150 KB. Best for SMS / very low-bandwidth chat.
  - **Medium** — ~1080px long edge, ~500 KB. Sane default for messaging apps (iMessage, WhatsApp, Signal).
  - **Large** — ~1440px long edge, ~1 MB. Immich's preview tier straight through, no client downscale.
  - **X-Large** — full original. Multi-MB for high-res JPEGs / RAW / HEIC; for printing, archival, or detail review.
- Implementation: Small/Medium pull the same `/api/immich/preview/:id` JPEG that Large does, then downscale client-side via canvas (`_downscaleBlob`). XL hits `/api/immich/original/:id` unchanged. Saves a server-side resize pipeline and keeps everything in-browser.
- All four sizes still go through the existing iOS-share-friendly path: `.jpg` extension forced, `navigator.canShare` guarded, `AbortError` swallowed, otherwise a clear error alert.

### Cache
- Bumped `app.js?v=48` → `v=49` and SW shell cache `darkroom-v62` → `darkroom-v63`.

---


## v1.5.32 (2026-04-28)

### Share button — use preview-size JPEG instead of full original
- Hi-res additions to the library (multi-MB JPEGs, plus the occasional RAW/HEIC/TIFF) were tripping `navigator.canShare` on iOS Safari, surfacing as "Share failed" alerts. The Recent detail view's `↑ Share` button now fetches a new endpoint, `/api/immich/preview/:id`, which proxies Immich's `?size=preview` thumbnail (~1440px long edge, typically <1 MB JPEG). That fits comfortably under the Web Share API's per-file limits and is high enough quality for messaging / social.
- `shareRecent` rewrites the filename to `.jpg` regardless of the original extension, since the preview is always JPEG. Hardened the `navigator.share` / `canShare` guards so an unsupported browser shows a clear "Try Download instead" message instead of the old generic failure.

### Archive button — UI refresh no longer masquerades as a server failure
- The detail-view Archive button was showing "Archive failed." even when the underlying Immich PUT actually succeeded (HTTP 204). Cause: `archiveImmichAssets` ran `state.currentImmichAlbumAssets.filter(...)` after the PUT, but that field is undefined when the detail view is opened from the Recent feed or search results — the throw landed in the same `catch` block as the network failure, indistinguishable to the user.
- Split the function so the alert only fires on a non-OK response. Local-state mutation now wraps each step in array guards (`Array.isArray`), also patches `state.recentItems` if present (so the photo disappears from the Recent grid right away), and a defensive `console.warn` swallows any post-success UI hiccup. Restore got the same treatment.
- New `/api/immich/preview/:id` server endpoint optionally takes `?size=thumbnail` if anything else later wants the small variant.

### Cache
- Bumped `app.js?v=47` → `v=48` and SW shell cache `darkroom-v61` → `darkroom-v62`.

---


## v1.5.31 (2026-04-28)

### Library — shift-click range select
- Library multi-select previously only supported one-by-one tap toggle; the Album editor and Immich tab already had shift-click range select via `toggleAlbumPhotoSelect` / `toggleImmichAsset`. Brought Library to parity:
  - Click dispatcher (`recentItemClick`) now passes the click event through.
  - `toggleAssetSelect` accepts `(assetId, e)` and tracks `lastRecentSelectedIdx`. Shift-click extends the range from the last single-tap anchor to the current tile (using `state.displayedItems` for index lookup, so the range respects whatever filter / smart-search subset is on screen).
  - `enterSelectMode` / `exitSelectMode` reset the anchor so a fresh select session doesn't inherit a stale range start.
- Side fix: tap selection now re-renders the grid via `renderRecentGrid`, so the inner `.select-check` circle correctly fills green on toggle. Before, only the gallery-item's `.selected` class was being patched element-side, so the outline + dim appeared but the green checkmark stayed gray — selections were tracked correctly internally, just visually understated.

### Cache
- Bumped `app.js?v=46` → `v=47` and SW shell cache `darkroom-v60` → `darkroom-v61`.

---


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
