/**
 * Public status ingest + feed for Agent Office.
 *
 * GET  /api/events          → { events, snapshot, ok }
 * POST /api/events          → append one (or many) public status events
 *                              Header: Authorization: Bearer <INGEST_TOKEN>
 *                                   or X-Office-Token: <INGEST_TOKEN>
 *
 * KV binding: EVENTS (required for live mode)
 * Secret:     INGEST_TOKEN (required for POST)
 *
 * Never store full LLM replies — message is hard-capped.
 */

const KV_KEY = "ring";
const MAX_EVENTS = 50;
const MAX_MESSAGE = 120;
const ALLOWED_AGENTS = new Set(["ollie", "grok", "ansel", "nova", "byte"]);
const STATES = new Set(["idle", "walk", "coding", "review", "break", "blocked"]);

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, authorization, x-office-token",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      ...extraHeaders,
    },
  });
}

function unauthorized() {
  return json({ ok: false, error: "unauthorized" }, 401);
}

function checkToken(request, env) {
  const expected = env.INGEST_TOKEN;
  if (!expected) return false;
  const auth = request.headers.get("Authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const hdr = (request.headers.get("X-Office-Token") || "").trim();
  return bearer === expected || hdr === expected;
}

function sanitizeOne(raw) {
  if (!raw || typeof raw !== "object") return null;
  const agentId = String(raw.agentId || "").toLowerCase();
  if (!ALLOWED_AGENTS.has(agentId)) return null;

  const state = STATES.has(raw.state) ? raw.state : "idle";
  const nextState = STATES.has(raw.nextState) ? raw.nextState : state;
  let message = raw.message != null ? String(raw.message) : "";
  message = message.replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE);

  const event = {
    ts: typeof raw.ts === "number" && Number.isFinite(raw.ts) ? raw.ts : Date.now(),
    agentId,
    type: "status",
    state,
    message,
    nextState,
  };

  if (raw.target != null) event.target = String(raw.target).slice(0, 64);
  if (typeof raw.targetX === "number") event.targetX = raw.targetX;
  if (typeof raw.targetY === "number") event.targetY = raw.targetY;
  if (raw.teleport) event.teleport = true;

  return event;
}

function snapshotFrom(events) {
  const snap = {};
  for (const e of events) {
    snap[e.agentId] = e;
  }
  return snap;
}

async function readRing(env) {
  if (!env.EVENTS) return null;
  const data = await env.EVENTS.get(KV_KEY, "json");
  return Array.isArray(data) ? data : [];
}

async function writeRing(env, events) {
  await env.EVENTS.put(KV_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
}

export async function onRequestOptions() {
  return json({ ok: true });
}

export async function onRequestGet(context) {
  const { env, request } = context;

  if (!env.EVENTS) {
    return json({
      ok: false,
      error: "kv_not_bound",
      hint: "Bind a KV namespace as EVENTS on this Pages project, then redeploy.",
      events: [],
      snapshot: {},
    }, 503);
  }

  const url = new URL(request.url);
  const since = Number(url.searchParams.get("since") || 0);
  const ring = await readRing(env);
  const events = since > 0 ? ring.filter((e) => e.ts > since) : ring;

  return json({
    ok: true,
    mode: "live",
    events,
    snapshot: snapshotFrom(ring),
    count: ring.length,
  });
}

export async function onRequestPost(context) {
  const { env, request } = context;

  if (!checkToken(request, env)) return unauthorized();

  if (!env.EVENTS) {
    return json({
      ok: false,
      error: "kv_not_bound",
      hint: "Bind KV namespace EVENTS on this Pages project.",
    }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const batch = Array.isArray(body)
    ? body
    : Array.isArray(body?.events)
      ? body.events
      : [body];

  const accepted = [];
  for (const raw of batch) {
    const ev = sanitizeOne(raw);
    if (ev) accepted.push(ev);
  }

  if (!accepted.length) {
    return json({
      ok: false,
      error: "no_valid_events",
      hint: "Need agentId in ollie|grok|ansel|nova|byte and a short public message.",
    }, 400);
  }

  const ring = await readRing(env);
  const next = [...ring, ...accepted].slice(-MAX_EVENTS);
  await writeRing(env, next);

  return json({
    ok: true,
    accepted: accepted.length,
    events: accepted,
    snapshot: snapshotFrom(next),
  });
}
