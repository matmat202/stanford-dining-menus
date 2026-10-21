#!/usr/bin/env python3
"""scrape_rec.py — campus recreation facility hours, as a fourth venue kind.

Source: https://rec.stanford.edu/visit/facility-hours, a keyless Drupal page. What
the probe (2026-10-21) established before this was written:

  * The page holds one HTML table per *season*, each preceded by a heading and a date
    range: "Academic Year Hours / September 21, 2026 - June 13, 2027", then "Summer
    Hours / June 15, 2026 - September 20, 2026". Both are always published, so taking
    the first table would serve summer hours all autumn the year the order flips. The
    season is chosen by its date range, never by position.
  * A third table (Youth and Family Access) has a different shape (MON-THU, FRI, SAT,
    SUN) and no date range. It is skipped because it has no date range, not by index.
  * Each facility row is a <th> name then 7 day cells, Monday first, with empty
    spacer <td>s between them that must be dropped.
  * A cell can hold two shifts split by <br> (Climbing Wall, Tue: "8:00 AM - 10:00 AM
    <br> 4:00 PM - 9:00 PM"), a trailing note ("10:00 AM - 4:00 PM <br> Youth and
    Family Access"), or a word: CLOSED, OPEN (tennis courts, summer), "No staffed
    hours" (ARCAS).
  * The source has typos. Outdoor Center Rental, Thursday: "11:00 PM - 8:00 PM". No rec
    facility here runs overnight, so a window that closes at or before it opens is
    kept as `suspect` with its raw text and is NOT turned into hours. The page shows
    it as published instead of guessing which half is wrong.

A shift with a note under it (Climbing Wall, Sunday: "Youth and Family Access") is
access-restricted, not open. It goes to `restricted` with its note, is shown on the
card, and never makes the facility read "open".

Output windows have the same shape as cafes.json ({days:[0..6], open:'HH:MM',
close:'HH:MM', overnight:false}, 0=Monday), so the page reuses CafeLogic.venueStatus,
which is already tested on split and multi-window days, instead of a third copy of
open-now reasoning. Times are Pacific wall-clock, as published.
"""
import datetime as dt
import html
import json
import os
import re
import sys
import urllib.request

URL = "https://rec.stanford.edu/visit/facility-hours"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site/data/rec.json")
UA = "stanford-dining-menus/1.0 (+https://github.com/matmat202/stanford-dining-menus)"

TIME = r"(\d{1,2})(?::(\d{2}))?\s*([AP])\.?M\.?"
RANGE = re.compile(TIME + r"\s*[-–]\s*" + TIME, re.I)
DATE_RANGE = re.compile(r"([A-Z][a-z]+ \d{1,2}, \d{4})\s*[-–]\s*([A-Z][a-z]+ \d{1,2}, \d{4})")
CLOSED_WORDS = ("closed", "no staffed hours", "no access")


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def text(fragment):
    """Cell HTML -> list of its <br>-separated lines, tags stripped, whitespace folded."""
    parts = re.split(r"<br\s*/?>", fragment, flags=re.I)
    out = []
    for p in parts:
        t = html.unescape(re.sub(r"(?s)<[^>]+>", "", p)).replace("\xa0", " ")
        t = re.sub(r"\s+", " ", t).strip()
        if t:
            out.append(t)
    return out


def hhmm(h, m, ap):
    h = int(h) % 12 + (12 if ap.upper() == "P" else 0)
    return f"{h:02d}:{int(m or 0):02d}"


def parse_cell(lines):
    """One day's cell -> (spans, notes, suspect).

    spans: [(open, close)] in HH:MM. A note line attaches to the whole day's spans,
    since the source only ever writes one note under one shift. suspect: raw ranges that close
    at or before they open.
    """
    spans, notes, suspect = [], [], []
    for ln in lines:
        low = ln.lower()
        m = RANGE.search(ln)
        if m:
            o, c = hhmm(*m.group(1, 2, 3)), hhmm(*m.group(4, 5, 6))
            if c <= o:
                suspect.append(ln)
            else:
                spans.append((o, c))
            rest = (ln[:m.start()] + ln[m.end():]).strip(" ,;")
            if rest:
                notes.append(rest)
        elif low == "open":
            spans.append(("00:00", "23:59"))
        elif any(low.startswith(w) for w in CLOSED_WORDS):
            continue
        else:
            notes.append(ln)
    return spans, notes, suspect


def split_name(raw):
    """'ACSR (Closed 09/07- 09/13)' -> ('ACSR', 'Closed 09/07- 09/13')."""
    m = re.match(r"^(.*?)\s*\((.*)\)\s*(.*)$", raw)
    if not m:
        return raw.strip(), None
    note = " ".join(x for x in (m.group(2), m.group(3)) if x).strip()
    return m.group(1).strip(), note or None


