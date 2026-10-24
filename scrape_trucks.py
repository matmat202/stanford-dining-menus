#!/usr/bin/env python3
"""scrape_trucks.py — campus food trucks, dated: which truck, where, and when.

Two keyless sources, both linked from R&DE's Mobile Food Vendors page. What the probe
(2026-10-24) established before this was written:

  * rde.stanford.edu/dining-hospitality/mobile-food-vendors carries the School of
    Medicine "Food Truck Market Calendar": one week, a heading "October 26–30, 2026",
    a "Location:" line, and a table of <tr>s whose first cell is "<strong>Monday</strong>
    <br>...<strong>October 26</strong>", second the vendor (usually a link), third the
    hours "10:00 AM–3:00 PM". The year is only in the heading.
  * cityflavor.com/locations/stanford-university-y2e2/ is the "recurring schedule" R&DE
    links for South Services Road by Y2E2. One `date-bar` per day for the next week,
    "Monday, Oct 26" with NO year, and today is written "Today (Saturday, Oct 24)".
    Each day holds zero or more `shift` blocks: an <h5> time "11 a.m. - 2 p.m.", the
    vendor in `vendor-title` <h4>, the cuisine in the <h5> under it, and dietary
    badges as data-tooltip="Vendor has vegetarian options available.".
  * City Flavor drops a shift once it ends ("All shifts completed for today"), so a
    scrape after 2 pm loses today's truck. Today's rows from the previous trucks.json
    are kept when the new page has none for that source and date: the truck did come.

Neither source accepts meal plan or Cardinal Dollars (R&DE says so); the page says it.
Times are Pacific wall-clock 'HH:MM', as published. No coordinates: neither source
gives any, and a guessed pin would put a walking time on a guess.
"""
import datetime as dt
import html
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
# DINING_SITE lets the public repo (flat layout: ./data) run this scraper from backstop.sh,
# the same override scrape.py and scrape_cafes.py honour. Trucks are DATED shifts with only
# a few days of lookahead, so they go stale faster than menus, not slower.
SITE = os.environ.get("DINING_SITE") or os.path.join(HERE, "site")
OUT = os.path.join(SITE, "data", "trucks.json")
UA = "stanford-dining-menus/1.0 (+https://github.com/matmat202/stanford-dining-menus)"

RDE_URL = "https://rde.stanford.edu/dining-hospitality/mobile-food-vendors"
CF_URL = "https://cityflavor.com/locations/stanford-university-y2e2/"
Y2E2_PLACE = "South Services Rd, by Y2E2"

MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august",
     "september", "october", "november", "december"], 1)}
TIME = r"(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?"
RANGE = re.compile(TIME + r"\s*[-–—]\s*" + TIME, re.I)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def strip(fragment):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


def hhmm(h, m, ap):
    h = int(h) % 12 + (12 if ap.lower() == "p" else 0)
    return f"{h:02d}:{int(m or 0):02d}"


def parse_range(s):
    """'10:00 AM–3:00 PM' / '11 a.m. - 2 p.m.' -> ('10:00', '15:00'), or None."""
    m = RANGE.search(s)
    if not m:
        return None
    a, b = hhmm(*m.group(1, 2, 3)), hhmm(*m.group(4, 5, 6))
    return (a, b) if b > a else None   # no truck here runs overnight: a typo, not hours


def month_day(s):
    m = re.search(r"([A-Za-z]{3,9})\.?\s+(\d{1,2})\b", s)
    if not m:
        return None
    mon = next((n for name, n in MONTHS.items() if name.startswith(m.group(1).lower()[:3])), None)
    return (mon, int(m.group(2))) if mon else None


def nearest_year(mon, day, today):
    """A yearless 'Oct 26' is the date within half a year of today (Dec -> Jan rolls)."""
    best = None
    for y in (today.year - 1, today.year, today.year + 1):
        try:
            d = dt.date(y, mon, day)
        except ValueError:
            continue
        if best is None or abs((d - today).days) < abs((best - today).days):
            best = d
    return best


def parse_rde(page, today):
    i = page.find("food-truck-calendar")
    if i < 0:
        return []
    block = page[i:page.find("</table>", i)]
    head = strip(block[:block.find("<table")])
    yr = re.search(r"\b(20\d\d)\b", head)
    loc = re.search(r"Location:\s*(.+?)\s*Hours:", head)
    place = loc.group(1) if loc else "School of Medicine"
    rows = []
    for tr in re.findall(r"(?is)<tr>(.*?)</tr>", block):
        cells = re.findall(r"(?is)<td[^>]*>(.*?)</td>", tr)
        if len(cells) < 3:
            continue
        md = month_day(strip(cells[0]))
        hours = parse_range(strip(cells[2]))
        vendor = strip(cells[1])
        if not (md and vendor):
            continue
        date = dt.date(int(yr.group(1)), *md) if yr else nearest_year(*md, today)
        link = re.search(r'href="(https?://[^"]+)"', cells[1])
        rows.append({"date": date.isoformat(), "source": "rde", "place": place,
                     "area": "School of Medicine", "vendor": vendor,
                     "open": hours[0] if hours else None, "close": hours[1] if hours else None,
                     "raw_hours": None if hours else strip(cells[2]),
                     "link": link.group(1) if link else None, "cuisine": None, "options": []})
    return rows


