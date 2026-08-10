# Ollie's Office

Pixel night-office **status board** for live agents. Pure static HTML/CSS/JS (no build step). Full chat stays in Open WebUI / Telegram / Grok Build — the floor only shows short public phases.

**Live:** https://office.shadeacademia.net

## What you see

Portrait office with four stations and a coffee machine:

**Terminal → Research → Compose → Break**

| Who | Role |
|-----|------|
| **Ollie** | Local LLM — real jobs from Telegram / Open WebUI bridge; stays on break when quiet |
| **Grok** | Grok Build — same circuit, driven by local hooks while you use Grok |
| **Nova** / **Byte** | Ambient cast so the floor isn’t empty |

**Get coffee** (header): sends a live agent on break (Ollie first, else Grok) to the machine. Ambient agents may visit coffee on their own; live agents do not auto-wander.

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

**Idle:** Nova and Byte wander. Ollie and Grok stay at Break until a real live phase or **Get coffee**.

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
python3 bridge/office_status.py -a grok terminal   # drive Grok body
```

### Telegram (Ollie)

If `telegram-openwebui-bridge` loads `bridge/office_status.py`, it can post:

| When | Public phase |
|------|----------------|
| New allowed chat message | Got a prompt (Terminal) |
| Local web search | Researching… |
| Before model reply | Writing a reply… |
| After Telegram send | Replied — see chat → On break |
| Model error | Stuck → On break |

Disable with `OFFICE_STATUS=0`. Token from `.local/ingest_token`, not from the bot config.

### Grok Build (Grok body)

Same circuit as Ollie, posted as `agentId: "grok"`:

| When | Public phase |
|------|----------------|
| Session start / end | On break |
| User prompt | Got a prompt (Terminal) |
| Web / X research tools | Researching… |
| Other tools (edit, shell, …) | Working… (Compose) |
| Turn ends cleanly | Replied — see Grok → On break |
| Turn API error | Stuck → On break |

**Install (once per machine):**

```bash
cd agent-office
./scripts/install-grok-hooks.sh
# writes ~/.grok/hooks/agent-office.json → bridge/grok_office_hook.py
```

Uses the same `INGEST_TOKEN` as Ollie (`.local/ingest_token` or env). Disable with `OFFICE_STATUS=0`. Optional: `OFFICE_AGENT_ID=grok` (default for the hook), `OFFICE_HOOK_DEBUG=1` for stderr logs.

After install, restart Grok (or open a new session) so hooks load — check `/hooks`.

## Project layout

| Path | Role |
|------|------|
| `index.html` / `styles.css` / `app.js` | Shell, floor UI, animation |
| `sim.js` | Idle theater (+ optional demo circuit) |
| `events.js` | Event schema + poll adapter |
| `office.json` | Layout, desks, coffee, station bounds |
| `agents.json` | Roster — `live: true` = real jobs (Ollie, Grok); others ambient |
| `assets/` | Pixel furniture, agents, room backdrop |
| `functions/api/events.js` | GET/POST status API (KV) |
| `bridge/` | Ollama CLI, status POSTs, Grok Build hook |
| `bridge/grok_office_hook.py` | Maps Grok lifecycle events → Grok floor phases |
| `scripts/` | `post-status.sh`, `demo-circuit.sh` |
| `favicon.*` | Ollie tab icons |

## Privacy / public repo notes

- **Safe to open-source** the app code as shipped: no ingest token or Cloudflare API credentials are committed.
- Keep **`.local/`** and **`*.env.local`** private on the host that runs the bridge.
- The public board is intentionally a status surface only; treat `INGEST_TOKEN` like any other write credential.
