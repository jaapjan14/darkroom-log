# Darkroom Log

A self-hosted darkroom printing log and analog photo library, built for Immich integration.

![Darkroom Log Screenshot](screenshot.png)

![Library View](screenshot2.png)

## Features

### Prints
- Log darkroom print sessions with exposure data, paper, technique, notes
- Split-grade and single-grade workflow support
- Tag filtering and session history per print
- Link prints to Immich photos via EXIF search

### Library
- Browse your full Immich photo library
- Sort by upload date or date taken (ascending/descending)
- **Combined search** — merges Immich text search and CLIP smart search into a single result set, something Immich's native UI doesn't offer
- Search by recognized person/face
- Filter chips: camera, lens, location, people
- **Compose filters** — person, chip, and text/smart search intersect server-side (e.g. "Ruby + Anacortes + 'beach'" returns only photos matching all three)
- Select mode with shift-click range selection

### Albums
- Create curated albums from your Immich library
- Drag-to-reorder photos
- Select and download originals with original filenames
- Shareable public links

### Immich Albums
- Browse your Immich albums as a grid
- **Sort photos by upload date or date taken** — a feature missing from Immich's native album view
- Filter by camera, lens, or location within an album
- Select mode with shift-click range selection
- Add Immich photos directly to Darkroom albums
- Full photo detail (EXIF, map, fullscreen, download, share)

### Slideshow
- **Smooth Ken Burns pan/zoom** — linear motion with no mid-cycle jumps or snap-back artifacts
- Title card with byline and photo count; circular play button to start
- Background music with fade-in; pause/resume synced to slideshow state
- Description overlay, fullscreen (`⤢`), auto-hide controls with mousemove keep-alive
- Swipe down to close; swipe left/right to navigate

### Performance
- **Fast library open** — photo metadata is folded into the initial `/api/immich/recent` response instead of fetched one-asset-at-a-time, so filter chips and search are ready immediately (~1s over a phone connection vs the ~60s an N+1 pattern would cost)
- **Right-sized thumbnails** — grid uses Immich's small thumbnail (~50 KB); detail view uses the 1440 px preview (retina-sharp); full original loads only when you tap to fullscreen
- **Progressive upgrade in detail view** — preview paints instantly, original quietly swaps in after a 400 ms dwell, and rapid navigation cancels the pending upgrade so swiping through photos doesn't waterfall megabytes of originals
- Service-worker-cached thumbnails survive app shell updates (`darkroom-thumbs-v1` cache, FIFO-bounded to 500 entries for iOS Safari quota)

### Mobile & PWA
- Fully responsive — designed and tested on iPhone
- Install to home screen via Safari → **Add to Home Screen** for a native app-like experience
- Runs as a standalone app — no browser chrome, no address bar
- Swipe gestures, tap zones, and smooth animations throughout

### Navigation & Gestures
- Swipe down in any photo detail to go back
- Swipe left/right (or tap edge zones) to navigate prev/next
- Scroll position preserved when opening and closing photos — no flash to top
- Keyboard: arrow keys and ESC work throughout

### Public Album
- Public album page (`/album/:slug`) — no login required, opens directly to slideshow
- **Configurable branded header** — brand name + site link (set via env vars) with inline slideshow button
- **Grid view** — click any photo to open it in a paused single-image view with Ken Burns zoom
- Rich link cards on Substack, iMessage, and social — OG meta tags injected server-side
- Embed in Squarespace, Substack, Webflow, or any iframe (`?embed` hides header)
- Swipe down to close slideshow; swipe left/right to navigate
- Safari and mobile compatible

## Security
- A+ security score (115/100, 10/10 tests)
- CSP: no `unsafe-inline` in script-src
- External JS with comprehensive event delegation
- Login rate limiting (10 attempts / 15 min per IP)
- HSTS, Referrer-Policy, X-Frame-Options, Permissions-Policy

## Requirements

- [Immich](https://immich.app) instance with API access
- Docker + Docker Compose

## Quick Start

```bash
git clone https://github.com/jaapjan14/darkroom-log
cd darkroom-log
cp docker-compose.yml docker-compose.override.yml
# Edit docker-compose.override.yml with your settings
docker compose up -d
```

## Configuration

| Variable | Required | Description |
|---|---|---|
| `APP_PASSWORD` | yes | Login password |
| `SESSION_SECRET` | yes | Random secret for session signing |
| `IMMICH_URL` | yes | Immich API URL e.g. `http://192.168.0.10:2283/api` |
| `IMMICH_KEY` | yes | Immich API key |
| `BRAND_NAME` | no | Public album header brand name (e.g. `Your Name Photography`). Leave blank to hide the brand block. |
| `BRAND_URL` | no | Public album header link destination (e.g. `https://yourdomain.com`) |
| `BRAND_SITE_LABEL` | no | Text shown next to the brand name (e.g. `yourdomain.com ↗`) |
| `CSP_FRAME_ANCESTORS` | no | Space-separated origins allowed to embed `/album/:slug` beyond `'self'`. Example: `https://*.squarespace.com https://*.substack.com` |

## Volumes

| Path | Description |
|---|---|
| `/data` | Prints database and filter cache |
| `/music` | MP3 files for slideshow music (optional) |

## Music

Drop MP3s (or folders of MP3s) into the `/music` volume. They'll appear in the slideshow settings dropdown automatically.

## Public Album Embed

```html
<iframe 
  src="https://your-darkroom.domain/album/your-album-slug?embed"
  width="100%" 
  height="350px" 
  frameborder="0"
  allowfullscreen>
</iframe>
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md)

## Credits

Designed and maintained by [JJ Lakatua](https://lakatua.me) — analog photographer and homelab enthusiast — in collaboration with [Claude](https://claude.ai) by Anthropic.

This project was built through an ongoing human-AI collaboration. JJ provided the vision, domain expertise, testing, and direction. Claude assisted with architecture, implementation, and debugging across multiple sessions.