def parse_cityflavor(page, today):
    rows, completed = [], set()
    for b in re.split(r'class="date-bar', page)[1:]:
        h6 = re.search(r"(?s)<h6[^>]*>(.*?)</h6>", b)
        md = month_day(strip(h6.group(1))) if h6 else None
        if not md:
            continue
        date = nearest_year(*md, today).isoformat()
        if "All shifts completed" in b:
            completed.add(date)
        for s in re.split(r'class="shift"', b)[1:]:
            tm = re.search(r'(?s)class="time">\s*<h5>(.*?)</h5>', s)
            vt = re.search(r'(?s)class="vendor-title[^"]*">\s*<h4>(.*?)</h4>\s*(?:<h5[^>]*>(.*?)</h5>)?', s)
            if not (tm and vt and strip(vt.group(1))):
                continue
            hours = parse_range(strip(tm.group(1)))
            # "INDIAN - BURGERS", "- AMERICAN" (empty first tag), "BBQ - AMERICAN"
            tags = [p.strip() for p in strip(vt.group(2) or "").split("-") if p.strip()]
            cuisine = " · ".join(p if len(p) <= 3 else p.title() for p in tags) or None
            rows.append({"date": date, "source": "cityflavor", "place": Y2E2_PLACE,
                         "area": "Engineering Quad", "vendor": strip(vt.group(1)),
                         "open": hours[0] if hours else None, "close": hours[1] if hours else None,
                         "raw_hours": None if hours else strip(tm.group(1)),
                         "link": None, "cuisine": cuisine,
                         "options": sorted(set(re.findall(r'data-tooltip="Vendor has ([a-z -]+?) options', s)))})
    return rows, completed


def keep_finished_today(rows, previous, completed, today):
    """Re-add today's earlier-scraped City Flavor rows that the page dropped as completed."""
    t = today.isoformat()
    if t not in completed or any(r["source"] == "cityflavor" and r["date"] == t for r in rows):
        return rows
    kept = [r for r in (previous or {}).get("trucks", [])
            if r.get("source") == "cityflavor" and r.get("date") == t]
    return rows + kept


def build(rde_page, cf_page, today, previous=None):
    rows, errors = [], []
    if rde_page is not None:
        r = parse_rde(rde_page, today)
        rows += r
        if not r:
            errors.append("rde: no food-truck-calendar rows (page shape changed?)")
    if cf_page is not None:
        r, completed = parse_cityflavor(cf_page, today)
        if 'class="date-bar' not in cf_page:
            errors.append("cityflavor: no date-bar blocks (page shape changed?)")
        rows = keep_finished_today(rows + r, previous, completed, today)
    rows = [r for r in rows if r["date"] >= (today - dt.timedelta(days=1)).isoformat()]
    rows.sort(key=lambda r: (r["date"], r["open"] or "", r["vendor"]))
    return {"generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "sources": {"rde": RDE_URL, "cityflavor": CF_URL},
            "trucks": rows, "errors": errors}


def pacific_today():
    return (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=8)).date()


def main():
    args = sys.argv[1:]
    today = dt.date.fromisoformat(args[args.index("--today") + 1]) if "--today" in args else pacific_today()
    pages = {}
    for key, url, flag in (("rde", RDE_URL, "--rde-file"), ("cf", CF_URL, "--cf-file")):
        try:
            pages[key] = open(args[args.index(flag) + 1]).read() if flag in args else fetch(url)
        except Exception as e:  # noqa: BLE001 — one source down must not drop the other
            print(f"scrape_trucks: {key} fetch failed: {e}", file=sys.stderr)
            pages[key] = None
    if pages["rde"] is None and pages["cf"] is None:
        return 2
    try:
        previous = json.load(open(OUT))
    except (OSError, ValueError):
        previous = None
    payload = build(pages["rde"], pages["cf"], today, previous)
    for e in payload["errors"]:
        print(f"scrape_trucks: {e}", file=sys.stderr)
    if not payload["trucks"]:
        print("scrape_trucks: 0 trucks from both sources — keeping the previous trucks.json", file=sys.stderr)
        return 2
    if "--dump" in args:
        for r in payload["trucks"]:
            print(f"{r['date']} {r['open'] or '?'}-{r['close'] or '?'}  {r['vendor']:<28} {r['place']}"
                  + (f"  [{r['cuisine']}]" if r["cuisine"] else "")
                  + (f"  ({', '.join(r['options'])})" if r["options"] else ""))
        return 0
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    days = len({r["date"] for r in payload["trucks"]})
    print(f"wrote {OUT} — {len(payload['trucks'])} truck shifts over {days} day(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
