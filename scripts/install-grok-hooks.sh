#!/usr/bin/env bash
# Install Grok Build hooks so the Grok body on Agent Office follows your sessions.
# Safe to re-run (overwrites ~/.grok/hooks/agent-office.json).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK_PY="$ROOT/bridge/grok_office_hook.py"
DEST_DIR="${GROK_HOME:-$HOME/.grok}/hooks"
DEST="$DEST_DIR/agent-office.json"

if [[ ! -f "$HOOK_PY" ]]; then
  echo "missing $HOOK_PY" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
# Escape for JSON string
CMD="python3 $(printf '%s' "$HOOK_PY" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read())[1:-1])')"

cat > "$DEST" <<EOF
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "$CMD", "timeout": 15 }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "$CMD", "timeout": 15 }
        ]
      }
    ],
    "PreToolUse": [
      {
        "hooks": [
          { "type": "command", "command": "$CMD", "timeout": 15 }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "$CMD", "timeout": 20 }
        ]
      }
    ],
    "StopFailure": [
      {
        "hooks": [
          { "type": "command", "command": "$CMD", "timeout": 15 }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          { "type": "command", "command": "$CMD", "timeout": 15 }
        ]
      }
    ],
    "SubagentStart": [
      {
        "hooks": [
          { "type": "command", "command": "$CMD", "timeout": 15 }
        ]
      }
    ]
  }
}
EOF

chmod +x "$HOOK_PY" 2>/dev/null || true
echo "Installed $DEST"
echo "Hook script: $HOOK_PY"
echo "Restart Grok (or open a new session) and check /hooks."
echo "Token: agent-office/.local/ingest_token or INGEST_TOKEN env."
echo "Disable: OFFICE_STATUS=0"
