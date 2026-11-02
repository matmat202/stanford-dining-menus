#!/usr/bin/env bash
# Re-scrape Stanford dining data and rebuild data/site.json in place.
# Takes ~4 minutes (252 polite requests at 0.7 s). Safe to re-run; it overwrites.
#
# This is the CLONER-FACING copy, shipped to the public repo as `refresh.sh`, where
# the site root is the repo root (hence DINING_SITE=.). It is NOT the sandbox's own
# refresh.sh, which rebuilds projects/dining-menus/site instead.
#
# It must run the same scraper sequence as publish.sh. Until 2026-11-02 it ran only
# scrape.py + build.py while the repo shipped eight scrapers, so `./refresh.sh` left
# cafés, pay venues, meal plans, libraries, rec hours, food trucks and dinner
# specials at whatever was last committed — a silently partial rebuild that looked
# like a full one. test_refresh_public.py now fails if the two sequences diverge.
#
# Each optional scraper is tolerant: a single upstream page going down must not take
# the whole rebuild with it, exactly as in publish.sh.
set -euo pipefail
cd "$(dirname "$0")"
export DINING_SITE=.

echo "[$(date -Is)] scraping menus…"
python3 scrape.py
echo "[$(date -Is)] scraping cafés…"
python3 scrape_cafes.py || echo "WARNING: café scrape failed; keeping the previous cafes.json"
echo "[$(date -Is)] scraping Meal Plan / Cardinal Dollars venues…"
python3 scrape_pay.py || echo "WARNING: pay scrape failed; keeping the previous pay.json"
echo "[$(date -Is)] scraping meal plan prices…"
python3 scrape_plans.py || echo "WARNING: meal plan scrape failed; keeping the previous plans.json"
echo "[$(date -Is)] scraping library hours…"
python3 scrape_libraries.py || echo "WARNING: library scrape failed; keeping the previous libraries.json"
echo "[$(date -Is)] scraping rec facility hours…"
python3 scrape_rec.py || echo "WARNING: rec scrape failed; keeping the previous rec.json"
echo "[$(date -Is)] scraping food truck schedules…"
python3 scrape_trucks.py || echo "WARNING: food truck scrape failed; keeping the previous trucks.json"
echo "[$(date -Is)] scraping R&DE's dinner specials calendar…"
python3 scrape_specials.py || echo "WARNING: dinner specials scrape failed; keeping the previous specials.json"

echo "[$(date -Is)] building payload…"
python3 build.py
echo "[$(date -Is)] done. data/site.json rebuilt."
