# Agent Office (v1)

Tiny animated multi-agent office UI. **Pure static files** — no build step, no API keys in the browser.

**Live:** https://office.shadeacademia.net

v2 floor story: **Terminal → Research → Compose → Break** (Ollie). Public bubbles are **status only** — full chat stays in Open WebUI / Telegram.

Mock sim runs by default. Optional live feed: put events in `events.json` or open with `?live=1`.

## Local

```bash
cd agent-office
python3 -m http.server 8080
# open http://localhost:8080
```

Default = **mock sim** (Ollie circuit). Functions/KV only run on Cloudflare Pages.

> ES modules need HTTP — don’t open `index.html` as `file://`.

## Live status API (Session B)

| Method | Path | Who |
|--------|------|-----|
| `GET` | `/api/events` | Browser (public) |
| `POST` | `/api/events` | Bridge only — needs `INGEST_TOKEN` |

### One-time Cloudflare setup

1. **KV** → create namespace (e.g. `OFFICE_EVENTS`)
2. Pages project **agent-office-web** → **Settings** → **Functions** → **KV namespace bindings**
   - Variable name: `EVENTS`
   - Namespace: the one you created
3. **Settings** → **Environment variables** (Production) → add secret:
   - Name: `INGEST_TOKEN`
   - Value: long random string (not committed to git)
4. Redeploy if bindings were added after last deploy

### Post a status (from your machine)

```bash
export OFFICE_URL=https://office.shadeacademia.net
export INGEST_TOKEN='your-secret'

chmod +x scripts/*.sh
./scripts/post-status.sh ollie desk-terminal coding "Got a prompt"
# full mock job:
./scripts/demo-circuit.sh
```

Open the site; when `/api/events` is healthy it auto-uses **live** feed. Force modes:

- `?sim=1` — always mock  
- `?live=1` — always API  

Messages are capped (~120 chars). Full LLM replies never belong in POST bodies.

## Cloudflare Pages deploy

Git on `main` → project **agent-office-web**:

- Framework: None  
- Build command: empty  
- Output directory: `/`  
- Functions: `./functions`

Custom domain: `office.shadeacademia.net` → CNAME `agent-office-web.pages.dev` (Squarespace).

## Project layout

| File | Role |
|------|------|
| `index.html` | Shell |
| `styles.css` | UI + floor |
| `app.js` | Render + animation loop |
| `sim.js` | Mock circuit simulator |
| `events.js` | Event schema + poll adapter |
| `functions/api/events.js` | GET/POST status API (KV) |
| `office.json` | Desks / layout |
| `agents.json` | Characters (Ollie, Nova, Byte) |
| `scripts/` | `post-status.sh`, `demo-circuit.sh` |

## Local bridge (Session C)

Public site only gets **phase** lines. Full answers stay in the terminal, Open WebUI, or Telegram.

### CLI job (Ollama → office circuit)

```bash
cd agent-office
# uses .local/ingest_token automatically
python3 bridge/run_job.py "Summarize what a reverse proxy is in one sentence."
python3 bridge/run_job.py --research "Who is the mayor of Melbourne?"  # visits Research desk
python3 bridge/office_status.py break   # single phase
```

### Telegram → office

The running user service `telegram-openwebui-bridge` loads `bridge/office_status.py` and posts:

| When | Public phase |
|------|----------------|
| New allowed chat message | Got a prompt (Terminal) |
| Local web search | Researching… |
| Before model reply | Writing a reply… |
| After Telegram send | Replied — see chat → On break |
| Model error | Stuck → On break |

Disable: `OFFICE_STATUS=0` on the service. Token is read from `agent-office/.local/ingest_token` (not from the bot).