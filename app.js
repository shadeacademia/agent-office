import { createSimulator, isLiveAgent } from "./sim.js";
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

/** Map runtime state → sprite stem under assets/agents/{id}-{stem}.png */
const STATE_SPRITE = {
  idle: "idle",
  walk: "walk",
  coding: "work",
  review: "review",
  break: "break",
  blocked: "blocked",
};

const SPEED = 130; // px per second
/** Min time (ms) to keep walking toward a desk before a queued leg may start */
const MIN_LEG_MS = 2200;
/** Dwell at coffee machine before walking back to break */
const COFFEE_DWELL_MS = 2500;
/** Horizontal gap between agents sharing a station */
const SLOT_SPREAD_X = 24;
/** Extra vertical nudge so sprites/names don’t fully stack */
const SLOT_SPREAD_Y = 8;

function spriteUrl(agentId, state) {
  const stem = STATE_SPRITE[state] || STATE_SPRITE.idle;
  return `./assets/agents/${agentId}-${stem}.png`;
}

function setAgentSprite(agent, state) {
  if (!agent?.sprite) return;
  const next = state || agent.state || "idle";
  const url = spriteUrl(agent.id, next);
  if (agent.spriteSrc === url) return;
  agent.spriteSrc = url;
  agent.sprite.src = url;
}

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
  if (mode === "live") {
    node.textContent = `Live feed · idle floor${detail ? ` · ${detail}` : ""}`;
  } else if (mode === "demo") {
    node.textContent = `Demo circuit${detail ? ` · ${detail}` : ""} · not real jobs`;
  } else {
    node.textContent = `Idle mode${detail ? ` · ${detail}` : ""} · full replies stay in chat`;
  }
  node.dataset.mode = mode === "demo" ? "idle" : mode;
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

      // Scene backdrop (room.png). Fallback to tiled carpet if missing.
      const roomSrc = office.scene || "./assets/scene/room.png";
      const probe = new Image();
      probe.onload = () => floor.classList.remove("floor-fallback");
      probe.onerror = () => floor.classList.add("floor-fallback");
      probe.src = roomSrc;

      const floorScale = document.getElementById("floor-scale");
      const floorScroll = document.querySelector(".floor-scroll");

      /** Fit the logical floor to the stage width (no horizontal scroll / clip). */
      function fitFloorToWidth() {
        if (!floorScale || !floorScroll) return;
        const pad = 0;
        const avail = Math.max(120, floorScroll.clientWidth - pad);
        const scale = avail / office.width;
        floorScale.style.width = `${office.width * scale}px`;
        floorScale.style.height = `${office.height * scale}px`;
        floor.style.transform = `scale(${scale})`;
        floor.style.transformOrigin = "top left";
      }

      fitFloorToWidth();
      window.addEventListener("resize", fitFloorToWidth);
      // Re-fit after layout settles (fonts / side panel)
      requestAnimationFrame(fitFloorToWidth);
      if (typeof ResizeObserver !== "undefined" && floorScroll) {
        new ResizeObserver(fitFloorToWidth).observe(floorScroll);
      }

      const deskById = Object.fromEntries(office.desks.map((d) => [d.id, d]));
      /** Desks + props (coffee) for event target resolution */
      const targetById = { ...deskById };
      if (office.coffee) {
        const cid = office.coffee.id || "prop-coffee";
        office.coffee.id = cid;
        targetById[cid] = office.coffee;
      }

      const primaryDef =
        agentsDef.find((a) => a.primary) ||
        agentsDef.find((a) => a.id === "ollie") ||
        agentsDef[0];
      const liveDefs = agentsDef.filter((a) => isLiveAgent(a));
      const liveIdSet = new Set(liveDefs.map((a) => a.id));

      const coffeeBtn = document.getElementById("btn-coffee");

      // Desks (pixel sprites when present under assets/furniture/)
      for (const desk of office.desks) {
        const d = el("div", "desk", floor);
        d.style.left = `${desk.x}px`;
        d.style.top = `${desk.y}px`;
        d.dataset.id = desk.id;
        const label = el("span", "desk-label", d);
        label.textContent = desk.label;

        const spritePath =
          desk.sprite || `./assets/furniture/${desk.id}.png`;
        const img = el("img", "desk-sprite", d);
        img.alt = desk.label;
        img.draggable = false;
        img.src = spritePath;
        img.addEventListener("load", () => d.classList.add("has-sprite"));
        img.addEventListener("error", () => {
          img.remove();
          el("div", "desk-surface", d);
          el("div", "desk-chair", d);
        });
      }

      // Coffee corner
      if (office.coffee) {
        const c = el("div", "prop coffee", floor);
        c.style.left = `${office.coffee.x}px`;
        c.style.top = `${office.coffee.y}px`;
        c.title = "Coffee";
        const coffeeSrc =
          office.coffee.sprite || "./assets/furniture/prop-coffee.png";
        const img = el("img", "prop-sprite", c);
        img.alt = "Coffee";
        img.draggable = false;
        img.src = coffeeSrc;
        img.addEventListener("load", () => c.classList.add("has-sprite"));
        img.addEventListener("error", () => {
          img.remove();
          c.textContent = "☕";
        });
      }

      // Agent runtime state
      const agents = {};
      for (const def of agentsDef) {
        const spawn = office.spawn || {
          x: Math.round(office.width * 0.18),
          y: Math.round(office.height * 0.94),
        };
        const node = el("div", "agent", floor);
        node.style.setProperty("--color", def.color);
        node.style.left = `${spawn.x}px`;
        node.style.top = `${spawn.y}px`;

        const body = el("div", "agent-body", node);
        const sprite = el("img", "agent-sprite", body);
        sprite.alt = def.name;
        sprite.draggable = false;
        sprite.src = spriteUrl(def.id, "idle");
        sprite.addEventListener("error", () => {
          // Fallback: colored initial if sprites missing
          if (body.dataset.fallback) return;
          body.dataset.fallback = "1";
          sprite.remove();
          body.textContent = def.name.slice(0, 1);
          body.classList.add("agent-body-fallback");
        });
        sprite.addEventListener("load", () => body.classList.add("has-sprite"));

        const nameTag = el("div", "agent-name name-below", node);
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
          body,
          sprite,
          spriteSrc: sprite.src,
          nameTag,
          bubble,
          bubbleText,
          bubbleUntil: 0,
          /** Live feed can fire phases faster than walk animation — queue legs */
          eventQueue: [],
          legStartedAt: 0,
          hopLegLen: 0,
          lastLiveTs: 0,
          /** null | "to-machine" | "at-machine" | "to-break" */
          coffeePhase: null,
          coffeeUntil: 0,
          /** Desk/prop id agents currently claim (for side-by-side slots) */
          stationId: null,
          slotIndex: 0,
          slotCount: 1,
        };
        setAgentSprite(agents[def.id], "idle");

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
          hour12: false,
        });
        item.innerHTML = `<span class="feed-time">${time}</span>
          <span class="feed-who" style="color:${agent.color}">${agent.name}</span>
          <span class="feed-msg">${escapeHtml(event.message || "")}</span>`;
        feed.prepend(item);
        while (feed.children.length > 40) feed.lastChild.remove();
      }

      function resolveTargets(event) {
        if (event.target && (event.targetX == null || event.targetY == null)) {
          const point = targetById[event.target];
          if (point) {
            event.targetX = point.x;
            event.targetY = point.y;
          }
        }
        return event;
      }

      /** Stagger name tags so labels don’t sit on top of each other at a desk. */
      function setNamePlacement(agent, slotIndex, slotCount) {
        if (!agent.nameTag) return;
        const tag = agent.nameTag;
        tag.classList.remove(
          "name-below",
          "name-above",
          "name-side-left",
          "name-side-right"
        );
        if (slotCount <= 1) {
          tag.classList.add("name-below");
        } else if (slotIndex === 0) {
          tag.classList.add("name-below");
        } else if (slotIndex === 1) {
          tag.classList.add("name-above");
        } else {
          tag.classList.add(slotIndex % 2 ? "name-side-right" : "name-side-left");
        }
      }

      /**
       * Side-by-side slots at a shared station so one agent isn’t fully hidden.
       * Stable order by agent id.
       */
      function restackStation(stationId) {
        if (!stationId) return;
        const base = targetById[stationId];
        if (!base) return;

        const group = Object.values(agents)
          .filter((a) => a.stationId === stationId)
          .sort((a, b) => String(a.id).localeCompare(String(b.id)));
        const n = group.length;
        if (!n) return;

        group.forEach((a, i) => {
          const ox = n === 1 ? 0 : (i - (n - 1) / 2) * SLOT_SPREAD_X;
          const oy =
            n === 1
              ? 0
              : (i - (n - 1) / 2) * (SLOT_SPREAD_Y * 0.35) + (i % 2 === 1 ? 6 : 0);
          const nx = base.x + ox;
          const ny = base.y + oy;

          a.slotIndex = i;
          a.slotCount = n;
          // Always retarget walk destination (slots) — never skip the walk
          a.targetX = nx;
          a.targetY = ny;
          setNamePlacement(a, i, n);

          // Only micro-adjust position if already standing at this station.
          // Do NOT snap when state is still "break"/"idle" but event will walk
          // elsewhere — that was teleporting between desks.
          const alreadyHere = Math.hypot(a.x - base.x, a.y - base.y) < 40;
          if (alreadyHere && a.state !== "walk") {
            a.x = nx;
            a.y = ny;
          }
        });
      }

      function getPrimaryAgent() {
        if (!primaryDef) return null;
        return agents[primaryDef.id] || null;
      }

      /** Live agents currently free for a coffee run (on break, not mid-job). */
      function getCoffeeCandidates() {
        return liveDefs
          .map((d) => agents[d.id])
          .filter((a) => a && canGetCoffee(a));
      }

      /**
       * Prefer primary when free; else first other live agent on break.
       * Keeps coffee working for Ollie and Grok the same way.
       */
      function pickCoffeeAgent() {
        const primary = getPrimaryAgent();
        if (canGetCoffee(primary)) return primary;
        return getCoffeeCandidates()[0] || null;
      }

      /** Strict: only while on break and not already on a coffee run. */
      function canGetCoffee(agent) {
        if (!agent || !office.coffee) return false;
        if (agent.coffeePhase) return false;
        if (agent.state !== "break") return false;
        return true;
      }

      function updateCoffeeButton() {
        if (!coffeeBtn) return;
        const agent = pickCoffeeAgent();
        const ok = Boolean(agent);
        coffeeBtn.disabled = !ok;
        if (!liveDefs.length) {
          coffeeBtn.title = "No live agent";
        } else if (agent) {
          coffeeBtn.title = `Send ${agent.name} to the coffee machine`;
        } else {
          coffeeBtn.title =
            "Only available while a live agent (Ollie / Grok / Ansel) is on break";
        }
      }

      /**
       * Local floor theater (sim + live). Does not POST.
       * Pauses mock job circuit so auto jobs don't yank the primary mid-mug.
       */
      function startCoffeeRun() {
        const agent = pickCoffeeAgent();
        if (!canGetCoffee(agent)) {
          updateCoffeeButton();
          return;
        }
        const coffee = office.coffee;
        agent.eventQueue = [];
        agent.coffeePhase = "to-machine";
        agent.coffeeUntil = 0;
        // Demo circuit only owns the primary
        if (sim && agent.id === primaryDef?.id) sim.pauseJobs();

        onEvent({
          ts: Date.now(),
          agentId: agent.id,
          type: "status",
          state: "walk",
          message: "Coffee run",
          target: coffee.id,
          targetX: coffee.x,
          targetY: coffee.y,
          nextState: "break",
          coffeeLeg: true,
        });
        updateCoffeeButton();
      }

      function tickCoffee(agent, now) {
        if (!agent.coffeePhase || !office.coffee) return;

        if (agent.coffeePhase === "to-machine" && agent.state === "break") {
          agent.coffeePhase = "at-machine";
          agent.coffeeUntil = now + COFFEE_DWELL_MS;
          agent.bubbleText.textContent = "Topping up…";
          agent.bubble.classList.remove("hidden");
          agent.bubbleUntil = now + COFFEE_DWELL_MS;
          return;
        }

        if (
          agent.coffeePhase === "at-machine" &&
          agent.state === "break" &&
          now >= agent.coffeeUntil
        ) {
          agent.coffeePhase = "to-break";
          const home =
            deskById[agent.homeDesk] || deskById["desk-break"];
          onEvent({
            ts: Date.now(),
            agentId: agent.id,
            type: "status",
            state: "walk",
            message: "Back to the lounge",
            target: home?.id || agent.homeDesk,
            targetX: home?.x,
            targetY: home?.y,
            nextState: "break",
            coffeeLeg: true,
          });
          return;
        }

        if (agent.coffeePhase === "to-break" && agent.state === "break") {
          agent.coffeePhase = null;
          agent.coffeeUntil = 0;
          if (sim && agent.id === primaryDef?.id) sim.resumeJobsSoon(3000);
          updateCoffeeButton();
        }
      }

      /** Apply an event to the agent immediately (no queue). */
      function applyEventNow(event, { skipFeed = false } = {}) {
        const agent = agents[event.agentId];
        if (!agent) return;
        resolveTargets(event);

        // Non-coffee events cancel an in-progress coffee run (e.g. live job)
        if (agent.coffeePhase && !event.coffeeLeg && !event.teleport) {
          const coffeeId = office.coffee?.id;
          const isCoffeeTarget = event.target === coffeeId;
          const isHomeTarget =
            event.target === agent.homeDesk || event.target === "desk-break";
          if (!isCoffeeTarget && !(agent.coffeePhase === "to-break" && isHomeTarget)) {
            agent.coffeePhase = null;
            agent.coffeeUntil = 0;
            if (sim && agent.id === primaryDef?.id) {
              // Live/external took over primary — resume demo if active
              sim.resumeJobsSoon(500);
            }
          }
        }

        const prevStation = agent.stationId;
        if (event.target) {
          agent.stationId = event.target;
        }

        // Base destination, then slot-restack if several agents share the station
        if (event.targetX != null) {
          agent.targetX = event.targetX;
          agent.targetY = event.targetY;
        }
        if (prevStation && prevStation !== agent.stationId) {
          restackStation(prevStation);
        }
        if (agent.stationId) {
          restackStation(agent.stationId);
        }

        if (event.teleport && agent.targetX != null) {
          agent.x = agent.targetX;
          agent.y = agent.targetY;
          agent.node.style.left = `${agent.x}px`;
          agent.node.style.top = `${agent.y}px`;
          agent.eventQueue = [];
        }

        agent.message = event.message || agent.message;
        agent.nextState = event.nextState || event.state || "idle";
        if (!event.idle) {
          agent.lastLiveTs = event.ts || Date.now();
        }

        if (event.state === "walk" || event.state === "idle") {
          agent.state = event.state;
        } else if (event.teleport) {
          agent.state = event.state;
        } else if (event.state && event.state !== "walk") {
          if (
            Math.hypot(
              agent.x - (agent.targetX ?? agent.x),
              agent.y - (agent.targetY ?? agent.y)
            ) < 8
          ) {
            agent.state = event.state;
          } else {
            agent.state = "walk";
          }
        }

        if (agent.state === "walk") {
          agent.legStartedAt = performance.now();
          agent.hopLegLen = Math.hypot(
            (agent.targetX ?? agent.x) - agent.x,
            (agent.targetY ?? agent.y) - agent.y,
          );
        }

        if (event.message) {
          agent.bubbleText.textContent = event.message;
          agent.bubble.classList.remove("hidden");
          agent.bubbleUntil = performance.now() + 3500;
        }

        const labelState = agent.state === "walk" ? agent.nextState : agent.state;
        const labelText =
          agent.state === "walk" && (agent.gait === "hop" || agent.id === "ansel")
            ? "Hopping"
            : STATE_LABEL[labelState] || labelState;
        agent.rosterStatus.textContent = labelText;
        agent.rosterStatus.dataset.state = labelState;
        agent.node.dataset.state = agent.state;
        setAgentSprite(agent, agent.state);
        updateCoffeeButton();

        if (!event.teleport && !skipFeed) pushFeed(event);
      }

      /**
       * Live bridge posts phases faster than walk animation.
       * Queue destination changes while walking so Ollie finishes each desk.
       */
      function onEvent(raw) {
        const event = normalizeEvent(raw, deskById) || raw;
        const agent = agents[event.agentId];
        if (!agent) return;
        resolveTargets(event);

        if (event.teleport) {
          agent.eventQueue = [];
          applyEventNow(event);
          return;
        }

        const moving =
          agent.state === "walk" &&
          Math.hypot(agent.x - agent.targetX, agent.y - agent.targetY) > 6;
        // Compare stations, not slotted coords (slots shift targetX/Y)
        const newDesk =
          event.target != null && event.target !== agent.stationId;

        if (moving && newDesk) {
          agent.eventQueue.push(event);
          // Show intent in feed immediately; body finishes current leg first
          pushFeed(event);
          return;
        }

        applyEventNow(event);
      }

      function drainQueue(agent, now) {
        if (!agent.eventQueue.length) return;
        if (agent.state === "walk") return;
        // Brief dwell at desk so Terminal isn't a 1-frame stop
        if (agent.legStartedAt && now - agent.legStartedAt < MIN_LEG_MS) return;
        const next = agent.eventQueue.shift();
        // Already in feed when queued
        applyEventNow(next, { skipFeed: true });
      }

      const WORK_DESKS = new Set([
        "desk-terminal",
        "desk-research",
        "desk-compose",
      ]);
      const WATCHDOG_MS = 14000;

      /** If a live job never sends Break, hop home instead of sitting at Compose. */
      function maybeWatchdogHome(agent, now) {
        if (!liveIdSet.has(agent.id)) return;
        if (agent.coffeePhase) return;
        if (agent.eventQueue.length) return;
        if (agent.state === "walk") return;
        if (!WORK_DESKS.has(agent.stationId)) return;
        if (agent.state !== "coding" && agent.state !== "review") return;
        const started = agent.lastLiveTs || 0;
        if (!started || Date.now() - started < WATCHDOG_MS) return;
        agent.lastLiveTs = Date.now();
        onEvent({
          ts: Date.now(),
          agentId: agent.id,
          type: "status",
          state: "walk",
          nextState: "break",
          target: "desk-break",
          message: "On break",
        });
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
              setAgentSprite(agent, agent.state);
              // Mark arrival time for min dwell before next queued leg
              agent.legStartedAt = now;
              drainQueue(agent, now);
            } else {
              const step = SPEED * dt;
              agent.x += (dx / dist) * step;
              agent.y += (dy / dist) * step;
              // Prefer facing left/right; slight bias when mostly vertical
              if (Math.abs(dx) > 2) agent.node.classList.toggle("flip", dx < 0);
              setAgentSprite(agent, "walk");
            }
          } else {
            drainQueue(agent, now);
            maybeWatchdogHome(agent, now);
          }

          // Coffee legs advance on arrival / dwell (same frame as walk completes)
          tickCoffee(agent, now);

          // Stay in the playable band (middle half: top/bottom ¼ = window/door)
          const b = office.bounds || {};
          const xMin = b.xMin ?? 48;
          const xMax = b.xMax ?? office.width - 48;
          const yMin = b.yMin ?? Math.round(office.height * 0.25);
          const yMax = b.yMax ?? Math.round(office.height * 0.75);
          agent.x = clamp(agent.x, xMin, xMax);
          agent.y = clamp(agent.y, yMin, yMax);
          let drawY = agent.y;
          if (
            (agent.gait === "hop" || agent.id === "ansel") &&
            agent.state === "walk" &&
            agent.hopLegLen > 4
          ) {
            const remaining = Math.hypot(
              (agent.targetX ?? agent.x) - agent.x,
              (agent.targetY ?? agent.y) - agent.y,
            );
            const traveled = Math.max(0, agent.hopLegLen - remaining);
            const hopLen = 42;
            const phase = (traveled % hopLen) / hopLen;
            drawY = agent.y - Math.sin(Math.PI * phase) * 16;
            agent.node.classList.add("hopping");
          } else {
            agent.node.classList.remove("hopping");
          }
          agent.node.style.left = `${agent.x}px`;
          agent.node.style.top = `${drawY}px`;
          // Painter’s algorithm: lower on floor draws above
          agent.node.style.zIndex = String(10 + Math.floor(agent.y));

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
          agent.node.classList.toggle("walking", agent.state === "walk");
        }

        updateCoffeeButton();
        clock.textContent = new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        });
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);

      // Live feed when API healthy; idle theater always keeps the floor alive.
      // Fake job circuit only with ?demo=1 / ?sim=1.
      const feedMode = await resolveFeedMode();
      let feedHandle = null;
      let sim = null;

      const wantDemo = Boolean(feedMode.demo);
      const isLive = feedMode.mode === "live";

      // Idle theater always: ambient wander + live agents on break.
      // Live jobs drive Ollie (Telegram/OWUI) and Grok (Grok Build hooks).
      // Demo circuit is opt-in only and runs for the primary.
      sim = createSimulator({
        agents: agentsDef,
        desks: office.desks,
        coffee: office.coffee,
        onEvent,
        demo: wantDemo,
        controlPrimary: true,
        parkOnStart: true,
      });
      sim.start();

      if (wantDemo) {
        setSourceBadge("demo", feedMode.reason || "");
      } else if (isLive) {
        setSourceBadge("live", feedMode.reason || "api");

        const liveOnEvent = (raw) => {
          const event = normalizeEvent(raw, deskById) || raw;
          const isLiveBody = liveIdSet.has(event.agentId);
          if (isLiveBody && sim) {
            const phase = event.nextState || event.state;
            const toWorkDesk =
              event.target === "desk-terminal" ||
              event.target === "desk-research" ||
              event.target === "desk-compose";
            const working =
              phase === "coding" ||
              phase === "review" ||
              phase === "blocked" ||
              (event.state === "walk" && toWorkDesk);
            if (working) {
              // Real job owns this live agent
              sim.notifyLiveBusy(event.agentId);
            } else if (phase === "break" || phase === "idle") {
              sim.notifyLiveIdle(event.agentId, 10000);
            }
          }
          onEvent(event);
        };

        feedHandle = createJsonPollSource({
          url: feedMode.url || "/api/events",
          desks: office.desks,
          onEvent: liveOnEvent,
          onStatus: (s) => {
            if (s.fatal) {
              setSourceBadge("idle", "API offline");
              return;
            }
            if (!s.ok) setSourceBadge("live", `retry · ${s.detail || "error"}`);
            else setSourceBadge("live", s.detail || "ok");
          },
        });
      } else {
        setSourceBadge("idle", feedMode.reason || "");
      }

      coffeeBtn?.addEventListener("click", () => startCoffeeRun());
      updateCoffeeButton();

      window.__office = {
        onEvent,
        agents,
        office,
        feedMode,
        startCoffeeRun,
        canGetCoffee: () => Boolean(pickCoffeeAgent()),
        pickCoffeeAgent,
        liveIds: [...liveIdSet],
        stop: () => {
          feedHandle?.stop();
          sim?.stop();
        },
      };
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
