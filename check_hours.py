#!/usr/bin/env python3
"""Detect drift between R&DE's published hours and this project's halls.json.

The site shows "serving now", "closes in 25 min" and sorts halls serving-first — all
from `halls.json`, which hard-codes R&DE's academic-quarter hours. Those change
between quarters and on holidays. Stale hours do not make the site merely out of
date, they make it *wrong about something it states prominently*, which is worse than
having no hours at all.

So this re-reads the hours page and diffs it. Exit 1 on drift, 0 when clean. Wired
into publish.sh as a warning rather than a blocker: drifting hours should not stop
today's menus from being published.

    python3 check_hours.py [--json]
"""
import html
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
META = os.path.join(HERE, "halls.json")
URL = "https://rde.stanford.edu/dining-hospitality/dining-locations-hours"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"

# Page name -> halls.json key. Late-night blocks are listed as their own headings.
HALL_MAP = {
    "Arrillaga Family Dining Commons": "Arrillaga",
    "Lakeside Dining": "Lakeside",
    "Wilbur Dining": "Wilbur",
    "Stern Dining": "Stern",
    "Florence Moore Dining": "FlorenceMoore",
    "Ricker Dining": "Ricker",
    "Gerhard Casper Dining Commons": "GerhardCasper",
    "Branner Dining": "Branner",
}
LATE = {"Arrillaga Nights": "Arrillaga", "Late Night at Lakeside": "Lakeside"}

HEADING = re.compile("^(" + "|".join(re.escape(k) for k in
                     list(HALL_MAP) + list(LATE)) + r")\b")
DAYBAND = re.compile(r"^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*[-–]\s*"
                     r"(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)", re.I)
MEAL = re.compile(r"^(?:(Breakfast|Brunch/Lunch|Brunch|Lunch|Dinner)\s*:\s*)?"
                  r"(\d{1,2}):(\d{2})\s*([ap])\.?m\.?\s*[-–]\s*"
                  r"(\d{1,2}):(\d{2})\s*([ap])\.?m\.?", re.I)
WEEKEND_START = ("saturday", "sunday")


def hhmm(h, m, ap):
    h = int(h) % 12 + (12 if ap.lower() == "p" else 0)
    return f"{h:02d}:{m}"


def norm(span):
    """Zero-pad both sides before comparing: '2:00' and '02:00' are the same time,
    and reporting that as drift would train the reader to ignore this check."""
    if not span:
        return span
    out = []
    for t in span:
        hh, _, mm = str(t).partition(":")
        out.append(f"{int(hh):02d}:{mm}")
    return out


def fetch():
    req = urllib.request.Request(URL, headers={"User-Agent": UA})
    raw = urllib.request.urlopen(req, timeout=45).read().decode("utf-8", "replace")
    body = re.sub(r"<(script|style).*?</\1>", "", raw, flags=re.S)
    text = html.unescape(re.sub(r"<[^>]+>", "\n", body))
    return [l.strip() for l in text.split("\n") if l.strip()]


def parse(lines):
    """-> ({hall: {band: {meal: [start, end]}}}, {hall: [start, end]} for late night)"""
    hours, late = {}, {}
    cur, band, is_late = None, None, False
    for l in lines:
        h = HEADING.match(l)
        if h:
            name = h.group(1)
            is_late = name in LATE
            cur = LATE[name] if is_late else HALL_MAP[name]
            band = None
            if not is_late:
                hours.setdefault(cur, {})
            continue
        if cur and DAYBAND.match(l):
            band = "weekend" if DAYBAND.match(l).group(1).lower() in WEEKEND_START else "weekday"
            continue
        m = MEAL.match(l)
        if not (m and cur):
            continue
        span = [hhmm(m.group(2), m.group(3), m.group(4)),
                hhmm(m.group(5), m.group(6), m.group(7))]
        if is_late:
            late[cur] = span
        elif band:
            meal = (m.group(1) or "").strip()
            # R&DE labels the weekend meal "Brunch/Lunch" but files its menu under Lunch
            meal = "Lunch" if meal.lower().startswith("brunch") else meal
            if meal:
                hours[cur].setdefault(band, {})[meal] = span
    return hours, late


def main():
    want_json = "--json" in sys.argv
    with open(META) as f:
        local = json.load(f)["halls"]
    try:
        hours, late = parse(fetch())
    except Exception as e:                       # network/parse: report, do not crash callers
        print(f"check_hours: could not read the hours page: {e}", file=sys.stderr)
        return 2
    if not hours:
        print("check_hours: parsed zero halls — the page layout probably changed",
              file=sys.stderr)
        return 2

    drift = []
    for hall, bands in sorted(hours.items()):
        mine = (local.get(hall) or {}).get("hours") or {}
        for band in ("weekday", "weekend"):
            theirs = bands.get(band)
            ours = mine.get(band)
            theirs = {k: norm(v) for k, v in (theirs or {}).items()} or None
            ours = {k: norm(v) for k, v in (ours or {}).items()} or None
            if theirs and not ours:
                drift.append(f"{hall}/{band}: published but missing locally -> {theirs}")
            elif ours and not theirs:
                drift.append(f"{hall}/{band}: we claim {ours} but the page lists none "
                             f"(hall likely closed this band)")
            elif theirs and ours and theirs != ours:
                for meal in sorted(set(theirs) | set(ours)):
                    if theirs.get(meal) != ours.get(meal):
                        drift.append(f"{hall}/{band}/{meal}: ours={ours.get(meal)} "
                                     f"published={theirs.get(meal)}")
    for hall, span in sorted(late.items()):
        ours = norm((local.get(hall) or {}).get("latenight", {}).get("hours"))
        span = norm(span)
        if ours and ours != span:
            drift.append(f"{hall}/latenight: ours={ours} published={span}")

    if want_json:
        print(json.dumps({"drift": drift, "published": hours, "latenight": late}, indent=2))
    else:
        print(f"checked {len(hours)} halls against halls.json")
        if drift:
            print(f"\nDRIFT ({len(drift)}):")
            for d in drift:
                print(f"  - {d}")
            print("\nUpdate halls.json, then ./publish.sh to push corrected hours.")
        else:
            print("no drift — published hours match halls.json")
    return 1 if drift else 0


if __name__ == "__main__":
    sys.exit(main())
