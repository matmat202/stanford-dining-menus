#!/usr/bin/env python3
"""Where Meal Plan Dollars and Cardinal Dollars work — and the hours of the places that take them.

The question, asked on r/stanford: "Where can I use my dining dollars on the weekends???
Everywhere is closed. The only places open accept cardinal dollars which is different from
what I have." (2025-11). R&DE answers half of it on the Cardinal Dollars page (a table of
which venue takes which) and the other half on the Tresidder and Markets pages (hours); the
cafés page the site already reads covers only TAP of the table's twelve rows. This joins them.

Why a separate scraper and data file, not more of scrape_cafes.py: publish.sh refuses a
data-only publish while a live scraper differs from its published copy. Editing
scrape_cafes.py would stop the hourly menu refresh until the next --ship-code; a new file
cannot, because the guard only bites once a scraper is live.

    python3 scrape_pay.py           # write site/data/pay.json
    python3 scrape_pay.py --dump    # print what was found, write nothing
"""
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import scrape_cafes as C  # noqa: E402  (venue blocks and hours parsing; same page template)

SITE = os.environ.get("DINING_SITE") or os.path.join(HERE, "site")
OUT = os.path.join(SITE, "data", "pay.json")
BASE = "https://rde.stanford.edu/dining-hospitality/"
PAY_URL = BASE + "cardinal-dollars"
HOURS_URLS = [BASE + "union-square-tresidder-memorial-union", BASE + "markets"]


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": C.UA})
    return urllib.request.urlopen(req, timeout=45).read().decode("utf-8", "replace")


def accepts(page):
    """The 'Locations Accepting Cardinal Dollars and Meal Plan Dollars' table ->
    [{name, cd, mpd, cashback}]. Columns are found by header text, not position."""
    m = re.search(r"<table.*?</table>", page, re.S)
    if not m:
        return []
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", m.group(0), re.S)
    if not rows:
        return []
    head = [C.text_of(c).lower() for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", rows[0], re.S)]
    col = {}
    for i, h in enumerate(head):
        if "cardinal" in h:
            col["cd"] = i
        elif "meal plan" in h:
            col["mpd"] = i
        elif "cash back" in h:
            col["cashback"] = i
    if set(col) != {"cd", "mpd", "cashback"}:
        return []                       # the table changed shape; say so rather than guess
    out = []
    for r in rows[1:]:
        cells = [C.text_of(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)]
        if len(cells) < len(head) or not cells[0]:
            continue
        out.append({"name": clean(cells[0]),
                    **{k: cells[i].strip().lower() == "x" for k, i in col.items()}})
    return out


def clean(name):
    # R&DE's headings carry zero-width spaces ("​Kikka Sushi") and stray nbsp.
    return " ".join(name.replace("​", "").replace("﻿", "").split())


def hour_venues(page):
    """Venues with hours from a Tresidder-style page. Each block is cut at the next
    paragraph so a trailing non-venue heading ("Meet our staff") cannot be taken as the
    name of the last venue — on the Tresidder page it renamed SAJJ Mediterranean."""
    parts = page.split(C.BLOCK)
    page = C.BLOCK.join([parts[0]] + [p.split("paragraph--type")[0] for p in parts[1:]])
    vs = C.venues(page)
    for v in vs:
        v["name"] = clean(v["name"])
    return vs


SHORT = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def late_night_venues(rows, halls):
    """The accepts table lists 'Arrillaga Nights @ AFDC' and 'Late Night @ Lakeside', whose
    hours no café page carries but halls.json does (latenight: label, 'Tue–Sat', [open, close]).
    A row matches a hall when it starts with that hall's label and carries the hall's first
    word ("Arrillaga Nights @ AFDC" for Arrillaga Family Dining Commons); the venue keeps the table's name so the page joins them by key."""
    out = []
    for h in (halls or {}).values():
        ln = h.get("latenight")
        if not ln:
            continue
        label, hall = ln["label"].lower(), h["name"].lower().split()[0]
        m = re.match(r"(\w{3})\w*\s*[-–—]\s*(\w{3})", ln.get("days", ""))
        if not m or m.group(1).lower() not in SHORT or m.group(2).lower() not in SHORT:
            continue
        a, b = SHORT.index(m.group(1).lower()), SHORT.index(m.group(2).lower())
        days = [d % 7 for d in range(a, (b if b >= a else b + 7) + 1)]
        o, c = ln["hours"]
        for r in rows:
            n = r["name"].lower()
            if n.startswith(label) and hall in n:
                out.append({"name": r["name"], "description": f"Late night at {h['name']}",
                            "hours_text": [f"{ln['days']} {o}–{c} (from the Halls hours)"],
                            "windows": [{"days": days, "open": o, "close": c, "overnight": c <= o}]})
    return out


def build(pay_page, hours_pages, halls=None):
    rows = accepts(pay_page)
    venues, seen = [], set()
    for p in hours_pages:
        for v in hour_venues(p):
            if v["name"] not in seen:     # Decadence Mini Market is on both pages
                seen.add(v["name"])
                venues.append(v)
    venues += late_night_venues(rows, halls)
    return {"source": PAY_URL, "hours_sources": HOURS_URLS, "accepts": rows, "venues": venues}


def main():
    pay_page = fetch(PAY_URL)
    hours_pages = []
    for u in HOURS_URLS:
        try:
            hours_pages.append(fetch(u))
        except Exception as e:  # a missing hours page costs hours, not the accepts table
            print(f"scrape_pay: WARNING {u}: {e}", file=sys.stderr)
    with open(os.path.join(HERE, "halls.json")) as f:
        halls = json.load(f)
    p = build(pay_page, hours_pages, halls.get("halls", halls))
    if not p["accepts"]:
        print("scrape_pay: no accepts table found — the Cardinal Dollars page changed", file=sys.stderr)
        return 2
    if "--dump" in sys.argv:
        for a in p["accepts"]:
            print(f"  {a['name']:<34} C$ {'x' if a['cd'] else '.'}  MP$ {'x' if a['mpd'] else '.'}"
                  f"  3% {'x' if a['cashback'] else '.'}")
        for v in p["venues"]:
            print(f"  hours: {v['name']}: {' · '.join(v['hours_text'])}")
        return 0
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(p, f, separators=(",", ":"))
    print(f"wrote {OUT} — {len(p['accepts'])} venues in the accepts table, "
          f"{sum(a['mpd'] for a in p['accepts'])} take Meal Plan Dollars; {len(p['venues'])} with hours")
    return 0


if __name__ == "__main__":
    sys.exit(main())
