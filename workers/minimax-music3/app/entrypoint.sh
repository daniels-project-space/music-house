#!/usr/bin/env bash
set -Eeuo pipefail

MODEL_PATH="${MUSIC_HOUSE_MINIMAX_MUSIC3_MODEL_PATH:-/network/music-house/minimax-music3}"
STATUS_URL="${MUSIC_HOUSE_MINIMAX_MUSIC3_STATUS_URL:?missing status URL}"
RUN_FINISHED=0
SERVER_PID=""

publish_failure() {
  local code="$1"
  if [[ "$RUN_FINISHED" == "1" ]]; then return; fi
  python3 - "$code" <<'PY' >/tmp/music3-status.json
import json, sys
print(json.dumps({"status": "failed", "error": f"isolated MiniMax Music3 worker exited with code {sys.argv[1]}"}))
PY
  curl --fail --silent --show-error -X PUT -H 'Content-Type: application/json' \
    --upload-file /tmp/music3-status.json "$STATUS_URL" || true
}

cleanup() {
  local code="$?"
  if [[ -n "$SERVER_PID" ]]; then kill "$SERVER_PID" 2>/dev/null || true; fi
  publish_failure "$code"
  exit "$code"
}
trap cleanup EXIT

# Never download into the runtime worker. A missing model is a configuration
# failure, not a reason to mutate storage or borrow another project's cache.
if [[ ! -f "$MODEL_PATH/config.json" ]]; then
  echo "MiniMax Music3 model missing from Music House volume at $MODEL_PATH" >&2
  exit 20
fi

export CUDA_VISIBLE_DEVICES=0
sgl-omni serve --model-path "$MODEL_PATH" --port 8000 --max-running-requests 1 >/tmp/sgl-omni.log 2>&1 &
SERVER_PID="$!"

# Hard limit means a stranded application process exits even if the model server
# wedged. The parent Trigger task then deletes the exact Novita instance id.
timeout 45m python3 /app/run.py
RUN_FINISHED=1
