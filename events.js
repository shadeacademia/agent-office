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

const WORK_DESKS = new Set(["desk-terminal", "desk-research", "desk-compose"]);
/** Live snapshot older than this is treated as already finished — hop home. */
const STALE_JOB_MS = 180_000;

function parkIfStale(raw) {
  if (!raw || typeof raw !== "object") return raw;
  const ts = typeof raw.ts === "number" ? raw.ts : 0;
  const age = Date.now() - ts;
  const atWork = WORK_DESKS.has(String(raw.target || ""));
  const working =
    raw.nextState === "coding" ||
    raw.nextState === "review" ||
    raw.state === "coding" ||
    raw.state === "review";
  if (atWork && working && age > STALE_JOB_MS) {
    return {
      ...raw,
      target: "desk-break",
      state: "break",
      nextState: "break",
      message: "On break",
    };
  }
  return raw;
}

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
    type: "status",
    state,
    message: e.message != null ? String(e.message) : "",
    target,
    targetX: typeof e.targetX === "number" ? e.targetX : desk?.x,
    targetY: typeof e.targetY === "number" ? e.targetY : desk?.y,
    nextState,
    teleport: Boolean(e.teleport),
    job: typeof e.job === "number" ? e.job : 0,
  };
}

/**
 * Poll /api/events (or a static JSON URL).
 * Applies snapshot once, then only events newer than the last seen ts.
 */
export function createJsonPollSource({
  url = "/api/events",
  intervalMs = 2000,
  desks = [],
  onEvent,
  onStatus,
}) {
  const deskById = Object.fromEntries(desks.map((d) => [d.id, d]));
  let lastTs = 0;
  let hydrated = false;
  let timer = null;
  let stopped = false;
  let failCount = 0;

  async function tick() {
    if (stopped) return;
    try {
      const sep = url.includes("?") ? "&" : "?";
      const q = hydrated && lastTs > 0 ? `${sep}since=${lastTs}&t=${Date.now()}` : `${sep}t=${Date.now()}`;
      const res = await fetch(`${url}${q}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.ok === false && data.error === "kv_not_bound") {
        failCount += 1;
        onStatus?.({ ok: false, mode: "live", detail: "kv not bound", fatal: true });
        return;
      }

      const list = Array.isArray(data) ? data : data.events || [];
      const snapshot = data.snapshot || null;

      if (!hydrated) {
        hydrated = true;
        if (snapshot && typeof snapshot === "object" && Object.keys(snapshot).length) {
          for (const raw of Object.values(snapshot)) {
            const parked = parkIfStale(raw);
            const ev = normalizeEvent({ ...parked, teleport: true }, deskById);
            if (ev) {
              onEvent(ev);
              if (ev.ts > lastTs) lastTs = ev.ts;
            }
          }
          onStatus?.({ ok: true, mode: "live", detail: "snapshot" });
        } else if (list.length) {
          for (const raw of list) {
            const ev = normalizeEvent(raw, deskById);
            if (ev) {
              onEvent(ev);
              if (ev.ts > lastTs) lastTs = ev.ts;
            }
          }
          onStatus?.({ ok: true, mode: "live", detail: `history ${list.length}` });
        } else {
          onStatus?.({ ok: true, mode: "live", detail: "empty — waiting" });
        }
        failCount = 0;
        return;
      }

      let n = 0;
      for (const raw of list) {
        const ev = normalizeEvent(raw, deskById);
        if (!ev) continue;
        if (ev.ts <= lastTs) continue;
        onEvent(ev);
        lastTs = Math.max(lastTs, ev.ts);
        n += 1;
      }
      failCount = 0;
      onStatus?.({
        ok: true,
        mode: "live",
        detail: n ? `+${n}` : "polling",
      });
    } catch (err) {
      failCount += 1;
      onStatus?.({
        ok: false,
        mode: "live",
        detail: String(err.message || err),
        failCount,
      });
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
 * Floor feed mode.
 *
 *  - ?demo=1 or ?sim=1 → idle theater + fake job circuit (show-and-tell)
 *  - ?live=1 → always poll /api/events (idle theater still runs underneath)
 *  - ?idle=1 → idle only (no live probe)
 *  - else: if /api/events is healthy → live + idle; else idle only
 *
 * Idle mode never fakes "Got a prompt" — only ambient / break / coffee theater.
 */
export async function resolveFeedMode() {
  const params = new URLSearchParams(location.search);
  if (params.get("demo") === "1" || params.get("sim") === "1") {
    return { mode: "idle", reason: "demo", demo: true };
  }
  if (params.get("idle") === "1") {
    return { mode: "idle", reason: "forced", demo: false };
  }
  if (params.get("live") === "1" || params.get("source") === "live") {
    return { mode: "live", reason: "forced", url: "/api/events", demo: false };
  }
  if (params.get("source") === "json") {
    return { mode: "live", reason: "events.json", url: "./events.json", demo: false };
  }

  try {
    const res = await fetch(`/api/events?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (data && data.ok === true) {
        return { mode: "live", reason: "api", url: "/api/events", demo: false };
      }
    }
  } catch {
    /* fall through to idle */
  }

  // Legacy static file with events
  try {
    const res = await fetch("./events.json", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.events || [];
      if (list.length > 0) {
        return { mode: "live", reason: "events.json", url: "./events.json", demo: false };
      }
    }
  } catch {
    /* idle */
  }

  return { mode: "idle", reason: "fallback", demo: false };
}
