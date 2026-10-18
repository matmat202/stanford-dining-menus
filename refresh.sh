#!/usr/bin/env bash
# Re-scrape Stanford dining menus and rebuild data/site.json in place.
# Takes ~4 minutes (252 polite requests at 0.7 s). Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")"
export DINING_SITE=.
python3 scrape.py
python3 build.py
