# Agent sprites (pixel chibi robots)

Cute cyan-family night-office bots. Ollie is the painted base; Grok / Nova / Byte are palette swaps.
Live bodies (Ollie, Grok) use the same state sprites; only ambient agents wander in idle mode.

| State file stem | Runtime `state` |
|-----------------|-----------------|
| `idle` | `idle` |
| `walk` | `walk` |
| `work` | `coding` |
| `review` | `review` |
| `break` | `break` |
| `blocked` | `blocked` |

Paths: `assets/agents/{agentId}-{stem}.png` (48×48, transparent).

| Agent | Color | Role |
|-------|-------|------|
| `ollie` | cyan `#7dd3fc` | Primary (real jobs + break) |
| `grok` | violet `#c4b5fd` | Visiting AI (ambient) |
| `nova` | pink `#f9a8d4` | Ambient |
| `byte` | green `#86efac` | Ambient |

Raw Imagine sources: `assets/_raw/agents/`.
