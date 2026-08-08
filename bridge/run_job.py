#!/usr/bin/env python3
"""Run one local Ollama job and drive Ollie's public office circuit.

Full prompt/answer print to this terminal (or stay in Telegram/OWUI).
Only short phase lines go to office.shadeacademia.net.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
import urllib.request
from pathlib import Path

# allow `python bridge/run_job.py` from repo root
sys.path.insert(0, str(Path(__file__).resolve().parent))

from office_status import OfficeStatus  # noqa: E402

log = logging.getLogger("run-job")

DEFAULT_MODEL = "huihui_ai/qwen3-abliterated:8b-v2"
OLLAMA = "http://127.0.0.1:11434"


def ollama_chat(model: str, prompt: str, timeout: float = 300.0) -> str:
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "options": {"num_predict": 512},
    }
    req = urllib.request.Request(
        f"{OLLAMA}/api/chat",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return (data.get("message") or {}).get("content") or ""


def run_job(
    prompt: str,
    *,
    model: str,
    research: bool,
    office: OfficeStatus,
    pause: float,
) -> str:
    office.got_prompt()
    time.sleep(pause)

    if research:
        office.researching()
        time.sleep(pause)
        # Theater for now — real search is Telegram bridge's job
    else:
        # still a short beat so Compose isn't instant
        time.sleep(min(pause, 1.0))

    office.writing()
    try:
        answer = ollama_chat(model, prompt)
    except Exception as e:
        log.exception("ollama failed")
        office.stuck(type(e).__name__)
        time.sleep(pause)
        office.on_break()
        raise

    office.replied()
    time.sleep(pause)
    office.on_break()
    return answer


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("prompt", nargs="?", help="User prompt (or pass on stdin)")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument(
        "--research",
        action="store_true",
        help="Visit Research desk before Compose (timed theater)",
    )
    ap.add_argument(
        "--pause",
        type=float,
        default=2.0,
        help="Seconds between office phase posts",
    )
    ap.add_argument(
        "--no-office",
        action="store_true",
        help="Skip public status posts (local Ollama only)",
    )
    args = ap.parse_args()

    prompt = args.prompt
    if not prompt:
        prompt = sys.stdin.read().strip()
    if not prompt:
        print("Need a prompt", file=sys.stderr)
        return 1

    office = OfficeStatus(enabled=not args.no_office)
    log.info("Office %s → %s", "ON" if office.enabled else "OFF", office.url)
    log.info("Model %s", args.model)

    try:
        answer = run_job(
            prompt,
            model=args.model,
            research=args.research,
            office=office,
            pause=args.pause,
        )
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    print("\n—— private reply (not posted to office) ——\n")
    print(answer or "(empty model response)")
    print("\n—— end ——")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
