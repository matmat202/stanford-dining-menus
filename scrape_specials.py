#!/usr/bin/env python3
"""scrape_specials.py — R&DE's weeknight dinner specials, dated, per hall.

R&DE's Dining Locations & Hours page links a "Dining Hall Specials Calendar" PDF, two
weeks to a page ("DINNER SPECIALS FOR OCT. 26-NOV. 6, 2026"). The menu app the site
scrapes does not carry most of it: measured 2026-10-30, the named special appeared in the
scraped dinner menu on only 19 of 72 hall-weeknights, and the themed dinners (Dia de
Muertos at Stern, Diwali at FloMo) are named nowhere (projects/dinner-specials/BRIEF.md).

What the probe (2026-10-30) established about the PDF, read through `pdftotext -bbox`:

  * A calendar grid: a SUNDAY..SATURDAY header, then per week a row of date numbers, each
    RIGHT-aligned in its cell, so a number's xMax is its column's right edge.
  * Under each date row, one coloured bar per hall, its text starting in the Monday cell
    with a label: "Stern: Quesadilla Bar", "AFDC: ...", "FloMo: ...", "Casper: ...".
    A long one wraps onto a second line at the same x.
  * A bar is interrupted by another cell inside the same band: "Dia de Muertos Dinner" in
    Thursday, then "Stern: Quesadilla Bar" again in Friday. The interruption has no label;
    it belongs to the band it sits in. pdftotext's own <block>s merge those cells, so this
    works from words and x-gaps, not blocks.
  * The bars end at Friday: the hours page calls them "Monday - Friday Dinner Specials".
    Where a bar ENDS is paint, not text, so the last segment is assumed to run to Friday.

pdftotext is poppler's, present on this machine and not promised on GitHub's runners, so
this runs from publish.sh only (like libraries and rec), and a failure keeps the previous
specials.json. A run that cannot place a word, or whose date row disagrees with the title,
reports it in `errors` and publishes nothing new: a special on the wrong night is worse
than none.
"""
import datetime as dt
import html
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("DINING_SITE") or os.path.join(HERE, "site")
OUT = os.path.join(SITE, "data", "specials.json")
UA = "stanford-dining-menus/1.0 (+https://github.com/matmat202/stanford-dining-menus)"
PAGE = "https://rde.stanford.edu/dining-hospitality/dining-locations-hours"

# The PDF's labels -> halls.json ids. An unknown label is an error, not a new hall.
LABELS = {"stern": "Stern", "afdc": "Arrillaga", "arrillaga": "Arrillaga", "wilbur": "Wilbur",
          "casper": "GerhardCasper", "flomo": "FlorenceMoore", "florence moore": "FlorenceMoore",
          "lakeside": "Lakeside", "ricker": "Ricker", "branner": "Branner"}
LABEL = re.compile(r"^(" + "|".join(sorted(map(re.escape, LABELS), key=len, reverse=True)) + r")\s*:\s*", re.I)
MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
TITLE = re.compile(r"([A-Za-z]{3})[A-Za-z]*\.?\s*(\d{1,2})\s*[-–—]\s*(?:([A-Za-z]{3})[A-Za-z]*\.?\s*)?(\d{1,2}),?\s*(\d{4})")
GAP = 15.0    # pt between words that starts a new cell: word spacing measured 6.4, the
              # Thursday "Muertos" to Friday "Stern:" gap 24.6 (fixture, 2026-10-26)


