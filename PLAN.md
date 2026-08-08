# Agent Office — plan

## Shipped (v1)

- Static multi-agent office UI (HTML/CSS/JS, no build step)
- Mock simulator (`sim.js`) drives walk / coding / review / break / blocked
- Data: `office.json` (desks), `agents.json` (roster)
- Repo: https://github.com/shadeacademia/agent-office
- Live (Pages): https://office.shadeacademia.net  
  Also: https://agent-office-web.pages.dev  
  Legacy Worker: https://agent-office.shadeacademy.workers.dev
- Host: **Cloudflare Pages** (Git `shadeacademia/agent-office`, empty build, output `/`)
- Custom domain: **done** — Squarespace CNAME `office` → `agent-office-web.pages.dev`

## Non-goals for v1

- Real multi-agent backends
- Auth, database, API keys in the browser
- Image/video generation pipeline
- Full LLM answers on the public URL

## North star (v2 product story)

**One** local agent (Ollama). The public office is a **status board**, not a chat UI.

- You talk to him in **Open WebUI** and/or **Telegram** (full prompt + full reply stay there).
- The floor only shows **phase + short public blurb** (never the full response body).
- When idle: he sits **Break**.
- When a job runs: he walks **Terminal → Research → Compose → Break**.

Chat apps = conversation. Office = “what phase is he in?”

### Public `message` policy

| Place | What shows |
|-------|------------|
| Open WebUI / Telegram | Full prompt, full answer, tools, history |
| Office bubble / activity feed | Short status only, e.g. “Got a prompt”, “Researching…”, “Replied — see chat”, “On break” |

No need for the office to **differentiate** response *content* — Compose is always the same *kind* of public line (“done / replied”), not a second copy of the answer. One template is enough; optional later: truncated topic tag if you ever want it (`Replied about DNS`) without pasting the reply.

---

## Floor plan sketch (v2 desks)

Replace the generic Frontend/Backend/… labels when implementing layout. Positions can stay rough; ids matter for events.

```json
{
  "name": "Grok Works",
  "width": 960,
  "height": 540,
  "desks": [
    { "id": "desk-terminal", "label": "Terminal", "x": 160, "y": 200 },
    { "id": "desk-research", "label": "Research", "x": 400, "y": 200 },
    { "id": "desk-compose",  "label": "Compose",  "x": 640, "y": 200 },
    { "id": "desk-break",    "label": "Break",    "x": 400, "y": 360 }
  ],
  "spawn": { "x": 80, "y": 480 },
  "coffee": { "x": 860, "y": 120 }
}
```

| id | Label | Meaning |
|----|--------|---------|
| `desk-terminal` | Terminal | Prompt received / job accepted |
| `desk-research` | Research | Web search / tools / “looking it up” |
| `desk-compose` | Compose | Formulating reply (public: “replied”, not the text) |
| `desk-break` | Break | Idle / not in a job |

Optional later: keep extra decorative desks; v2 only needs this circuit.

### Roster sketch (one real body first)

Mock cast can remain for demo mode. For the live Ollama loop, drive **one** agent, e.g.:

```json
{
  "id": "ollie",
  "name": "Ollie",
  "role": "Local LLM",
  "color": "#7dd3fc",
  "homeDesk": "desk-break"
}
```

Name/id TBD — home desk = **Break**.

---

## Job circuit (event sequence)

Same event shape as before; `target` is which desk to walk to.

```json
{
  "ts": 1710000000,
  "agentId": "ollie",
  "type": "status",
  "state": "walk",
  "message": "Heading to terminal…",
  "target": "desk-terminal",
  "nextState": "coding"
}
```

States (UI): `idle | walk | coding | review | break | blocked`  
(Reuse existing renderer states; map pipeline phases onto them.)

### Happy path

| Step | `target` | `state` (after arrive) | Public `message` (examples) |
|------|----------|------------------------|-----------------------------|
| 0 Idle | `desk-break` | `break` | On break |
| 1 Prompt in | `desk-terminal` | `walk` → `coding` | Got a prompt · Standing by at terminal |
| 2 Research | `desk-research` | `walk` → `review` or `coding` | Researching… · Searching the web |
| 3 Compose | `desk-compose` | `walk` → `coding` | Writing a reply… |
| 4 Done | `desk-compose` then `desk-break` | brief `coding` then `break` | Replied — see Open WebUI / Telegram |
| Error | any | `blocked` | Stuck — check the bridge |

`walk` is always the transition; desk id carries the meaning more than inventing new state enums on day one.

### Do not put on the public event

- Full user prompt (optional: first ~40 chars / “topic” later)
- Full model output
- API keys, Telegram tokens, home IPs

---

## Architecture sketch (bridge)

```text
Open WebUI / Telegram  ←→  Ollama (home)
         │
         │  status only (phase transitions)
         ▼
   small bridge on home LAN (or existing telegram bridge pattern)
         │
         │  POST public events
         ▼
   Cloudflare (Pages Function + KV, or Worker)
         │
         ▼
   office.shadeacademia.net  (poll / SSE — public status board)
```

- Browser never calls Ollama or holds secrets.
- Bridge can be dumb: on job start/end/tool-phase, POST one status event.
- Research phase can be **real** search later or **timed theater** until tools are wired.

---

## v2 implementation sessions (updated)

| Session | Scope |
|---------|--------|
| ~~D~~ | ~~Domain~~ **done** (`office.shadeacademia.net`) |
| ~~A~~ | **done:** desks, Ollie circuit sim, `events.js` adapter, sim fallback |
| ~~B~~ | **done (code):** `GET/POST /api/events` + KV ring, ingest token, poll cursor, `scripts/demo-circuit.sh` — **you still bind KV + INGEST_TOKEN in the dashboard** |
| C | Bridge: one Ollama job → emit circuit; chat stays in OWUI/Telegram |

Prefer short sessions over one infinite thread.

## v3 (only if addicted)

- Multiple real producers / multi-agent status
- Persistence (who did what last week)
- Auth if the feed shouldn’t be public
- Richer public teasers (topic tags) without full text

## Decisions to keep

- Squarespace = DNS only; app on **Cloudflare Pages**
- Subdomain `office.shadeacademia.net` for the app
- Mock sim stays as offline/demo fallback even after v2
- **One** real agent first; circuit = Terminal → Research → Compose → Break
- **Compose** desk name locked
- Full replies **not** on the public URL; office messages are phase status only (no need to vary by answer content)
- Chat surface = Open WebUI and/or Telegram
