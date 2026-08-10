#!/usr/bin/env python3
"""Map Grok Build hook events → public Agent Office phases for agentId=grok.

Wired from ~/.grok/hooks (or project hooks). Reads JSON on stdin from the
hook runner; posts short status lines only (never full prompts or replies).

Phases mirror Ollie's Telegram/Open WebUI circuit:
  UserPromptSubmit  → Terminal  ("Got a prompt")
  research tools    → Research  ("Researching…")
  other tool use    → Compose   ("Working…")
  Stop (end_turn)   → Replied → Break
  StopFailure       → Stuck → Break
  SessionEnd        → Break
  SessionStart      → Break (park)

Debounces identical consecutive phases. Disable with OFFICE_STATUS=0.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from pathlib import Path

# allow import of office_status from same directory
sys.path.insert(0, str(Path(__file__).resolve().parent))

from office_status import OfficeStatus  # noqa: E402

log = logging.getLogger("grok-office-hook")

AGENT_ID = os.environ.get("OFFICE_AGENT_ID", "grok").strip().lower() or "grok"
STATE_DIR = Path(
    os.environ.get(
        "AGENT_OFFICE_STATE",
        Path.home() / ".local" / "share" / "agent-office",
    )
)
STATE_PATH = STATE_DIR / f"{AGENT_ID}-hook-state.json"

# Tools that mean "looking something up" → Research desk
RESEARCH_TOOLS = frozenset(
    {
        "web_search",
        "web_fetch",
        "open_page",
        "open_page_with_find",
        "x_keyword_search",
        "x_semantic_search",
        "x_thread_fetch",
        "x_user_search",
        "WebSearch",
        "WebFetch",
    }
)

# Skip noisy / internal tool chatter on the public board
SKIP_TOOLS = frozenset(
    {
        "todo_write",
        "get_command_or_subagent_output",
        "kill_command_or_subagent",
        "scheduler_list",
        "search_tool",
    }
)

# Min seconds between identical phase posts
MIN_PHASE_GAP_S = float(os.environ.get("OFFICE_PHASE_GAP", "2.5"))


def _load_state() -> dict:
    try:
        if STATE_PATH.is_file():
            return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def _save_state(state: dict) -> None:
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        STATE_PATH.write_text(json.dumps(state), encoding="utf-8")
    except Exception as e:
        log.debug("state save failed: %s", e)


def _read_stdin() -> dict:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}


def _event_name(payload: dict) -> str:
    # Runner may send camelCase hookEventName or snake_case
    name = (
        payload.get("hookEventName")
        or os.environ.get("GROK_HOOK_EVENT")
        or ""
    )
    return str(name).strip().lower().replace("-", "_")


def _tool_name(payload: dict) -> str:
    return str(payload.get("toolName") or payload.get("tool_name") or "")


def _should_post(state: dict, phase: str) -> bool:
    last = state.get("phase")
    last_ts = float(state.get("ts") or 0)
    now = time.time()
    if last == phase and (now - last_ts) < MIN_PHASE_GAP_S:
        return False
    return True


def _post(office: OfficeStatus, state: dict, phase: str, *, message: str | None = None) -> bool:
    if not _should_post(state, phase):
        return False
    ok = office.post(phase, message=message)
    if ok:
        state["phase"] = phase
        state["ts"] = time.time()
        _save_state(state)
    return ok


def handle(payload: dict, office: OfficeStatus) -> int:
    event = _event_name(payload)
    state = _load_state()

    # Session lifecycle — park Grok on break
    if event in ("session_start", "sessionstart"):
        _post(office, state, "break", message="On break")
        return 0

    if event in ("session_end", "sessionend"):
        _post(office, state, "break", message="On break")
        return 0

    # New user prompt → Terminal
    if event in ("user_prompt_submit", "userpromptsubmit", "before_submit_prompt"):
        _post(office, state, "terminal")
        return 0

    # Tool use → Research or Compose
    if event in ("pre_tool_use", "pretooluse", "post_tool_use", "posttooluse"):
        tool = _tool_name(payload)
        if not tool or tool in SKIP_TOOLS:
            return 0
        # Only advance on PreToolUse to avoid double-posting with PostToolUse
        if event in ("post_tool_use", "posttooluse"):
            return 0
        # MCP tools: server__tool
        base = tool.split("__")[-1] if "__" in tool else tool
        if tool in RESEARCH_TOOLS or base in RESEARCH_TOOLS:
            _post(office, state, "research")
        else:
            # Coding / editing / shell / general work
            _post(office, state, "compose", message="Working…")
        return 0

    if event in ("post_tool_use_failure", "posttoolusefailure"):
        # Don't flip to blocked on every tool failure — too noisy
        return 0

    # Turn complete → replied, then break
    if event in ("stop",):
        reason = str(payload.get("reason") or "")
        # Session-end observe fire — already handled by SessionEnd often
        if reason and reason != "end_turn":
            return 0
        # Still waiting on background work — stay at compose
        bg = payload.get("backgroundTasks") or payload.get("background_tasks") or []
        if bg:
            _post(office, state, "compose", message="Background work…")
            return 0
        _post(office, state, "replied", message="Replied — see Grok")
        # Brief pause then break so the board shows the replied beat
        time.sleep(0.4)
        _post(office, state, "break")
        return 0

    if event in ("stop_failure", "stopfailure"):
        detail = str(payload.get("error") or "error")[:40]
        _post(office, state, "blocked", message=f"Stuck — {detail}"[:120])
        time.sleep(0.3)
        _post(office, state, "break")
        return 0

    # Subagents: light compose signal, no full circuit
    if event in ("subagent_start", "subagentstart"):
        _post(office, state, "compose", message="Delegating…")
        return 0

    return 0


def main() -> int:
    logging.basicConfig(
        level=logging.WARNING,
        format="%(levelname)s %(message)s",
        stream=sys.stderr,
    )
    # Keep hooks quiet in the TUI unless debugging
    if os.environ.get("OFFICE_HOOK_DEBUG"):
        logging.getLogger().setLevel(logging.INFO)
        log.setLevel(logging.INFO)

    payload = _read_stdin()
    office = OfficeStatus(agent_id=AGENT_ID)
    if not office.enabled:
        return 0  # fail-open: never block the agent
    try:
        return handle(payload, office)
    except Exception as e:
        log.warning("hook error: %s", e)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