def fetch(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        b = r.read()
    return b if binary else b.decode("utf-8", "replace")


def pdf_links(page_html, base=PAGE):
    """Every specials-calendar PDF the hours page links, absolute, in page order."""
    out = []
    for href in re.findall(r'href="([^"]+\.pdf)"', page_html, re.I):
        if re.search(r"special", urllib.parse.unquote(href), re.I):
            u = urllib.parse.urljoin(base, html.unescape(href))
            if u not in out:
                out.append(u)
    return out


def words_of(pdf_bytes):
    """[(xMin, yMin, xMax, yMax, text)] from pdftotext -bbox, one page or many (y offset by page)."""
    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, "s.pdf")
        open(src, "wb").write(pdf_bytes)
        out = subprocess.run(["pdftotext", "-bbox", src, "-"], capture_output=True, check=True,
                             timeout=60).stdout.decode("utf-8", "replace")
    words = []
    for page_i, page in enumerate(re.split(r"<page ", out)[1:]):
        for m in re.finditer(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', page):
            x0, y0, x1, y1 = map(float, m.groups()[:4])
            words.append((x0, y0 + 10000 * page_i, x1, y1 + 10000 * page_i, html.unescape(m.group(5))))
    return words


def lines_of(words):
    """Group words into lines by vertical overlap, each sorted left to right."""
    lines = []
    for w in sorted(words, key=lambda w: (w[1], w[0])):
        for ln in lines:
            if min(ln["y1"], w[3]) - max(ln["y0"], w[1]) > 0.5 * (w[3] - w[1]):
                ln["w"].append(w)
                ln["y0"], ln["y1"] = min(ln["y0"], w[1]), max(ln["y1"], w[3])
                break
        else:
            lines.append({"y0": w[1], "y1": w[3], "w": [w]})
    for ln in lines:
        ln["w"].sort()
    return sorted(lines, key=lambda ln: ln["y0"])


def runs_of(line):
    """Split a line into cell runs wherever the gap between words exceeds GAP."""
    runs, cur = [], [line["w"][0]]
    for a, b in zip(line["w"], line["w"][1:]):
        if b[0] - a[2] > GAP:
            runs.append(cur)
            cur = []
        cur.append(b)
    runs.append(cur)
    return [{"x0": r[0][0], "y": (line["y0"] + line["y1"]) / 2, "text": " ".join(w[4] for w in r)} for r in runs]


def parse(pdf_words):
    """-> {'from','to','specials':[{date, hall, text, event}], 'errors':[...]}"""
    errors, rows = [], []
    lines = lines_of(pdf_words)
    title = " ".join(r["text"] for ln in lines for r in runs_of(ln) if TITLE.search(r["text"]))
    m = TITLE.search(title)
    if not m:
        return {"from": None, "to": None, "specials": [], "errors": ["no 'MON. D-MON. D, YYYY' title"]}
    m1, d1, m2, d2, y = m.groups()
    try:
        start = dt.date(int(y), MONTHS[m1.lower()], int(d1))
        end = dt.date(int(y), MONTHS[(m2 or m1).lower()], int(d2))
        if end < start:                      # "DEC. 28-JAN. 8, 2027": the year is the end's
            start = start.replace(year=start.year - 1)
    except (KeyError, ValueError) as e:
        return {"from": None, "to": None, "specials": [], "errors": [f"bad title {m.group(0)!r}: {e}"]}
    if start.weekday() != 0:
        errors.append(f"title starts {start} ({start:%A}), not a Monday")

    # Date rows: lines made only of 1-2 digit numbers, at least five of them.
    date_rows = []
    for ln in lines:
        toks = [w for w in ln["w"]]
        if len(toks) >= 5 and all(re.fullmatch(r"\d{1,2}", w[4]) for w in toks):
            date_rows.append(ln)
    if not date_rows:
        return {"from": start.isoformat(), "to": end.isoformat(), "specials": [],
                "errors": errors + ["no row of date numbers"]}
    # Column right edges from the first full row (Sunday..Saturday, seven numbers).
    full = next((r for r in date_rows if len(r["w"]) == 7), None)
    if not full:
        return {"from": start.isoformat(), "to": end.isoformat(), "specials": [],
                "errors": errors + ["no date row with all seven days"]}
    edges = [w[2] for w in full["w"]]

    def col(x):
        for i, e in enumerate(edges):
            if x < e:
                return i
        return None

    for k, row in enumerate(date_rows):
        monday = start + dt.timedelta(days=7 * k)
        nums = {col(w[0]): int(w[4]) for w in row["w"]}
        if nums.get(1) != monday.day:
            errors.append(f"week {k + 1}: Monday cell says {nums.get(1)}, title implies {monday}")
            continue
        top = row["y1"]
        bottom = date_rows[k + 1]["y0"] if k + 1 < len(date_rows) else float("inf")
        runs = [r for ln in lines if top <= ln["y0"] < bottom for r in runs_of(ln)]
        # Band anchors: a labelled run starting in the Monday cell.
        anchors = []
        for r in runs:
            lm = LABEL.match(r["text"])
            if col(r["x0"]) == 1 and lm:
                anchors.append({"y": r["y"], "hall": LABELS[lm.group(1).lower()], "cells": {}})
            elif col(r["x0"]) == 1 and re.match(r"^[A-Z][\w .'&]*:\s", r["text"]) and not anchors_wrap(anchors, r):
                errors.append(f"week {k + 1}: unknown hall label in {r['text']!r}")
        if not anchors:
            errors.append(f"week {k + 1}: no labelled hall bars")
            continue
        for r in runs:
            c = col(r["x0"])
            if c is None or not 1 <= c <= 5:
                errors.append(f"week {k + 1}: text outside Monday-Friday: {r['text']!r}")
                continue
            band = min(anchors, key=lambda a: abs(a["y"] - r["y"]))
            band["cells"].setdefault(c, []).append(r)
        for band in anchors:
            starts = sorted(band["cells"])
            main = None
            for i, c in enumerate(starts):
                text = " ".join(r["text"] for r in sorted(band["cells"][c], key=lambda r: r["y"]))
                lm = LABEL.match(text)
                if lm and LABELS[lm.group(1).lower()] != band["hall"]:
                    errors.append(f"week {k + 1}: {text!r} sits in {band['hall']}'s bar")
                    continue
                text = LABEL.sub("", text).strip()
                if main is None:
                    main = text
                last = (starts[i + 1] - 1) if i + 1 < len(starts) else 5
                for day in range(c, last + 1):
                    date = monday + dt.timedelta(days=day - 1)
                    if start <= date <= end:
                        rows.append({"date": date.isoformat(), "hall": band["hall"], "text": text,
                                     "event": text != main})
    rows.sort(key=lambda r: (r["date"], r["hall"]))
    seen = {}
    for r in rows:
        if (r["date"], r["hall"]) in seen:
            errors.append(f"two specials for {r['hall']} on {r['date']}")
        seen[(r["date"], r["hall"])] = r
    return {"from": start.isoformat(), "to": end.isoformat(), "specials": rows, "errors": errors}


def anchors_wrap(anchors, run):
    """A wrapped second line of a labelled bar ("and Pickled Cabbage") is not a label."""
    return bool(anchors) and abs(anchors[-1]["y"] - run["y"]) < 60


def main():
    page = fetch(PAGE)
    links = pdf_links(page)
    if not links:
        print("specials: the hours page links no specials PDF; keeping the previous specials.json")
        return 1
    out = {"fetched": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
           "page": PAGE, "sources": [], "specials": [], "errors": []}
    for url in links:
        p = parse(words_of(fetch(url, binary=True)))
        out["sources"].append({"url": url, "from": p["from"], "to": p["to"], "count": len(p["specials"])})
        out["specials"] += p["specials"]
        out["errors"] += [f"{url.rsplit('/', 1)[-1]}: {e}" for e in p["errors"]]
    if out["errors"] or not out["specials"]:
        print("specials: refusing to write —", "; ".join(out["errors"]) or "no specials parsed")
        return 1
    out["specials"].sort(key=lambda r: (r["date"], r["hall"]))
    tmp = OUT + ".tmp"
    with open(tmp, "w") as f:
        json.dump(out, f, indent=1)
    os.replace(tmp, OUT)
    ev = [f"{r['hall']} {r['date']} {r['text']}" for r in out["specials"] if r["event"]]
    print(f"specials: {len(out['specials'])} hall-nights from {len(links)} PDF(s); events: {ev or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