def parse_tables(page):
    """Every season table on the page: [{label, start, end, rows:[{name, cells}]}]."""
    seasons = []
    for t in re.finditer(r"(?s)<table.*?</table>", page):
        before = page[max(0, t.start() - 2000):t.start()]
        heads = [" ".join(text(x)) for x in re.findall(r"(?s)<(?:h[1-6]|p)[^>]*>(.*?)</(?:h[1-6]|p)>", before)]
        heads = [h for h in heads if h]
        rng = next((DATE_RANGE.search(h) for h in reversed(heads) if DATE_RANGE.search(h)), None)
        if not rng:
            continue                     # the Youth and Family table: no date range
        label = next((h for h in reversed(heads) if "hours" in h.lower() and not DATE_RANGE.search(h)), "Hours")
        start = dt.datetime.strptime(rng.group(1), "%B %d, %Y").date()
        end = dt.datetime.strptime(rng.group(2), "%B %d, %Y").date()
        rows = []
        for tr in re.findall(r"(?s)<tr.*?</tr>", t.group(0)):
            cells = re.findall(r"(?s)<(th|td)[^>]*>(.*?)</\1>", tr)
            if not cells or cells[0][0] != "th":
                continue
            name = " ".join(text(cells[0][1]))
            days = [text(c) for _, c in cells[1:]]
            days = [d for d in days if d]          # drop the empty spacer cells
            if len(days) != 7 or name.lower() == "facilities":
                continue
            rows.append({"name": name, "cells": days})
        seasons.append({"label": label, "start": start, "end": end, "rows": rows})
    return seasons


def pick_season(seasons, today):
    """The season whose range contains today; else the latest one already begun."""
    inside = [s for s in seasons if s["start"] <= today <= s["end"]]
    if inside:
        return inside[0], True
    begun = sorted((s for s in seasons if s["start"] <= today), key=lambda s: s["start"])
    return (begun[-1] if begun else None), False


def venue(row):
    name, name_note = split_name(row["name"])
    by_span, restricted, suspect, verbatim = {}, {}, [], []
    for d, lines in enumerate(row["cells"]):
        spans, n, sus = parse_cell(lines)
        note = "; ".join(n)
        for sp in spans:
            (restricted.setdefault((sp, note), []) if note else by_span.setdefault(sp, [])).append(d)
        suspect += [f"{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][d]}: {s}" for s in sus]
        verbatim.append(" / ".join(lines))
    windows = [{"days": days, "open": o, "close": c, "overnight": False}
               for (o, c), days in sorted(by_span.items(), key=lambda kv: (kv[1][0], kv[0]))]
    limited = [{"days": days, "open": o, "close": c, "overnight": False, "note": note}
               for ((o, c), note), days in sorted(restricted.items(), key=lambda kv: kv[1][0])]
    return {"name": name, "note": name_note, "windows": windows, "restricted": limited,
            "suspect": suspect, "hours_text": verbatim}


def build(page, today):
    seasons = parse_tables(page)
    season, current = pick_season(seasons, today)
    if not season or not season["rows"]:
        return None
    venues = [venue(r) for r in season["rows"]]
    return {
        "source": URL,
        "season": season["label"],
        "season_start": season["start"].isoformat(),
        "season_end": season["end"].isoformat(),
        "season_current": current,
        "venues": venues,
    }


def pacific_today():
    # Pacific is UTC-8 or UTC-7; the only dates it can misjudge are the hour around
    # midnight on a season boundary. Not worth a tz database for that.
    return (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=8)).date()


def main():
    try:
        page = fetch(URL) if "--file" not in sys.argv else open(sys.argv[sys.argv.index("--file") + 1]).read()
    except Exception as e:  # noqa: BLE001 — the caller only needs the reason
        print(f"scrape_rec: fetch failed: {e}", file=sys.stderr)
        return 2

    payload = build(page, pacific_today())
    if not payload or len(payload["venues"]) < 5:
        print("scrape_rec: no season table with facility rows — the page shape changed", file=sys.stderr)
        return 2

    if "--dump" in sys.argv:
        print(f"{payload['season']}  {payload['season_start']}..{payload['season_end']}"
              f"{'' if payload['season_current'] else '  (NOT CURRENT: no season covers today)'}")
        for v in payload["venues"]:
            print(f"\n{v['name']}" + (f"   ({v['note']})" if v["note"] else ""))
            for w in v["windows"]:
                print(f"    {w['days']} {w['open']}-{w['close']}")
            for s in v["suspect"]:
                print(f"    SUSPECT, shown verbatim: {s}")
            for w in v["restricted"]:
                print(f"    RESTRICTED {w['days']} {w['open']}-{w['close']}  ({w['note']})")
        return 0

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    sus = sum(len(v["suspect"]) for v in payload["venues"])
    print(f"wrote {OUT} — {payload['season']}, {len(payload['venues'])} facilities"
          + (f", {sus} suspect cell(s) shown verbatim" if sus else ""))
    if not payload["season_current"]:
        print("WARNING: no season on the page covers today; serving the latest begun one", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
