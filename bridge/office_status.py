#!/usr/bin/env python3
"""Post public status events to Agent Office (never full chat text).

Default agent is Ollie (local LLM / Telegram). Pass agent_id=\"grok\" (or
OFFICE_AGENT_ID) when driving Grok Build sessions.
"""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

log = logging.getLogger("office-status")

# agent-office/.local next to bridge/
_ROOT = Path(__file__).resolve().parents[1]
_LOCAL = _ROOT / ".local"

DEFAULT_URL = "https://office.shadeacademia.net"
DEFAULT_AGENT_ID = "ollie"
ALLOWED_AGENTS = frozenset({"ollie", "grok", "ansel", "nova", "byte"})
# Back-compat alias
AGENT_ID = DEFAULT_AGENT_ID

# Public phase lines only
PHASES: dict[str, dict[str, str]] = {
    "terminal": {
        "target": "desk-terminal",
        "state": "walk",
        "nextState": "coding",
        "message": "Got a prompt",
    },
    "research": {
        "target": "desk-research",
        "state": "walk",
        "nextState": "review",
        "message": "Researching…",
    },
    "compose": {
        "target": "desk-compose",
        "state": "walk",
        "nextState": "coding",
        "message": "Writing a reply…",
    },
    "replied": {
        "target": "desk-compose",
        "state": "walk",
        "nextState": "coding",
        "message": "Replied — see chat",
    },
    "break": {
        "target": "desk-break",
        "state": "walk",
        "nextState": "break",
        "message": "On break",
    },
    "blocked": {
        "target": "desk-break",
        "state": "walk",
        "nextState": "blocked",
        "message": "Stuck — check the bridge",
    },
}


def _load_dotenv(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        # support: export KEY='val'
        if line.startswith("export "):
            line = line[len("export ") :]
        k, v = line.split("=", 1)
        v = v.strip().strip('"').strip("'")
        # $(cat ...) not expanded here
        out[k.strip()] = v
    return out


def load_config() -> tuple[str, str]:
    """Return (office_url, ingest_token)."""
    envf = _load_dotenv(_LOCAL / "cloudflare.env")
    url = (
        os.environ.get("OFFICE_URL")
        or envf.get("OFFICE_URL")
        or DEFAULT_URL
    ).rstrip("/")

    token = os.environ.get("INGEST_TOKEN") or os.environ.get("OFFICE_INGEST_TOKEN") or ""
    if not token:
        token_path = _LOCAL / "ingest_token"
        if token_path.is_file():
            token = token_path.read_text(encoding="utf-8").strip()
    if not token:
        # cloudflare.env may reference $(cat ...) — read file directly above
        pass
    return url, token


def resolve_agent_id(agent_id: str | None = None) -> str:
    """Pick agent id from arg, OFFICE_AGENT_ID, or default (ollie)."""
    raw = (agent_id or os.environ.get("OFFICE_AGENT_ID") or DEFAULT_AGENT_ID).strip().lower()
    if raw not in ALLOWED_AGENTS:
        log.warning("Unknown agent_id %r — using %s", raw, DEFAULT_AGENT_ID)
        return DEFAULT_AGENT_ID
    return raw


class OfficeStatus:
    """Fire-and-forget public status board client."""

    def __init__(
        self,
        url: str | None = None,
        token: str | None = None,
        *,
        enabled: bool | None = None,
        agent_id: str | None = None,
        timeout: float = 15.0,
    ) -> None:
        cfg_url, cfg_token = load_config()
        self.url = (url or cfg_url).rstrip("/")
        self.token = token if token is not None else cfg_token
        self.agent_id = resolve_agent_id(agent_id)
        self.timeout = timeout
        if enabled is None:
            enabled = os.environ.get("OFFICE_STATUS", "1").strip() not in (
                "0",
                "false",
                "off",
                "no",
            )
        self.enabled = bool(enabled and self.token)
        if not self.token:
            log.warning("Office status disabled: no INGEST_TOKEN")
        elif not self.enabled:
            log.info("Office status disabled via OFFICE_STATUS")

    def post(self, phase: str, *, message: str | None = None) -> bool:
        """Post a named phase. Returns True on success."""
        if not self.enabled:
            return False
        spec = PHASES.get(phase)
        if not spec:
            log.error("Unknown phase %r", phase)
            return False
        body: dict[str, Any] = {
            "agentId": self.agent_id,
            "type": "status",
            "state": spec["state"],
            "nextState": spec["nextState"],
            "target": spec["target"],
            "message": (message or spec["message"])[:120],
            "ts": int(time.time() * 1000),
        }
        return self._send(body)

    def _send(self, body: dict[str, Any]) -> bool:
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            f"{self.url}/api/events",
            data=data,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.token}",
                "User-Agent": "agent-office-bridge/1.0",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8", "replace")
                ok = resp.status == 200
                if not ok:
                    log.warning("office POST %s: %s", resp.status, raw[:200])
                else:
                    log.info("office phase → %s (%s)", body.get("message"), body.get("target"))
                return ok
        except urllib.error.HTTPError as e:
            err = e.read().decode("utf-8", "replace")
            log.warning("office POST HTTP %s: %s", e.code, err[:200])
            return False
        except Exception as e:
            log.warning("office POST failed: %s", e)
            return False

    # Convenience aliases
    def got_prompt(self) -> bool:
        return self.post("terminal")

    def researching(self) -> bool:
        return self.post("research")

    def writing(self) -> bool:
        return self.post("compose")

    def replied(self) -> bool:
        return self.post("replied")

    def on_break(self) -> bool:
        return self.post("break")

    def stuck(self, detail: str | None = None) -> bool:
        msg = "Stuck — check the bridge"
        if detail:
            msg = f"Stuck — {detail}"[:120]
        return self.post("blocked", message=msg)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    import argparse

    p = argparse.ArgumentParser(description="Post one public office phase")
    p.add_argument(
        "phase",
        choices=list(PHASES.keys()),
        help="Phase to post",
    )
    p.add_argument("-m", "--message", help="Override public message (still short)")
    p.add_argument(
        "-a",
        "--agent",
        default=None,
        help="Agent id (ollie|grok|…). Default: OFFICE_AGENT_ID or ollie",
    )
    args = p.parse_args()
    office = OfficeStatus(agent_id=args.agent)
    if not office.enabled:
        print("disabled or missing token", file=__import__("sys").stderr)
        return 1
    ok = office.post(args.phase, message=args.message)
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
