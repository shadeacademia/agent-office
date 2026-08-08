/**
 * Event schema + live feed adapter.
 *
 * Public event shape (status board only — never full LLM replies):
 * {
 *   ts: number,
 *   agentId: string,
 *   type: "status",
 *   state: "idle" | "walk" | "coding" | "review" | "break" | "blocked",
 *   message: string,   // short public blurb
 *   target?: string,   // desk id
 *   targetX?: number,
 *   targetY?: number,
 *   nextState?: string,
 *   teleport?: boolean
 * }
 */

const STATES = new Set(["idle", "walk", "coding", "review", "break", "blocked"]);

/** @param {unknown} raw */
export function normalizeEvent(raw, deskById = {}) {
  if (!raw || typeof raw !== "object") return null;
  const e = /** @type {Record<string, unknown>} */ (raw);
  const agentId = String(e.agentId || "");
  if (!agentId) return null;

  const state = STATES.has(/** @type {string} */ (e.state))
    ? /** @type {string} */ (e.state)
    : "idle";
  const nextState = STATES.has(/** @type {string} */ (e.nextState))
    ? /** @type {string} */ (e.nextState)
    : state;

  const target = e.target != null ? String(e.target) : undefined;
  const desk = target ? deskById[target] : undefined;

  return {
    ts: typeof e.ts === "number" ? e.ts : Date.now(),
    agentId,
    type: e.type === "status" ? "status" : "status",
    state,
    message: e.message != null ? String(e.message) : "",
    target,
    targetX: typeof e.targetX === "number" ? e.targetX : desk?.x,
    targetY: typeof e.targetY === "number" ? e.targetY : desk?.y,
    nextState,
    teleport: Boolean(e.teleport),
  };
}

/**
 * Poll a JSON URL that is either an array of events or { events: [...] }.
 * Returns a controller { stop }.
 */
export function createJsonPollSource({
  url = "./events.json",
  intervalMs = 2000,
  desks = [],
  onEvent,
  onStatus,
}) {
  const deskById = Object.fromEntries(desks.map((d) => [d.id, d]));
  let lastKey = "";
  let timer = null;
  let stopped = false;

  async function tick() {
    if (stopped) return;
    try {
      const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.events || [];
      const key = JSON.stringify(list);
      if (key === lastKey) {
        onStatus?.({ ok: true, mode: "live", detail: "polling" });
        return;
      }
      lastKey = key;
      for (const raw of list) {
        const ev = normalizeEvent(raw, deskById);
        if (ev) onEvent(ev);
      }
      onStatus?.({ ok: true, mode: "live", detail: `applied ${list.length}` });
    } catch (err) {
      onStatus?.({ ok: false, mode: "live", detail: String(err.message || err) });
    }
  }

  tick();
  timer = setInterval(tick, intervalMs);

  return {
    mode: "live",
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

/**
 * Prefer live feed when ?live=1 or ?source=live, or when events.json exists and ?sim!=1.
 * Default: mock sim (safe offline demo).
 */
export async function resolveFeedMode() {
  const params = new URLSearchParams(location.search);
  if (params.get("sim") === "1") return "sim";
  if (params.get("live") === "1" || params.get("source") === "live") return "live";
  if (params.get("sim") === "0") return "live";
  // Auto: use live only if events.json is present and non-empty
  try {
    const res = await fetch("./events.json", { cache: "no-store" });
    if (!res.ok) return "sim";
    const data = await res.json();
    const list = Array.isArray(data) ? data : data.events || [];
    if (list.length > 0) return "live";
  } catch {
    /* stay on sim */
  }
  return "sim";
}
