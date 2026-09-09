#!/usr/bin/env bash
# End-to-end smoke test against the mock LLM server for both protocols.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(cd ../.. && pwd)"
TMP="$(mktemp -d)"
MOCK_PORT=3999; PORT=3111
npx tsx test/mock-llm-server.ts $MOCK_PORT >"$TMP/mock.log" 2>&1 & MOCK=$!
DATA_DIR="$TMP/data" SKILLS_DIR="$ROOT/skills" PORT=$PORT WEB_DIST="$ROOT/apps/web/dist" node --no-warnings=ExperimentalWarning dist/index.js >"$TMP/server.log" 2>&1 & SRV=$!
trap 'kill $MOCK $SRV 2>/dev/null; echo "logs in $TMP"' EXIT
for i in $(seq 1 40); do curl -sf 127.0.0.1:$PORT/api/health >/dev/null && break; sleep 0.25; done
B="http://127.0.0.1:$PORT/api"
J='-H Content-Type:application/json'

echo "== providers"
OAI=$(curl -sf $J -d '{"name":"mock-openai","type":"openai","baseUrl":"http://127.0.0.1:'$MOCK_PORT'/v1","apiKey":"k"}' $B/providers | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
ANT=$(curl -sf $J -d '{"name":"mock-anthropic","type":"anthropic","baseUrl":"http://127.0.0.1:'$MOCK_PORT'","apiKey":"k"}' $B/providers | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
echo "remote models (openai): $(curl -sf $B/providers/$OAI/remote-models)"
echo "remote models (anthropic): $(curl -sf $B/providers/$ANT/remote-models)"
MO=$(curl -sf $J -d '{"modelId":"mock-model","isDefault":true}' $B/providers/$OAI/models | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
MA=$(curl -sf $J -d '{"modelId":"mock-model","thinking":"adaptive"}' $B/providers/$ANT/models | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
echo "test (openai): $(curl -sf $J -d '{}' $B/providers/$OAI/test)"
echo "test (anthropic): $(curl -sf $J -d '{}' $B/providers/$ANT/test)"

for PAIR in "openai:$MO" "anthropic:$MA"; do
  NAME=${PAIR%%:*}; MID=${PAIR#*:}
  echo "== chat via $NAME (skill tool loop)"
  C=$(curl -sf $J -d '{"modelId":"'$MID'"}' $B/conversations | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
  curl -sN $J -d '{"text":"hello world"}' $B/conversations/$C/messages | grep -E '^event:' | sort | uniq -c | sort -rn | tr '\n' ' '; echo
  echo "messages: $(curl -sf $B/conversations/$C | node -pe 'const c=JSON.parse(require("fs").readFileSync(0)); c.title+" | "+c.messages.map(m=>m.role+":"+m.content.map(b=>b.type).join("+")).join(", ")')"
done

echo "== office upload (docx -> extracted text reaches the provider)"
npx tsx -e 'import("./test/fixtures/office.js").then(async m=>require("fs").writeFileSync("'"$TMP"'/q.docx", await m.makeDocx()))'
AID=$(curl -sf -F "file=@$TMP/q.docx;type=application/octet-stream" $B/uploads | node -pe 'JSON.parse(require("fs").readFileSync(0))[0].id')
C=$(curl -sf $J -d '{"modelId":"'$MO'"}' $B/conversations | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
curl -sN $J -d '{"text":"summarise","attachmentIds":["'$AID'"]}' $B/conversations/$C/messages >/dev/null
REPLY=$(curl -sf $B/conversations/$C | node -pe 'const c=JSON.parse(require("fs").readFileSync(0)); c.messages.filter(m=>m.role==="assistant").map(m=>m.content.filter(b=>b.type==="text").map(b=>b.text).join("")).join(" ")')
echo "reply: $REPLY"
case "$REPLY" in *'<file name="q.docx">'*'季度报告'*) echo "docx extraction OK";; *) echo "FAIL: docx text did not reach the provider"; exit 1;; esac

echo "== groups"
G=$(curl -sf $J -d '{"name":"研究"}' $B/groups | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
CG=$(curl -sf $J -d '{"modelId":"'$MO'","title":"grouped chat","groupId":"'$G'"}' $B/conversations | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
COUNT() { curl -sf "$1" | node -pe 'JSON.parse(require("fs").readFileSync(0)).length'; }
[ "$(COUNT "$B/conversations?groupId=$G")" = 1 ] || { echo "FAIL: conversation not listed in its group"; exit 1; }
[ "$(COUNT "$B/conversations?groupId=$G&q=grouped")" = 1 ] || { echo "FAIL: in-group search found nothing"; exit 1; }
[ "$(COUNT "$B/conversations?groupId=$G&q=nomatchxyz")" = 0 ] || { echo "FAIL: in-group search matched too much"; exit 1; }
curl -sf -X PUT $J -d '{"groupId":null}' $B/conversations/$CG >/dev/null
[ "$(COUNT "$B/conversations?groupId=$G")" = 0 ] || { echo "FAIL: conversation still in group after move out"; exit 1; }
curl -sf -X PUT $J -d '{"groupId":"'$G'"}' $B/conversations/$CG >/dev/null
curl -sf -X DELETE $B/groups/$G >/dev/null
curl -sf $B/conversations/$CG | node -pe 'const c=JSON.parse(require("fs").readFileSync(0)); if(c.groupId!==null){console.error("FAIL: group delete lost the conversation");process.exit(1)} "group delete keeps chats ungrouped OK"'
echo "groups OK"

echo "== skills"
curl -sf $B/skills | node -pe 'JSON.parse(require("fs").readFileSync(0)).skills.map(s=>s.name).join(",")'
echo "== static (prod)"
curl -sf -o /dev/null -w "index.html %{http_code}\n" 127.0.0.1:$PORT/
curl -sf -o /dev/null -w "spa fallback %{http_code}\n" 127.0.0.1:$PORT/settings/mcp
echo "SMOKE OK"
