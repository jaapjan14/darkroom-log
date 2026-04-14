# Darkroom Log

A self-hosted darkroom print session logger with [Immich](https://immich.app) integration.

Built for analog photographers who want to keep track of enlarger settings, exposure times, paper choices, and dodge/burn notes alongside their scanned negatives.

![Darkroom Log gallery view](screenshot.png)

![Darkroom Log detail view](screenshot2.png)

## Features

- **Immich integration** — search your Immich library to link prints to scans
- **Per-image print sessions** — log multiple print sessions per negative
- **Single grade & split grade** — supports both printing techniques with editable grade labels
- **Camera & film metadata** — pulls EXIF and description from Immich automatically
- **Mobile-friendly** — designed to be used on your phone in the darkroom
- **Password protected** — single password authentication
- **Self-hosted** — all data stored locally in a JSON file

## Requirements

- Docker
- [Immich](https://immich.app) instance with API access

## Quick Start

```bash
docker run -d \
  --name darkroom-log \
  -p 3416:3000 \
  -e APP_PASSWORD=changeme \
  -e SESSION_SECRET=change-this-to-a-random-string \
  -e IMMICH_URL=http://your-immich-host:2283/api \
  -e IMMICH_KEY=your-immich-api-key \
  -v ./data:/data \
  jaap14/darkroom-log:latest
```

## Docker Compose

```yaml
services:
  darkroom:
    image: jaap14/darkroom-log:latest
    container_name: darkroom-log
    ports:
      - 3416:3000
    environment:
      - APP_PASSWORD=changeme
      - SESSION_SECRET=change-this-to-a-random-string
      - IMMICH_URL=http://your-immich-host:2283/api
      - IMMICH_KEY=your-immich-api-key
    volumes:
      - ./data:/data
    restart: unless-stopped
```

## Setup

### 1. Get your Immich API key

In Immich: **Account Settings → API Keys → New API Key**

### 2. Configure environment variables

| Variable | Description |
|----------|-------------|
| `APP_PASSWORD` | Login password for the app |
| `SESSION_SECRET` | Any random string for session encryption |
| `IMMICH_URL` | Your Immich API URL e.g. `http://192.168.1.100:2283/api` |
| `IMMICH_KEY` | Your Immich API key |

### 3. Access

Open `http://localhost:3416` in your browser.

## Data

Print sessions are stored in `/data/prints.json` inside the container. Map this to a host directory to persist your data across container updates.

## Workflow

1. Make a print in the darkroom
2. During the wash, open Darkroom Log on your phone
3. Search for the negative in Immich
4. Log the session — enlarger, lens, paper, exposure, dodge/burn notes
5. Next session, pull up the print to see what worked last time

## Session Fields

- **Date** — auto-fills to today
- **Print size** — e.g. `9x6`, `11x14`
- **Enlarger** — enlarger number
- **Lens** — enlarger lens designation
- **Paper** — dropdown with common papers + custom entry
- **Technique** — Single Grade or Split Grade
- **Single grade** — f/stop, grade/filter, time
- **Split grade** — f/stop, low grade (highlights) + time, high grade (shadows) + time
- **Dodge/burn notes** — free text
- **Additional notes** — free text

## Paper Dropdown

Default papers included:
- Fomabrom Variant 111 Glossy
- Ilford Multigrade FB Classic Glossy
- Ilford Multigrade FB Warmtone Glossy
- Ilford Multigrade RC Deluxe

Select **Other...** to enter any paper name.

## Reverse Proxy

For external access, use a reverse proxy such as [Nginx Proxy Manager](https://nginxproxymanager.com) or [Caddy](https://caddyserver.com), or expose via [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/).

## Docker Hub

[hub.docker.com/r/jaap14/darkroom-log](https://hub.docker.com/r/jaap14/darkroom-log)

## License

MIT
