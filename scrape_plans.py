#!/usr/bin/env python3
"""The undergraduate dining-hall meal plans: price, swipes and Meal Plan Dollars per quarter.

R&DE prices the 19, 15 and 12 meal plans identically ($8,142 for 2026-27); they differ only
in how many swipes a week you get and how many Meal Plan Dollars come with them. So dropping
swipes buys Meal Plan Dollars back at a fixed rate, and anyone who eats fewer hall meals
than their plan gives them is choosing between "wasted swipes" and "free dollars" without
knowing it. R&DE publishes every number needed and never puts the two side by side; the
site's plan picker (plans-logic.js) does. Students can switch plans in the first three
weeks of a quarter, so it is a quarterly decision, not a once-a-year one.

Only the three-way undergraduate choice is read. Row, Co-op, Suites and YMT plans are set by
where you live, so there is nothing to pick between.

Why a separate scraper and data file: the same reason as scrape_pay.py. publish.sh refuses
a data-only publish while a live scraper differs from its published copy.

    python3 scrape_plans.py           # write site/data/plans.json
    python3 scrape_plans.py --dump    # print what was found, write nothing
"""
import datetime as dt
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import scrape_cafes as C  # noqa: E402  (text_of, UA)

SITE = os.environ.get("DINING_SITE") or os.path.join(HERE, "site")
OUT = os.path.join(SITE, "data", "plans.json")
URL = "https://rde.stanford.edu/dining-hospitality/dining-hall-meal-plans"
QUARTERS = ("Fall", "Winter", "Spring")


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": C.UA})
    return urllib.request.urlopen(req, timeout=45).read().decode("utf-8", "replace")


def money(s):
    m = re.search(r"\$\s*([\d,]+(?:\.\d+)?)", s)
    return float(m.group(1).replace(",", "")) if m else None


def paras(cell):
    """A cell's <p> lines as text; a cell without <p> is one line."""
    ps = re.findall(r"<p[^>]*>(.*?)</p>", cell, re.S)
    return [t for t in (C.text_of(p).strip() for p in (ps or [cell])) if t]


def tables(page):
    return re.findall(r"<table.*?</table>", page, re.S)


def header(table):
    th = re.findall(r"<th[^>]*>(.*?)</th>", table, re.S)
    return [C.text_of(h).strip() for h in th]


def plans(page):
    """The pricing table whose header names the three quarters -> [{swipes, quarters:[{cost,
    mpd}]}] for the plain 19/15/12 rows. The '+$250 Cardinal Dollars' rows are the same plan
    with dollars added at face value, so they change nothing about the choice and are skipped.
    Returns [] if no table has the expected shape: say so rather than guess."""
    for t in tables(page):
        head = header(t)
        cols = {q: i for i, h in enumerate(head) for q in QUARTERS if h.startswith(q)}
        if set(cols) != set(QUARTERS):
            continue
        out = []
        for r in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S):
            cells = re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)
            if len(cells) < len(head):
                continue
            label = " ".join(paras(cells[0]))
            m = re.match(r"(\d+)\s+Meal Plan\b", label)
            if not m or re.match(r"\d+\s+Meal Plan\s+PLUS\b", label, re.I):
                continue
            qs = []
            for q in QUARTERS:
                vals = [money(p) for p in paras(cells[cols[q]])]
                vals = [v for v in vals if v is not None]
                if not vals:
                    break
                qs.append({"quarter": q, "cost": vals[0],
                           "mpd": vals[1] if len(vals) > 1 and "Meal Plan Dollars" in label else 0.0})
            if len(qs) == len(QUARTERS):
                out.append({"swipes": int(m.group(1)), "quarters": qs})
        if out:
            return sorted(out, key=lambda p: -p["swipes"])
    return []


def dates(page):
    """The 'Season / Dates' table -> [{quarter, start, end}] as ISO dates."""
    for t in tables(page):
        if [h.lower() for h in header(t)] != ["season", "dates"]:
            continue
        out = []
        for r in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S):
            cells = [C.text_of(c).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)]
            if len(cells) != 2:
                continue
            q = cells[0].split()[0]
            ends = re.findall(r"([A-Z][a-z]+ \d{1,2}, \d{4})", cells[1])
            if q in QUARTERS and len(ends) == 2:
                s, e = (dt.datetime.strptime(x, "%B %d, %Y").date().isoformat() for x in ends)
                out.append({"quarter": q, "start": s, "end": e})
        return out
    return []


def upper_only(page):
    """Swipe counts R&DE marks as upper-class only (the 12 today), read from the list item
    that describes each plan."""
    out = []
    for li in re.findall(r"<li[^>]*>(.*?)</li>", page, re.S):
        t = C.text_of(li)
        m = re.match(r"\s*(\d+) Meal Plan:", t)
        if m and re.search(r"only available for upper-class", t, re.I):
            out.append(int(m.group(1)))
    return out


def build(page):
    ps, ds, up = plans(page), dates(page), upper_only(page)
    for p in ps:
        p["upper_only"] = p["swipes"] in up
    return {"source": URL, "plans": ps, "dates": ds,
            "fetched": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}


def main():
    page = fetch(URL)
    data = build(page)
    if "--dump" in sys.argv:
        print(json.dumps(data, indent=1))
        return 0
    if len(data["plans"]) < 2 or len(data["dates"]) != len(QUARTERS):
        # A partial table would make the picker give a confident wrong answer. Keep the old
        # file and fail loudly instead.
        print(f"scrape_plans: {len(data['plans'])} plans, {len(data['dates'])} quarters; "
              "page changed shape, plans.json left as it was", file=sys.stderr)
        return 1
    with open(OUT + ".tmp", "w") as f:
        json.dump(data, f, separators=(",", ":"))
    os.replace(OUT + ".tmp", OUT)
    print(f"scrape_plans: {len(data['plans'])} plans, {len(data['dates'])} quarters -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
