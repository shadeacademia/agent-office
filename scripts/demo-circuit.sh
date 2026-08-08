#!/usr/bin/env bash
# Walk Ollie through Terminal → Research → Compose → Break (public status only).
#
# Usage:
#   export OFFICE_URL=https://office.shadeacademia.net
#   export INGEST_TOKEN=your-secret
#   ./scripts/demo-circuit.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
URL="${OFFICE_URL:-https://office.shadeacademia.net}"
TOKEN="${INGEST_TOKEN:?set INGEST_TOKEN}"

post() {
  local target="$1" next="$2" msg="$3" state="${4:-walk}"
  echo "→ $msg ($target)"
  curl -sS -X POST "$URL/api/events" \
    -H "content-type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "$(python3 - <<PY
import json, time
print(json.dumps({
  "agentId": "ollie",
  "type": "status",
  "state": "$state",
  "nextState": "$next",
  "target": "$target",
  "message": "$msg",
  "ts": int(time.time() * 1000),
}))
PY
)"
  echo
  sleep "${DELAY:-3}"
}

echo "Demo circuit → $URL"
post desk-terminal coding "Got a prompt"
post desk-research review "Researching…"
post desk-compose coding "Writing a reply…"
post desk-compose coding "Replied — see chat"
post desk-break break "On break"
echo "Done. Open $URL?live=1 (or auto-live once events exist)."
