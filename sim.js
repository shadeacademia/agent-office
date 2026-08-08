/**
 * Floor theater — pure frontend (same event shape as the live bridge).
 *
 * Default: **idle mode** — ambient agents wander; primary (Ollie) hangs out
 * on break / coffee without faking a real job circuit.
 *
 * Opt-in: **demo circuit** (`demo: true` / `?demo=1` / `?sim=1`) runs the
 * Terminal → Research → Compose → Break loop for show-and-tell.
 *
 * Live feed can run alongside idle: real job events pause primary idle
 * so the status board never invents "Got a prompt" while the bridge is quiet.
 */

/** Public status lines only — never full LLM replies. */
const DEMO_CIRCUIT = [
  {
    desk: "desk-terminal",
    nextState: "coding",
    message: "Got a prompt",
    dwellMs: 2800,
  },
  {
    desk: "desk-research",
    nextState: "review",
    message: "Researching…",
    dwellMs: 3200,
  },
  {
    desk: "desk-compose",
    nextState: "coding",
    message: "Writing a reply…",
    dwellMs: 3000,
  },
  {
    desk: "desk-compose",
    nextState: "coding",
    message: "Replied — see chat",
    dwellMs: 2200,
  },
  {
    desk: "desk-break",
    nextState: "break",
    message: "On break",
    dwellMs: 5500,
  },
];

/** Soft downtime for the primary — no fake job phases. */
const PRIMARY_IDLE = [
  { state: "break", message: "On break", desk: "desk-break", weight: 3 },
  { state: "break", message: "Coffee run", desk: "prop-coffee", weight: 2 },
  { state: "idle", message: "Standing by", desk: "desk-break", weight: 2 },
  { state: "break", message: "Stretching…", desk: "desk-compose", weight: 1 },
];

/** Ambient cast (Nova / Byte). */
const AMBIENT = [
  { state: "coding", message: "Tidying notes", desk: "desk-terminal", weight: 2 },
  { state: "review", message: "Skimming bookmarks", desk: "desk-research", weight: 2 },
  { state: "break", message: "Coffee run", desk: "prop-coffee", weight: 2 },
  { state: "break", message: "Lounge break", desk: "desk-break", weight: 2 },
  { state: "idle", message: "Standing by", desk: null, weight: 2 },
  { state: "coding", message: "Stretching context…", desk: "desk-compose", weight: 1 },
];

function pickWeighted(list) {
  const total = list.reduce((s, t) => s + (t.weight || 1), 0);
  let r = Math.random() * total;
  for (const t of list) {
    r -= t.weight || 1;
    if (r <= 0) return t;
  }
  return list[list.length - 1];
}

/**
 * @param {object} opts
 * @param {boolean} [opts.demo=false] Full fake job circuit for primary
 * @param {boolean} [opts.controlPrimary=true] Idle theater may move the primary
 * @param {boolean} [opts.parkOnStart=true] Teleport everyone home on start
 */
