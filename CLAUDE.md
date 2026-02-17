# CLAUDE.md — GaggiMate Notion Bridge

## What This Is
A Node.js bridge service (Docker on TrueNAS) that sits between a GaggiMate espresso machine and Notion.
Two data flows:
1. **Shots out:** Polls GaggiMate for new shots, auto-logs to Notion Brews DB
2. **Profiles in:** Reconciles Notion profile state to GaggiMate and handles queued pushes from webhook events

## Project Structure
```
src/
  index.ts              — Entry point: starts HTTP server + pollers
  config.ts             — Environment config (dotenv)
  gaggimate/
    client.ts           — WebSocket/HTTP client for GaggiMate API
    types.ts            — GaggiMate type definitions
  notion/
    client.ts           — Notion API wrapper (Brews, Profiles, Beans)
    types.ts            — Notion DB schema types
    mappers.ts          — Shot data → Notion properties conversion
  http/
    server.ts           — Express app setup
    routes/health.ts    — GET /health
    routes/webhook.ts   — POST /webhook/notion
  sync/
    shotPoller.ts       — Background loop: GaggiMate → Notion
    profileReconciler.ts — Background loop: Notion ↔ GaggiMate profile reconciliation
    profilePush.ts      — Shared profile push logic (webhook + reconciler)
    state.ts            — Sync state persistence (JSON file)
  parsers/
    binaryIndex.ts      — Parses index.bin shot history (from upstream)
    binaryShot.ts       — Parses .slog shot files (from upstream)
  transformers/
    shotTransformer.ts  — Binary → AI-friendly JSON (from upstream)
```

## Key Commands
```bash
npm run build          # TypeScript compilation
npm run dev            # Development with tsx
npm start              # Production (compiled JS)
docker compose up      # Run with Docker
```

## Architecture Notes
- **No MCP protocol** — plain HTTP service + background pollers
- Parsers and transformers are preserved from the upstream fork (Matvey-Kuk/gaggimate-mcp)
- GaggiMate API: WebSocket for profiles/notes, HTTP for shot binary files
- Notion is the entire UI — no separate frontend
- Sync state persists to `/app/data/sync-state.json` in Docker
- Profile management is driven by `ProfileReconciler` status semantics (`Draft`, `Queued`, `Pushed`, `Archived`, `Failed`)

## Important Conventions
- Shot dedup key: `Activity ID` property in Notion Brews DB = GaggiMate shot ID
- Profile push: validates temperature 60-100°C, requires phases array
- Profile saves normalize phase defaults before send (`valve`, `pump.target`, `pump.pressure`, `pump.flow`)
- Per-shot failure isolation — one bad shot doesn't stop the poller
- All Notion writes are system-owned fields only; user fields never overwritten

## Testing
- `curl http://localhost:3000/health` — health check
- Set `PROFILE_RECONCILE_ENABLED=true` to keep profile sync active without relying on webhooks
