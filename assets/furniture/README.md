# Furniture sprites (pixel, top-down, tiny night office)

Style lock: 16-bit top-down office props, navy/slate desk wood, cyan/green screen glow, magenta keyed to transparency.

| File | Station | Notes |
|------|---------|--------|
| `desk-terminal.png` | Terminal | Green CRT + tower PC |
| `desk-research.png` | Research | Dual monitors, books, magnifier |
| `desk-compose.png` | Compose | Warm doc screen, notebook, mug |
| `desk-break.png` | Break | Bean bag + side table + plant |
| `prop-coffee.png` | Coffee corner | Machine + steaming cup |
| `_style-anchor.png` | — | Style reference only (not used in UI) |

Display sizes: desks **96×80**, coffee **56×56**. CSS uses `image-rendering: pixelated`.

Raw Imagine outputs (pre-key) live in `../_raw/` for reprocessing.

Loader expects `./assets/furniture/{desk.id}.png` (see `app.js`).
