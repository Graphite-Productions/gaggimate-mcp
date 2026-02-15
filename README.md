# GaggiMate Notion Bridge

Bridge service between a [GaggiMate](https://github.com/jniebuhr/gaggimate) espresso machine and [Notion](https://notion.so) for persistent shot logging and AI-assisted profile management.

Forked from [Matvey-Kuk/gaggimate-mcp](https://github.com/Matvey-Kuk/gaggimate-mcp) — we reuse the binary shot parsers and WebSocket patterns, but replace the MCP protocol with a standalone HTTP service.

## What It Does

- **Auto-logs shots** — Polls GaggiMate every 30s for new shots, creates entries in your Notion Brews database with brew time, temperature, pressure, weight, and profile name
- **Pushes profiles** — When you (or Notion AI) set a profile's Push Status to "Queued" in Notion, the service pushes it to the GaggiMate within seconds
- **Reconciles profiles from machine** — Imports missing profiles, updates machine-changed profiles in Notion, marks machine-present as `Pushed`, marks machine-missing as `Active on Machine = false`, and never deletes Notion history
- **Generates profile charts** — Auto-attaches a pressure/flow chart image to `Profile Image` for imported machine profiles when missing
- **Backfills brew/profile links** — Automatically links existing brews to profiles when `Activity ID` + shot metadata identifies the profile
- **Survives firmware updates** — Shot history on the ESP32 gets wiped by OTA updates; Notion is the permanent record

## Architecture

```
GaggiMate (ESP32) ←→ Bridge Service (Docker) ←→ Notion (Cloud)
```

- **Bridge** runs on TrueNAS SCALE (or any Docker host on the LAN)
- **Notion** is the entire UI — browse shots, tag beans, ask Notion AI for dial-in advice
- **Tailscale Funnel** exposes the webhook endpoint for real-time profile push

## Quick Start

```bash
# Clone and install
git clone https://github.com/coltbradley/gaggimate-mcp.git
cd gaggimate-mcp
npm install

# Configure
cp .env.example .env
# Edit .env with your GaggiMate IP, Notion API key, and database IDs

# Run in development
npm run dev

# Or with Docker
docker compose up --build
```

## Environment Variables

Copy `.env.example` to `.env` and fill in your values. Never commit `.env` — it contains secrets.

| Variable | Description | Default |
|---|---|---|
| `GAGGIMATE_HOST` | GaggiMate IP address | `localhost` |
| `NOTION_API_KEY` | Notion integration token (starts with `ntn_`) | required |
| `NOTION_BEANS_DB_ID` | Notion Beans database ID | required |
| `NOTION_BREWS_DB_ID` | Notion Brews database ID | required |
| `NOTION_PROFILES_DB_ID` | Notion Profiles database ID | required |
| `SYNC_INTERVAL_MS` | Shot polling interval (ms) | `30000` |
| `RECENT_SHOT_LOOKBACK_COUNT` | Number of recent shots to re-hydrate/update each poll | `5` |
| `BREW_TITLE_TIMEZONE` | Timezone used for brew title AM/PM labels | `America/Los_Angeles` |
| `POLLING_FALLBACK` | Poll Notion for queued profiles | `true` |
| `PROFILE_POLL_INTERVAL_MS` | Queued profile poll interval (ms) | `3000` |
| `PROFILE_IMPORT_ENABLED` | Import profiles from GaggiMate | `true` |
| `PROFILE_IMPORT_INTERVAL_MS` | Profile import polling interval (ms) | `60000` |
| `WEBHOOK_SECRET` | Notion webhook signature verification | optional |

## Security

- **Never commit API keys.** Use `.env` (gitignored) or environment variables. See [Notion's API key best practices](https://developers.notion.com/guides/resources/best-practices-for-handling-api-keys).
- If a key is compromised: revoke it in [Notion integrations](https://www.notion.so/my-integrations), generate a new one, and rotate in all environments.

## API

- `GET /health` — Service status, GaggiMate/Notion connectivity, last sync info
- `POST /webhook/notion` — Receives Notion webhooks for profile push

Profile JSON validation rules: [`docs/mcp-json-validation.md`](docs/mcp-json-validation.md)

## Notion Databases

Three databases, fully interlinked:
- **Beans** — Each bag of beans you buy
- **Brews** — Every shot, auto-populated by the bridge
- **Profiles** — Pressure profiles with push-to-machine capability

See [`docs/SETUP.md`](docs/SETUP.md) for complete setup instructions including Notion database schemas, environment configuration, and deployment options.

See [`docs/PRD.md`](docs/PRD.md) for the full product requirements document.

## Development

```bash
npm install
npm run dev          # Start with tsx (hot reload)
npm test             # Run tests
npm run typecheck    # Type check without emitting
npm run build        # Compile TypeScript
```

Tests run automatically on push and PR via GitHub Actions (Node 18, 20, 22).
