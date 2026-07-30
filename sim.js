/**
 * Mock agent simulator — pure frontend, no backend.
 * Emits tiny events the office renderer consumes.
 */

const TASKS = [
  { state: "coding", message: "Scaffolding the login form", desk: "desk-1" },
  { state: "coding", message: "Wiring the API client", desk: "desk-2" },
  { state: "coding", message: "Tuning deploy pipeline", desk: "desk-3" },
  { state: "review", message: "Reviewing PR #12", desk: "desk-4" },
  { state: "coding", message: "Fixing the flaky test", desk: "desk-2" },
  { state: "blocked", message: "Waiting on design tokens", desk: "desk-1" },
  { state: "break", message: "Coffee break", desk: "desk-5" },
  { state: "coding", message: "Compacting context…", desk: "desk-2" },
  { state: "review", message: "LGTM with nits", desk: "desk-4" },
  { state: "coding", message: "Chasing a race condition", desk: "desk-3" },
  { state: "idle", message: "Idle — standing by", desk: null },
];

export function createSimulator({ agents, desks, onEvent }) {
  const deskById = Object.fromEntries(desks.map((d) => [d.id, d]));
  let tick = 0;
  let timer = null;

  function emit(agentId, partial) {
    onEvent({
      ts: Date.now(),
      agentId,
      ...partial,
    });
  }

  function assignRandom(agent) {
    const task = TASKS[Math.floor(Math.random() * TASKS.length)];
    const deskId = task.desk || agent.homeDesk;
    const desk = deskById[deskId];

    emit(agent.id, {
      type: "status",
      state: task.state === "idle" ? "idle" : "walk",
      message: task.message,
      target: deskId,
      targetX: desk?.x,
      targetY: desk?.y,
      nextState: task.state,
    });
  }

  function start() {
    // Initial placement
    for (const agent of agents) {
      const desk = deskById[agent.homeDesk];
      emit(agent.id, {
        type: "status",
        state: "idle",
        message: "Booting workspace…",
        target: agent.homeDesk,
        targetX: desk?.x,
        targetY: desk?.y,
        nextState: "idle",
        teleport: true,
      });
    }

    // Stagger first jobs
    agents.forEach((agent, i) => {
      setTimeout(() => assignRandom(agent), 800 + i * 600);
    });

    timer = setInterval(() => {
      tick += 1;
      // Reassign 1–2 agents each cycle
      const count = 1 + (tick % 3 === 0 ? 1 : 0);
      const shuffled = [...agents].sort(() => Math.random() - 0.5);
      for (let i = 0; i < count && i < shuffled.length; i++) {
        assignRandom(shuffled[i]);
      }
    }, 4200);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop };
}
