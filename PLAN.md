# Agent Office — plan

## Shipped (v1)

- Static multi-agent office UI (HTML/CSS/JS, no build step)
- Mock simulator (`sim.js`) drives walk / coding / review / break / blocked
- Data: `office.json` (desks), `agents.json` (roster)
- Repo: https://github.com/shadeacademia/agent-office
- Live: https://agent-office.shadeacademy.workers.dev
- Host: Cloudflare Pages (or Workers static) — empty build, output `/`
- Custom domain: deferred (Squarespace DNS/CNAME later, e.g. `office.<domain>`)

## Non-goals for v1

- Real multi-agent backends
- Auth, database, API keys in the browser
- Image/video generation pipeline

## v2 (next)

**Goal:** keep the same office UI; replace or feed `sim.js` with a **real event stream**.

1. Freeze a tiny event schema (already roughly this shape):

   ```json
   {
     "ts": 1710000000,
     "agentId": "rex",
     "type": "status",
     "state": "coding",
     "message": "Fixing the login bug",
     "target": "desk-3"
   }
   ```

   States: `idle | walk | coding | review | break | blocked`

2. Add a thin ingest path (pick one):
   - **SSE** or **WebSocket** from a small Cloudflare Worker
   - Or poll `events.json` for the cheapest experiment

3. Map real work → events (one producer first — not five agents on day one):
   - Manual “nudge” / webhook
   - CI / deploy hooks
   - Optional later: Grok Build / agent tool lifecycle

4. Do **not** put secrets in the frontend. Worker holds tokens; browser only gets public events.

5. Optional polish: custom sprites in `assets/`, rename agents, mobile layout pass.

## v3 (only if addicted)

- Multiple real producers / multi-agent status
- Persistence (who did what last week)
- Auth if the feed shouldn’t be public

## Token-thrifty session plan

| Session | Scope |
|---------|--------|
| A | Event schema + adapter in `app.js` (sim still fallback) |
| B | Worker (or static `events.json`) producing sample events |
| C | One real producer wired |
| D | Domain CNAME when Squarespace login works |

Prefer short sessions over one infinite thread.

## Decisions to keep

- Squarespace = DNS/domain only; app stays on Cloudflare
- Subdomain preferred over replacing the main marketing site
- Mock sim stays as offline/demo fallback even after v2
