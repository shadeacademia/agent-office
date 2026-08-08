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

Or: `npx --yes serve .`

> ES modules need HTTP — don’t open `index.html` as `file://`.

## Cloudflare Pages deploy

### A) Direct upload (fastest)

1. [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** → **Upload assets**
2. Project name: e.g. `agent-office`
3. Upload the contents of this folder (`index.html`, `*.js`, `*.css`, `*.json`, `assets/`)
4. Deploy → open the `*.pages.dev` URL

### B) Git (better for updates)

1. Push this folder to a GitHub repo
2. Pages → **Connect to Git** → select repo
3. Build settings:
   - **Framework preset:** None
   - **Build command:** *(leave empty)*
   - **Build output directory:** `/`
4. Save and deploy

### Custom domain (Squarespace DNS)

1. Pages project → **Custom domains** → add `office.yourdomain.com`
2. Cloudflare shows a **CNAME** target (usually `your-project.pages.dev`)
3. In **Squarespace** → Domains → your domain → DNS:
   - Type: `CNAME`
   - Host: `office`
   - Target: the value Cloudflare showed
4. Wait for DNS + SSL, then visit `https://office.yourdomain.com`

Keep your main Squarespace site on `www`; use the subdomain for this app.

## Project layout

| File | Role |
|------|------|
| `index.html` | Shell |
| `styles.css` | UI + floor |
| `app.js` | Render + animation loop |
| `sim.js` | Mock task simulator |
| `office.json` | Desks / layout |
| `agents.json` | Characters |

## Later (v2 ideas)

- Replace `sim.js` with Server-Sent Events / websocket feed
- Custom sprites in `assets/`
- Don’t put secrets in the frontend
