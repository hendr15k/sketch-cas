#!/usr/bin/env bash
# Regression tests for the server.py hardening fixes:
#   B5 — invalid Content-Length must not crash, must return 400
#   B6 — body >25 MiB must return 413 (no OOM)
#   B6b — empty body must return 400
#   B6c — invalid JSON must return 400 (not 500)
#   B6d — happy path still returns 200
set -u

PORT=3142
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
SERVER="$SCRIPT_DIR/server.py"
LOG=$(mktemp)
PASS=0
FAIL=0

cleanup() { kill "$PID" 2>/dev/null || true; wait 2>/dev/null; rm -f "$LOG"; }
trap cleanup EXIT

cd "$SCRIPT_DIR"
python3 "$SERVER" "$PORT" > "$LOG" 2>&1 &
PID=$!
# Wait until server is ready
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then break; fi
  sleep 0.2
done

assert_status() {
  local name="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    echo "  ✓ $name (status=$got)"
    PASS=$((PASS+1))
  else
    echo "  ✗ $name: expected $want, got $got"
    FAIL=$((FAIL+1))
  fi
}

assert_body_match() {
  local name="$1" want="$2" got="$3"
  if echo "$got" | grep -q -- "$want"; then
    echo "  ✓ $name (body contains '$want')"
    PASS=$((PASS+1))
  else
    echo "  ✗ $name: body did not contain '$want', got: $got"
    FAIL=$((FAIL+1))
  fi
}

echo "--- B5: invalid Content-Length must not crash, must return 400 ---"
RESP=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/api/send-training" \
  -H 'Content-Type: application/json' -H 'Content-Length: notanumber' -d 'x')
assert_status "non-numeric CL" "400" "$RESP"
RESP=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/api/send-training" \
  -H 'Content-Type: application/json' -H 'Content-Length: ' -d 'x')
assert_status "empty CL header" "400" "$RESP"

echo "--- B6b: empty body must return 400 ---"
RESP=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/api/send-training" \
  -H 'Content-Type: application/json' -H 'Content-Length: 0' -d '')
assert_status "CL=0" "400" "$RESP"

echo "--- B6c: invalid JSON must return 400 (not 500) ---"
RESP=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/api/send-training" \
  -H 'Content-Type: application/json' -H 'Content-Length: 7' -d 'not json')
assert_status "garbage body" "400" "$RESP"
RESP=$(curl -s -X POST "http://127.0.0.1:$PORT/api/send-training" \
  -H 'Content-Type: application/json' -H 'Content-Length: 7' -d 'not json')
assert_body_match "garbage body error message" "Invalid JSON" "$RESP"

echo "--- B6: oversize body (Content-Length >25 MiB) must return 413 without reading ---"
# We send a Content-Length of 26 MiB but truncate the actual body to 0 bytes.
# The server must reject on the CL header alone, not actually read 26 MiB into RAM.
HUGE=$((26 * 1024 * 1024))
RESP=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/api/send-training" \
  -H 'Content-Type: application/json' -H "Content-Length: $HUGE" --data-binary '' --max-time 5)
assert_status "oversize CL" "413" "$RESP"
RESP=$(curl -s -X POST "http://127.0.0.1:$PORT/api/send-training" \
  -H 'Content-Type: application/json' -H "Content-Length: $HUGE" --data-binary '' --max-time 5)
assert_body_match "oversize body error message" "too large" "$RESP"

echo "--- B6d: happy path still returns 200 ---"
RESP=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/api/send-training" \
  -H 'Content-Type: application/json' -d '{"data":{"x":1}}')
assert_status "valid POST" "200" "$RESP"
RESP=$(curl -s -X POST "http://127.0.0.1:$PORT/api/send-training" \
  -H 'Content-Type: application/json' -d '{"data":{"x":1}}')
assert_body_match "valid POST body" '"ok": true' "$RESP"

echo "--- B6e: negative Content-Length must return 400 ---"
RESP=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/api/send-training" \
  -H 'Content-Type: application/json' -H 'Content-Length: -1' -d 'x')
assert_status "negative CL" "400" "$RESP"

# Make sure the server is still alive (none of the above crashed it)
if ! kill -0 "$PID" 2>/dev/null; then
  echo "  ✗ server process died during tests (catastrophic)"
  FAIL=$((FAIL+1))
  cat "$LOG"
else
  echo "  ✓ server still alive after all attacks"
  PASS=$((PASS+1))
fi

echo
echo "=== Summary ==="
echo "Passed: $PASS / $((PASS+FAIL))"
if [ "$FAIL" -gt 0 ]; then
  echo "Server log tail:"
  tail -20 "$LOG"
  exit 1
fi
exit 0
