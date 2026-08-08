# Scene / background

Pixel night-office backdrop for **Ollie's Office** (logical floor 540×960).

| File | Use |
|------|-----|
| `room.png` | Full room: walls, night window, wall lamps, door, open carpet |
| `carpet-tile.png` | 64×64 seamless carpet (fallback if `room.png` fails) |
| `_carpet-2x2-check.png` | Seam check only (not used in UI) |

Wired as `#floor` `background-image` in `styles.css`. Override path with `office.json` `"scene"` if needed.
