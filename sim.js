/**
 * Mock agent simulator — pure frontend, no backend.
 * Emits the same event shape as a future live bridge (see events.js).
 *
 * Primary agent (Ollie): Terminal → Research → Compose → Break circuit.
 * Ambient agents: light random movement so the floor isn't empty.
 */

/** Public status lines only — never full LLM replies. */
const CIRCUIT = [
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

const AMBIENT = [
  { state: "coding", message: "Tidying notes", desk: "desk-terminal" },
  { state: "review", message: "Skimming bookmarks", desk: "desk-research" },
  { state: "break", message: "Coffee run", desk: "desk-break" },
  { state: "idle", message: "Standing by", desk: null },
  { state: "coding", message: "Stretching context…", desk: "desk-compose" },
];

export function createSimulator({ agents, desks, onEvent }) {
  const deskById = Object.fromEntries(desks.map((d) => [d.id, d]));
  const primary =
    agents.find((a) => a.primary) ||
    agents.find((a) => a.id === "ollie") ||
    agents[0];
  const ambient = agents.filter((a) => a.id !== primary?.id);

  let circuitTimers = [];
  let ambientTimer = null;
  let jobGeneration = 0;

  function emit(agentId, partial) {
    onEvent({
      ts: Date.now(),
      agentId,
      type: "status",
      ...partial,
    });
  }

  function goToDesk(agent, deskId, { nextState, message, teleport = false }) {
    const desk = deskById[deskId] || deskById[agent.homeDesk];
    const id = desk?.id || deskId;
    emit(agent.id, {
      state: teleport ? nextState || "idle" : "walk",
      message,
      target: id,
      targetX: desk?.x,
      targetY: desk?.y,
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

  /** Run one full job circuit for the primary agent, then loop. */
  function runCircuit() {
    if (!primary) return;
    jobGeneration += 1;
    clearCircuitTimers();

    let stepIndex = 0;

    const runStep = () => {
      const step = CIRCUIT[stepIndex];
      if (!step) {
        after(4000, runCircuit);
        return;
      }

      goToDesk(primary, step.desk, {
        nextState: step.nextState,
        message: step.message,
      });

      stepIndex += 1;
      after(step.dwellMs + 1800, runStep);
    };

    runStep();
  }

  function assignAmbient(agent) {
    const task = AMBIENT[Math.floor(Math.random() * AMBIENT.length)];
    const deskId = task.desk || agent.homeDesk;
    goToDesk(agent, deskId, {
      nextState: task.state === "idle" ? "idle" : task.state,
      message: task.message,
    });
  }

  function startAmbient() {
    if (ambientTimer) clearInterval(ambientTimer);
    if (!ambient.length) return;
    // Use plain timeouts so circuit jobGeneration resets don't cancel ambient.
    ambient.forEach((agent, i) => {
      setTimeout(() => assignAmbient(agent), 2000 + i * 900);
    });
    ambientTimer = setInterval(() => {
      const a = ambient[Math.floor(Math.random() * ambient.length)];
      assignAmbient(a);
    }, 6000);
  }

  function start() {
    for (const agent of agents) {
      const home = agent.homeDesk || "desk-break";
      goToDesk(agent, home, {
        nextState: agent.id === primary?.id ? "break" : "idle",
        message: agent.id === primary?.id ? "On break" : "Booting workspace…",
        teleport: true,
      });
    }

    setTimeout(() => runCircuit(), 1200);
    startAmbient();
  }

  function stop() {
    jobGeneration += 1;
    clearCircuitTimers();
    if (ambientTimer) clearInterval(ambientTimer);
    ambientTimer = null;
  }

  /** Manual "Run job": restart primary circuit from Terminal. */
  function nudge(agentId) {
    const agent = agents.find((a) => a.id === agentId) || primary;
    if (!agent) return;
    if (agent.id === primary?.id) {
      runCircuit();
      return;
    }
    assignAmbient(agent);
  }

  return { start, stop, nudge, primaryId: primary?.id };
}
