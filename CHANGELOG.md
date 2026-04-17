# Changelog

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
