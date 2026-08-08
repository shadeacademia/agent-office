import { createSimulator } from "./sim.js";
import {
  createJsonPollSource,
  normalizeEvent,
  resolveFeedMode,
} from "./events.js";

const STATE_LABEL = {
  idle: "Idle",
  walk: "Walking",
  coding: "Working",
  review: "Research",
  break: "Break",
  blocked: "Blocked",
};

const SPEED = 110; // px per second

async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function setSourceBadge(mode, detail = "") {
  const node = document.getElementById("feed-source");
  if (!node) return;
  node.textContent =
    mode === "live"
      ? `Live feed${detail ? ` · ${detail}` : ""}`
      : "Mock sim · full replies stay in chat";
  node.dataset.mode = mode;
}

function setup() {
  const floor = document.getElementById("floor");
  const feed = document.getElementById("feed");
  const roster = document.getElementById("roster");
  const clock = document.getElementById("clock");

  Promise.all([loadJSON("./office.json"), loadJSON("./agents.json")]).then(
    async ([office, agentsDef]) => {
      floor.style.width = `${office.width}px`;
      floor.style.height = `${office.height}px`;
      document.getElementById("office-name").textContent = office.name;

      const deskById = Object.fromEntries(office.desks.map((d) => [d.id, d]));

      // Desks
      for (const desk of office.desks) {
        const d = el("div", "desk", floor);
        d.style.left = `${desk.x}px`;
        d.style.top = `${desk.y}px`;
        d.dataset.id = desk.id;
        const label = el("span", "desk-label", d);
        label.textContent = desk.label;
        el("div", "desk-surface", d);
        el("div", "desk-chair", d);
      }

      // Coffee corner
      if (office.coffee) {
        const c = el("div", "prop coffee", floor);
        c.style.left = `${office.coffee.x}px`;
        c.style.top = `${office.coffee.y}px`;
        c.title = "Coffee";
        c.textContent = "☕";
      }

      // Agent runtime state
      const agents = {};
      for (const def of agentsDef) {
        const spawn = office.spawn || { x: 80, y: 480 };
        const node = el("div", "agent", floor);
        node.style.setProperty("--color", def.color);
        node.style.left = `${spawn.x}px`;
        node.style.top = `${spawn.y}px`;

        const body = el("div", "agent-body", node);
        body.textContent = def.name.slice(0, 1);

        const nameTag = el("div", "agent-name", node);
        nameTag.textContent = def.name;

        const bubble = el("div", "bubble hidden", node);
        const bubbleText = el("span", null, bubble);

        agents[def.id] = {
          ...def,
          x: spawn.x,
          y: spawn.y,
          state: "idle",
          message: "",
          targetX: spawn.x,
          targetY: spawn.y,
          nextState: "idle",
          node,
          bubble,
          bubbleText,
          bubbleUntil: 0,
        };

        const row = el("div", "roster-row", roster);
        row.dataset.agent = def.id;
        const swatch = el("span", "swatch", row);
        swatch.style.background = def.color;
        const meta = el("div", "roster-meta", row);
        el("strong", null, meta).textContent = def.name;
        const role = el("span", "muted", meta);
        role.textContent = def.role;
        const status = el("span", "roster-status", row);
        status.textContent = "Idle";
        agents[def.id].rosterStatus = status;
      }

      function pushFeed(event) {
        const agent = agents[event.agentId];
        if (!agent) return;
        const item = el("div", `feed-item state-${event.nextState || event.state}`);
        const t = new Date(event.ts);
        const time = t.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
        item.innerHTML = `<span class="feed-time">${time}</span>
          <span class="feed-who" style="color:${agent.color}">${agent.name}</span>
          <span class="feed-msg">${escapeHtml(event.message || "")}</span>`;
        feed.prepend(item);
        while (feed.children.length > 40) feed.lastChild.remove();
      }

      function onEvent(raw) {
        const event = normalizeEvent(raw, deskById) || raw;
        const agent = agents[event.agentId];
        if (!agent) return;

        // Resolve desk coordinates if only target id was provided
        if (event.target && (event.targetX == null || event.targetY == null)) {
          const desk = deskById[event.target];
          if (desk) {
            event.targetX = desk.x;
            event.targetY = desk.y;
          }
        }

        if (event.teleport && event.targetX != null) {
          agent.x = event.targetX;
          agent.y = event.targetY;
          agent.node.style.left = `${agent.x}px`;
          agent.node.style.top = `${agent.y}px`;
        }

        if (event.targetX != null) {
          agent.targetX = event.targetX;
          agent.targetY = event.targetY;
        }

        agent.message = event.message || agent.message;
        agent.nextState = event.nextState || event.state || "idle";

        if (event.state === "walk" || event.state === "idle") {
          agent.state = event.state;
        } else if (event.teleport) {
          agent.state = event.state;
        } else if (event.state && event.state !== "walk") {
          // Live feeds may set working states without a walk if already at desk
          if (
            Math.hypot(agent.x - (event.targetX ?? agent.x), agent.y - (event.targetY ?? agent.y)) < 8
          ) {
            agent.state = event.state;
          } else {
            agent.state = "walk";
          }
        }

        if (event.message) {
          agent.bubbleText.textContent = event.message;
          agent.bubble.classList.remove("hidden");
          agent.bubbleUntil = performance.now() + 3500;
        }

        const labelState = agent.state === "walk" ? agent.nextState : agent.state;
        agent.rosterStatus.textContent = STATE_LABEL[labelState] || labelState;
        agent.rosterStatus.dataset.state = labelState;
        agent.node.dataset.state = agent.state;

        if (!event.teleport) pushFeed(event);
      }

      // Animation loop
      let last = performance.now();
      function frame(now) {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;

        for (const agent of Object.values(agents)) {
          if (agent.state === "walk") {
            const dx = agent.targetX - agent.x;
            const dy = agent.targetY - agent.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 4) {
              agent.x = agent.targetX;
              agent.y = agent.targetY;
              agent.state = agent.nextState || "idle";
              agent.node.dataset.state = agent.state;
              agent.rosterStatus.textContent = STATE_LABEL[agent.state] || agent.state;
              agent.rosterStatus.dataset.state = agent.state;
            } else {
              const step = SPEED * dt;
              agent.x += (dx / dist) * step;
              agent.y += (dy / dist) * step;
              agent.node.classList.toggle("flip", dx < 0);
            }
          }

          agent.x = clamp(agent.x, 24, office.width - 24);
          agent.y = clamp(agent.y, 40, office.height - 24);
          agent.node.style.left = `${agent.x}px`;
          agent.node.style.top = `${agent.y}px`;

          if (agent.bubbleUntil && now > agent.bubbleUntil) {
            agent.bubble.classList.add("hidden");
            agent.bubbleUntil = 0;
          }

          agent.node.classList.toggle(
            "working",
            agent.state === "coding" || agent.state === "review"
          );
          agent.node.classList.toggle("blocked", agent.state === "blocked");
          agent.node.classList.toggle("break", agent.state === "break");
        }

        clock.textContent = new Date().toLocaleTimeString();
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);

      // Feed: live events.json or mock circuit sim
      const mode = await resolveFeedMode();
      let feedHandle = null;
      let sim = null;

      if (mode === "live") {
        setSourceBadge("live", "events.json");
        feedHandle = createJsonPollSource({
          url: "./events.json",
          desks: office.desks,
          onEvent,
          onStatus: (s) => {
            if (!s.ok) setSourceBadge("live", `error · falling back soon`);
            else setSourceBadge("live", s.detail || "ok");
          },
        });
      } else {
        setSourceBadge("sim");
        sim = createSimulator({
          agents: agentsDef,
          desks: office.desks,
          onEvent,
        });
        sim.start();
      }

      const btn = document.getElementById("btn-nudge");
      btn?.addEventListener("click", () => {
        if (sim) {
          sim.nudge(sim.primaryId);
          return;
        }
        // Live mode: local-only visual nudge (does not write events.json)
        const primary =
          agentsDef.find((a) => a.primary) ||
          agentsDef.find((a) => a.id === "ollie") ||
          agentsDef[0];
        if (!primary) return;
        const desk = deskById["desk-terminal"];
        onEvent({
          ts: Date.now(),
          agentId: primary.id,
          type: "status",
          state: "walk",
          message: "Got a prompt",
          target: "desk-terminal",
          targetX: desk?.x,
          targetY: desk?.y,
          nextState: "coding",
        });
      });

      // Expose for console debugging
      window.__office = { onEvent, agents, office, mode, stop: () => feedHandle?.stop() };
    }
  ).catch((err) => {
    console.error(err);
    feed.innerHTML = `<div class="feed-item state-blocked">Failed to load office data. Serve over HTTP (not file://).</div>`;
  });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

setup();
