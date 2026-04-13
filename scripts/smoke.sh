#!/usr/bin/env bash
set -euo pipefail

HOST="${SCRYPT_URL:-http://localhost:3777}"
TOKEN="${SCRYPT_AUTH_TOKEN:-}"
AUTH=()
if [ -n "$TOKEN" ]; then
  AUTH=(-H "Authorization: Bearer $TOKEN")
fi

fail() { echo "FAIL: $1"; exit 1; }

echo "1. daily_context"
STATUS=$(curl -sS -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$HOST/api/daily_context")
[ "$STATUS" = "200" ] || fail "daily_context returned $STATUS"

echo "2. ingest a thread"
THREAD_PATH=$(curl -sS -X POST "${AUTH[@]}" -H "Content-Type: application/json" \
  -d '{"kind":"thread","title":"smoke test thread","content":"# test","frontmatter":{"status":"open","priority":1,"prompt":"smoke"}}' \
  "$HOST/api/ingest" | grep -o '"path":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$THREAD_PATH" ] || fail "ingest thread returned no path"

echo "3. threads list includes new thread"
curl -sS "${AUTH[@]}" "$HOST/api/threads?status=open" | grep -q "smoke-test-thread" || fail "thread not in list"

echo "4. create a research run"
RUN=$(curl -sS -X POST "${AUTH[@]}" -H "Content-Type: application/json" \
  -d '{"title":"smoke run","content":"## Summary\nfound things\n","frontmatter":{"thread":"smoke-test-thread","status":"success","started_at":"2026-04-12T00:00:00.000Z","completed_at":"2026-04-12T00:01:00.000Z"}}' \
  "$HOST/api/research_runs")
echo "$RUN" | grep -q "thread_updated" || fail "run did not update thread"

echo "5. activity log has 3+ entries"
COUNT=$(curl -sS "${AUTH[@]}" "$HOST/api/activity?limit=100" | grep -o '"id"' | wc -l)
[ "$COUNT" -ge 3 ] || fail "activity log has $COUNT entries, expected >= 3"

echo "PASS"