export function createSimulator({
  agents,
  desks,
  coffee = null,
  onEvent,
  demo = false,
  controlPrimary = true,
  parkOnStart = true,
}) {
  const deskById = Object.fromEntries(desks.map((d) => [d.id, d]));
  const targetById = { ...deskById };
  if (coffee) {
    const cid = coffee.id || "prop-coffee";
    targetById[cid] = { ...coffee, id: cid };
  }

  const primary =
    agents.find((a) => a.primary) ||
    agents.find((a) => a.id === "ollie") ||
    agents[0];
  const ambient = agents.filter((a) => a.id !== primary?.id);

  let circuitTimers = [];
  let ambientTimer = null;
  let primaryIdleTimer = null;
  let jobGeneration = 0;
  /** Demo circuit / primary idle paused (coffee button or live job). */
  let primaryPaused = false;
  let primaryControlled = controlPrimary;

  function emit(agentId, partial) {
    onEvent({
      ts: Date.now(),
      agentId,
      type: "status",
      idle: true,
      ...partial,
    });
  }

  function resolvePoint(id, fallbackId) {
    return (
      targetById[id] ||
      targetById[fallbackId] ||
      deskById[fallbackId] ||
      null
    );
  }

  function goTo(agent, targetId, { nextState, message, teleport = false }) {
    const point =
      resolvePoint(targetId, agent.homeDesk) ||
      resolvePoint(agent.homeDesk, "desk-break");
    const id = point?.id || targetId || agent.homeDesk;
    emit(agent.id, {
      state: teleport ? nextState || "idle" : "walk",
      message,
      target: id,
      targetX: point?.x,
      targetY: point?.y,
      nextState: nextState || "idle",
      teleport,
    });
  }

  function clearCircuitTimers() {
    for (const t of circuitTimers) clearTimeout(t);
    circuitTimers = [];
  }

  function after(ms, fn) {
    const gen = jobGeneration;
    const id = setTimeout(() => {
      if (gen !== jobGeneration) return;
      fn();
    }, ms);
    circuitTimers.push(id);
  }

  /** Opt-in demo: fake job circuit for the primary only. */
  function runDemoCircuit() {
    if (!primary || primaryPaused || !demo) return;
    jobGeneration += 1;
    clearCircuitTimers();

    let stepIndex = 0;

    const runStep = () => {
      if (primaryPaused || !demo) return;
      const step = DEMO_CIRCUIT[stepIndex];
      if (!step) {
        after(4000, runDemoCircuit);
        return;
      }

      goTo(primary, step.desk, {
        nextState: step.nextState,
        message: step.message,
      });

      stepIndex += 1;
      after(step.dwellMs + 1800, runStep);
    };

    runStep();
  }

  function assignPrimaryIdle() {
    if (!primary || primaryPaused || !primaryControlled || demo) return;
    const task = pickWeighted(PRIMARY_IDLE);
    let targetId = task.desk || primary.homeDesk || "desk-break";
    if (targetId === "prop-coffee" && !targetById["prop-coffee"] && !coffee) {
      targetId = "desk-break";
    }
    goTo(primary, targetId, {
      nextState: task.state === "idle" ? "idle" : task.state,
      message: task.message,
    });
  }

  function startPrimaryIdle() {
    if (primaryIdleTimer) clearInterval(primaryIdleTimer);
    if (!primary || !primaryControlled || demo) return;
    setTimeout(() => assignPrimaryIdle(), 2500);
    // Slower than ambient — Ollie is mostly “on break”
    primaryIdleTimer = setInterval(() => {
      if (!primaryPaused && primaryControlled) assignPrimaryIdle();
    }, 14000);
  }

  function assignAmbient(agent) {
    const task = pickWeighted(AMBIENT);
    let deskId = task.desk || agent.homeDesk;
    if (deskId === "prop-coffee" && !targetById["prop-coffee"] && !coffee) {
      deskId = "desk-break";
    }
    goTo(agent, deskId, {
      nextState: task.state === "idle" ? "idle" : task.state,
      message: task.message,
    });
  }

  function startAmbient() {
    if (ambientTimer) clearInterval(ambientTimer);
    if (!ambient.length) return;
    ambient.forEach((agent, i) => {
      setTimeout(() => assignAmbient(agent), 1800 + i * 1100);
    });
    ambientTimer = setInterval(() => {
      const a = ambient[Math.floor(Math.random() * ambient.length)];
      assignAmbient(a);
    }, 7000);
  }

  function start() {
    if (parkOnStart) {
      for (const agent of agents) {
        const home = agent.homeDesk || "desk-break";
        goTo(agent, home, {
          nextState: agent.id === primary?.id ? "break" : "idle",
          message:
            agent.id === primary?.id ? "On break" : "Standing by",
          teleport: true,
        });
      }
    }

    startAmbient();
    if (demo) {
      setTimeout(() => runDemoCircuit(), 1200);
    } else if (primaryControlled) {
      startPrimaryIdle();
    }
  }

  function stop() {
    jobGeneration += 1;
    clearCircuitTimers();
    if (ambientTimer) clearInterval(ambientTimer);
    ambientTimer = null;
    if (primaryIdleTimer) clearInterval(primaryIdleTimer);
    primaryIdleTimer = null;
  }

  /** Pause primary (coffee button or live job owns Ollie). Ambient keeps going. */
  function pauseJobs() {
    primaryPaused = true;
    jobGeneration += 1;
    clearCircuitTimers();
  }

  /**
   * After coffee / live job ends: resume demo circuit or primary idle.
   * Ambient was never stopped.
   */
  function resumeJobsSoon(delayMs = 3500) {
    primaryPaused = false;
    if (demo) {
      after(delayMs, () => {
        if (!primaryPaused) runDemoCircuit();
      });
    } else if (primaryControlled) {
      after(delayMs, () => {
        if (!primaryPaused) assignPrimaryIdle();
      });
    }
  }

  /** Live bridge took over primary — stop inventing Ollie idle moves. */
  function setPrimaryControlled(on) {
    primaryControlled = Boolean(on);
    if (!primaryControlled) {
      primaryPaused = true;
      jobGeneration += 1;
      clearCircuitTimers();
    } else {
      primaryPaused = false;
      if (!demo) startPrimaryIdle();
    }
  }

  /** Live job started for primary. */
  function notifyLiveBusy() {
    primaryPaused = true;
    jobGeneration += 1;
    clearCircuitTimers();
  }

  /** Live primary returned to break — soft idle may resume. */
  function notifyLiveIdle(delayMs = 8000) {
    primaryPaused = false;
    if (demo || !primaryControlled) return;
    after(delayMs, () => {
      if (!primaryPaused) assignPrimaryIdle();
    });
  }

  function nudge(agentId) {
    const agent = agents.find((a) => a.id === agentId) || primary;
    if (!agent) return;
    if (agent.id === primary?.id) {
      if (primaryPaused) return;
      if (demo) runDemoCircuit();
      else assignPrimaryIdle();
      return;
    }
    assignAmbient(agent);
  }

  return {
    start,
    stop,
    nudge,
    pauseJobs,
    resumeJobsSoon,
    setPrimaryControlled,
    notifyLiveBusy,
    notifyLiveIdle,
    primaryId: primary?.id,
    coffeeId: coffee?.id || "prop-coffee",
    demo,
  };
}

/** @deprecated alias — createSimulator is idle theater (+ optional demo). */
export const createIdleTheater = createSimulator;
