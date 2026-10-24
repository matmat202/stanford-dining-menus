#!/usr/bin/env bash
# Backstop refresh: runs in the PUBLIC repo (GitHub Actions, .github/workflows/refresh.yml),
# not in the sandbox. The laptop's publish.sh is still the primary path; this only scrapes
# when the live payload has gone stale, so a suspended laptop no longer means stale menus.
#
# Measured before it was built (projects/sleep-proof-refresh/BRIEF.md): the live payload was
# >24h old for 22% of 10-18..10-24, worst gap 51.5h, all of it the laptop asleep.
#
#   ./backstop.sh            scrape + build + gate if stale; leaves the result uncommitted
#   ./backstop.sh --push     ...and commit + push the data files
#   MAX_AGE_H=20             hours before the payload counts as stale (default 20)
#   BACKSTOP_FORCE=1         scrape regardless of age
#
# Menus, cafés and food trucks. Those scrapers honour DINING_SITE; the library and rec
# ones write to a sandbox-only path, and their hours change weekly, not daily.
# Trucks are here because they are DATED shifts with only a few days of lookahead: a
# suspended laptop empties the Trucks tab faster than it staled the menus.
# Uses the repo's OWN scrape.py/build.py, i.e. the live builder, so the payload always
# matches the live page — the same reason publish.sh's data-only path refuses a changed builder.
set -euo pipefail
cd "$(dirname "$0")"
export DINING_SITE=.
PUSH=0
for arg in "$@"; do
  case "$arg" in
    --push) PUSH=1 ;;
    *) echo "backstop.sh: unknown argument '$arg' (expected --push)"; exit 64 ;;
  esac
done

age=$(python3 - <<'PY'
import json
from datetime import datetime, timezone
s = json.load(open("data/site.json"))["scraped_at"]
print(f"{(datetime.now(timezone.utc) - datetime.fromisoformat(s)).total_seconds() / 3600:.1f}")
PY
)
if [ "${BACKSTOP_FORCE:-0}" != 1 ] && python3 -c "import sys; sys.exit(0 if float('$age') <= float('${MAX_AGE_H:-20}') else 1)"; then
  echo "fresh: live payload is ${age}h old (<= ${MAX_AGE_H:-20}h); the laptop has it — nothing to do"
  exit 0
fi
echo "stale: live payload is ${age}h old — scraping"

python3 "${SCRAPE_PY:-scrape.py}"
python3 "${SCRAPE_CAFES_PY:-scrape_cafes.py}" || echo "WARNING: café scrape failed; keeping the previous cafes.json"
python3 "${SCRAPE_TRUCKS_PY:-scrape_trucks.py}" || echo "WARNING: food truck scrape failed; keeping the previous trucks.json"
python3 build.py

# The same two blocking checks publish.sh applies: broken logic code, and a scrape that came
# back thin because upstream changed. Either leaves the previous deploy serving.
for t in *.test.mjs; do
  if ! node "$t" >/dev/null 2>&1; then
    echo "REFUSING TO PUBLISH: $t fails — run 'node $t'"
    exit 1
  fi
done
python3 - <<'PY'
import json, sys
d = json.load(open("data/site.json"))
n, dishes = len(d["menus"]), len(d["dishes"])
if n < 60 or dishes < 120:
    sys.exit(f"REFUSING TO PUBLISH: only {n} menus / {dishes} distinct dishes — upstream likely changed")
print(f"gate ok: {n} menus, {dishes} distinct dishes")
PY

[ "$PUSH" = 1 ] || { echo "built; not pushing (no --push)"; exit 0; }
git add data/site.json data/cafes.json
if [ -f data/trucks.json ]; then git add data/trucks.json; fi   # absent in a repo predating the Trucks ship
if git diff --cached --quiet; then
  echo "no change to publish"
  exit 0
fi
git -c user.email=noreply@anthropic.com -c user.name="Claude" \
    commit -q -m "Refresh menus $(date -u +%Y-%m-%d) (backstop: laptop payload was ${age}h old)"
# The laptop may have pushed while this scraped. Its data is as fresh as ours, so lose to it —
# but only if that is what happened. A rejection for any other reason (auth, protection) must
# fail the run, or a backstop that never lands would report green every day.
if ! git push -q origin HEAD:main; then
  git fetch -q origin main
  if git show origin/main:data/site.json | python3 -c "
import json, sys
from datetime import datetime, timezone
s = json.load(sys.stdin)['scraped_at']
sys.exit(0 if (datetime.now(timezone.utc) - datetime.fromisoformat(s)).total_seconds() / 3600 <= float('${MAX_AGE_H:-20}') else 1)"; then
    echo "push rejected: the laptop published a fresh payload meanwhile — dropping this run's commit"
    exit 0
  fi
  echo "ERROR: push rejected and origin/main is still stale"
  exit 1
fi
echo "pushed"
