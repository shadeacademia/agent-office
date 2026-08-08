# Ollie's Office

Pixel night-office **status board** for a local agent. Pure static HTML/CSS/JS (no build step). Full chat stays in Open WebUI / Telegram — the floor only shows short public phases.

**Live:** https://office.shadeacademia.net

## What you see

Portrait office with four stations and a coffee machine:

**Terminal → Research → Compose → Break**

| Who | Role |
|-----|------|
| **Ollie** | Primary local LLM — real jobs from the bridge; stays on break when quiet |
| **Grok** | Visiting AI (ambient wander) |
| **Nova** / **Byte** | Ambient cast so the floor isn’t empty |

**Get coffee** (header): sends Ollie to the machine — only while he is on break. Ambient agents may visit coffee on their own; Ollie does not auto-wander.

Public bubbles and the activity feed are **status only** (e.g. “Got a prompt”, “Researching…”, “On break”). Never full prompts or model replies.

## Local preview

```bash
cd agent-office
python3 -m http.server 8080
# open http://localhost:8080
```

ES modules need HTTP — don’t open `index.html` as `file://`.

### Feed modes

| URL | Behavior |
|-----|----------|
| default | Idle theater; if `/api/events` is healthy on Pages, live jobs layer on top |
| `?idle=1` | Idle only (no live probe) |
| `?live=1` | Always poll the API |
| `?demo=1` or `?sim=1` | Fake job circuit for show-and-tell (not real work) |

**Idle:** Nova, Byte, and Grok wander. Ollie stays at Break until a real live phase or **Get coffee**.

## Live status API

| Method | Path | Who |
|--------|------|-----|
| `GET` | `/api/events` | Browser (public) |
| `POST` | `/api/events` | Bridge only — `Authorization: Bearer <INGEST_TOKEN>` |

Messages are capped (~120 chars). Do not POST full LLM output.

### Post from your machine

```bash
export OFFICE_URL=https://office.shadeacademia.net
export INGEST_TOKEN='your-secret'   # never commit this

chmod +x scripts/*.sh
./scripts/post-status.sh ollie desk-terminal coding "Got a prompt"
./scripts/demo-circuit.sh           # sample full circuit
```

Token can also live in **`.local/ingest_token`** (gitignored). See `.local/` only on the machine that runs the bridge — not in the repo.

### Cloudflare (one-time)

Pages project **agent-office-web**:

1. KV namespace bound as `EVENTS`
2. Production secret `INGEST_TOKEN` (long random string)
3. Deploy from `main`: empty build, output `/`, Functions `./functions`
4. Custom domain `office.shadeacademia.net` → `agent-office-web.pages.dev`

`wrangler.toml` holds the Pages/KV binding config. Secrets stay in the dashboard / `.local/`, not in git.

## Local bridge

Public site only gets **phase** lines.

### CLI (Ollama → office)

```bash
cd agent-office
# reads .local/ingest_token when present
python3 bridge/run_job.py "Summarize what a reverse proxy is in one sentence."
python3 bridge/run_job.py --research "Who is the mayor of Melbourne?"
python3 bridge/office_status.py break
```

### Telegram

If `telegram-openwebui-bridge` loads `bridge/office_status.py`, it can post:

| When | Public phase |
|------|----------------|
| New allowed chat message | Got a prompt (Terminal) |
| Local web search | Researching… |
| Before model reply | Writing a reply… |
| After Telegram send | Replied — see chat → On break |
| Model error | Stuck → On break |

Disable with `OFFICE_STATUS=0`. Token from `.local/ingest_token`, not from the bot config.

## Project layout

| Path | Role |
|------|------|
| `index.html` / `styles.css` / `app.js` | Shell, floor UI, animation |
| `sim.js` | Idle theater (+ optional demo circuit) |
| `events.js` | Event schema + poll adapter |
| `office.json` | Layout, desks, coffee, station bounds |
| `agents.json` | Roster (Ollie, Grok, Nova, Byte) |
| `assets/` | Pixel furniture, agents, room backdrop |
| `functions/api/events.js` | GET/POST status API (KV) |
| `bridge/` | Local Ollama / status POSTs |
| `scripts/` | `post-status.sh`, `demo-circuit.sh` |
| `favicon.*` | Ollie tab icons |

## Privacy / public repo notes

- **Safe to open-source** the app code as shipped: no ingest token or Cloudflare API credentials are committed.
- Keep **`.local/`** and **`*.env.local`** private on the host that runs the bridge.
- The public board is intentionally a status surface only; treat `INGEST_TOKEN` like any other write credential.
