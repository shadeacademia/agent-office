#!/usr/bin/env bash
# Post one public status event to Agent Office.
#
# Usage:
#   export OFFICE_URL=https://office.shadeacademia.net
#   export INGEST_TOKEN=your-secret
#   ./scripts/post-status.sh ollie desk-terminal coding "Got a prompt"
#
# Args: agentId target nextState message [state]
set -euo pipefail

AGENT="${1:?agentId}"
TARGET="${2:?target desk id}"
NEXT="${3:?nextState}"
MSG="${4:?message}"
STATE="${5:-walk}"

URL="${OFFICE_URL:-https://office.shadeacademia.net}"
TOKEN="${INGEST_TOKEN:?set INGEST_TOKEN}"

curl -sS -X POST "$URL/api/events" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "$(python3 - <<PY
import json
print(json.dumps({
  "agentId": "$AGENT",
  "type": "status",
  "state": "$STATE",
  "nextState": "$NEXT",
  "target": "$TARGET",
  "message": """$MSG""",
  "ts": int(__import__("time").time() * 1000),
}))
PY
)"
echo
