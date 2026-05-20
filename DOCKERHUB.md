# Darkroom Log

Self-hosted darkroom printing log and analog photo library, built for Immich integration.

![Prints tab — searchable, tag-filtered grid of every print](https://raw.githubusercontent.com/jaapjan14/darkroom-log/main/screenshots/01-prints-grid.png)

Each print page records full exposure data (shutter / aperture / ISO / lens), tags, every print
session you've made of it (paper, enlarger, lens, exposure, dodge/burn notes), and chips for any
album the print belongs to so you can jump straight to that album from the print itself.

![Print detail with In Albums chip](https://raw.githubusercontent.com/jaapjan14/darkroom-log/main/screenshots/02-print-detail.png)

Albums double as **public, shareable galleries** — each gets its own URL with a custom branded
header, optional slideshow, and pinch-zoom on every photo. No login required for viewers.

![Public album with branded header](https://raw.githubusercontent.com/jaapjan14/darkroom-log/main/screenshots/03-public-album.png)

**Source:** https://github.com/jaapjan14/darkroom-log

## What's new in v1.5.54

- **Forum embed pipeline rebuilt** — `/embed/<assetId>-<width>.jpg` now pulls the Immich original (not the already-resampled preview), does a single lanczos3 downscale, and applies size-conditional unsharp mask:
  - **≤1200 px** (1024 / 1200): max USM (sigma 0.9) — closest LR analog to "Sharpen for Screen — Standard". Rescues low-res renders that used to look soft after 5×+ downscale.
  - **1280 px**: Flickr-style mild USM (sigma 0.5).
  - **>1280 px** (1400 / 1600 / 2048 / 2400): no USM — lanczos3 carries the edges naturally.

  Output is JPEG quality 95, mozjpeg, 4:4:4 chroma, sRGB ICC. Same URL pattern, just better bytes; existing forum embed links upgrade automatically as CDN cache expires.
- **Inline embed-size picker** in the detail toolbar — pick any of 7 widths (1024–2400) from a dropdown, hit ⧉ Embed to copy the BBCode-ready URL.
- **Detail toolbar collapsed from 3 rows to 2** — the four `↑ S/M/L/XL` share buttons are now a single size picker + one ↑ Share button. The standalone ↓ DL was redundant with XL (same `/api/immich/original` path on desktop) and got merged in. Archive + Trash moved to row 1 so all export controls share row 2.
- **Public album taps no longer break on Android** — closing the slideshow now calls `document.exitFullscreen()`, so the (now-invisible) overlay stops capturing input. Without this, Android Chrome silently kept the overlay as the fullscreen element and swallowed every gallery thumbnail tap. iOS was unaffected (WebKit rejects `requestFullscreen` on `<div>` to begin with).
- **Embedded slideshows actually cycle** — fixed a four-way duplicate-handler stack on the embed-hero play button that caused `scheduleNext` to be called four times in rapid succession, scheduling slide 2 ~31 seconds out instead of ~7. A single re-entry guard on `startSlideshow` blocks the duplicate calls; cross-origin iframe embeds now advance on the beat as intended.
- **Lightroom title sync** — new `POST /api/lr-title` endpoint accepts authoritative title pushes from the lr-immich plugin during its metadata-only PATCH path. Title shows up in search + lightbox within a second, no JPEG re-render needed. Background JPEG-byte scanner skips entries marked `source: 'lr'` so it can't clobber a plugin-synced title.
- **Slideshow Web Audio engine** — added a sample-accurate music clock with auto-tempo detection so beat-driven presets (Beat / Beat Fade) lock slide changes to the music. Four preset transitions (Classic Ken Burns, Quick slide-horizontal, Beat, Beat Fade), per-photo title + description overlays, optional title card with byline / location / date range / photo count, "Fade out at end" toggle. Safari quota leak fixed (offline audio contexts now close after analysis).
- **Library Full Sweep button restored** — the "Last 7d · Full sweep →" toggle next to the upload-date sort works again; toggling to Full Sweep also refreshes the face-recognition People filter so newly-tagged faces from Immich appear without a manual filter-cache rebuild.

## What's new in v1.5

- **In-Albums chips on every print and Recent photo** — see at a glance which Darkroom albums each image is in; click to jump straight to the album.
- **Public album detail view** — tapping a thumbnail in `/album/<slug>` opens a library-style two-column layout with EXIF (description, date, camera, lens, location), separate from the fullscreen Ken Burns slideshow.
- **Pinch-zoom fullscreen viewer** — public album fullscreen is now image-only with 1×–5× pinch, pan-when-zoomed, double-tap toggle, swipe-down to close. Trackpad two-finger swipe-up also closes.
- **Album metadata API** — expanded `/api/public/photo/:id` returns full EXIF (make, model, lens, focal length, shutter, aperture, ISO, date, city/state/country) for the public viewer. GPS lat/long never leave the server.
- **Mobile Load More smoothness** — fixed cumulative scroll drift across multi-page library loads; fast-path append now keeps the DOM above untouched.
- **Session arrow-key fix** — opening "+ Session" no longer leaks left/right arrows into print navigation, so sessions can't accidentally land on the wrong print.
- **Lazy-loaded albums** — opening a print or Recent photo before visiting the Albums tab no longer silently shows zero album chips; albums fetch on demand.

See [CHANGELOG](https://github.com/jaapjan14/darkroom-log/blob/main/CHANGELOG.md) for full version history.

## Quick start

```yaml
services:
  darkroom:
    image: jaap14/darkroom-log:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      APP_PASSWORD: change-me
      SESSION_SECRET: generate-with-openssl-rand-base64-24
      IMMICH_URL: http://your-immich-host:2283/api
      IMMICH_KEY: your-immich-api-key
    volumes:
      - ./data:/data
      - ./music:/music   # optional, for slideshow background music
```

```sh
docker compose up -d
```

Then open `http://localhost:3000` and sign in with `APP_PASSWORD`.

## Configuration

| Variable | Required | Description |
|---|---|---|
| `APP_PASSWORD` | yes | Login password |
| `SESSION_SECRET` | yes | Random secret for session signing |
| `IMMICH_URL` | yes | Immich API URL e.g. `http://192.168.0.10:2283/api` |
| `IMMICH_KEY` | yes | Immich API key |
| `BRAND_NAME` | no | Public album header brand name (e.g. `Your Name Photography`) |
| `BRAND_URL` | no | Public album header link destination |
| `BRAND_SITE_LABEL` | no | Text shown next to the brand name (e.g. `yourdomain.com ↗`) |
| `CSP_FRAME_ANCESTORS` | no | Space-separated origins allowed to embed `/album/:slug` |

## Volumes

| Path | Description |
|---|---|
| `/data` | Prints database and filter cache |
| `/music` | MP3 files for slideshow music (optional) |

## Tags

- `latest` — current release
- `vX.Y.Z` — pinned release

## Highlights

- Split-grade and single-grade darkroom workflow with session history per print
- Immich library browser with combined text + CLIP search, person/face filters, and chip-based filtering
- Public album galleries with branded header, Ken Burns slideshow, and iframe-embed support
- A+ security score: CSP without `unsafe-inline`, login rate limiting, HSTS, full security headers
- Mobile/PWA: install to home screen, swipe gestures, no browser chrome
