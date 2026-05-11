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

## What's new in v1.5.43

- **Server-side sized share** — the Share button now goes through `sharp` + mozjpeg on the server with JPEG quality iterated to a byte target. Sizes: **S** (≤500 KB / 1200 px) for SMS, **M** (≤1.5 MB / 2400 px) for messaging, **L** (≤2.7 MB / 4200 px — hard-capped for forum uploads), **XL** (full original Q100). Encoded outputs are disk-cached keyed by Immich `updatedAt` so a Lightroom republish auto-invalidates.
- **Two-step share modal** — Safari iOS revoked `navigator.share()` activation when the fetch took too long; the share button now opens a "Preparing image…" modal first and flips to "Tap to share" once the blob is ready. Desktop falls back to a Blob-URL save-to-disk with the same spinner.
- **Tiered progressive image loading** — detail and fullscreen views load thumbnail → small → preview → original on mobile (preview → original on desktop). Each tier swaps in as the next preloads; stale upgrades are dropped on navigation.
- **Race-free navigation** — nav-generation counter drops async results from superseded navigations; 400 ms cooldown prevents accidental double-skip from a stray click + swipe.
- **Phone-landscape detail view** — image full-width on top, metadata below, tab bar hidden, header pinned to the bottom of the viewport so Back is always reachable.
- **iOS double-tap fix** — synthetic clicks fired ~300 ms after a touch double-tap no longer leak into the fullscreen viewer's prev/next/close logic.
- **Force Refresh button (🔄)** in the detail view — one-tap SW cache flush + reload escape hatch.
- **Public album viewer parity** — public `/album/<slug>` fullscreen now uses the same `zoom.js` controller as the main app (pinch / wheel / drag-pan / double-tap-toggle to 2.5×) plus 2-stage progressive load. Hi-res originals actually decode now (CSS `will-change` trap fixed).
- **Library shift-click range select**, archive/delete-disappear-from-grid fixes, "share already in progress" alert suppressed, archived/trashed photos no longer reappear after a refetch.

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
