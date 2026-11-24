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
    out = []
    for r in runs:
        # A tall label ("Lakeside:", 40 units) overlaps TWO lines of a smaller centred cell
        # beside it, so lines_of puts all three on one line and x-order interleaves the cell's
        # words: "Brussels Glazed Sprouts, Yams with Maple-" (Nov 23 calendar). Within a run,
        # words whose own centres differ by more than half a word height are separate lines.
        subs = []
        for w in r:
            c, h = (w[1] + w[3]) / 2, w[3] - w[1]
            for sub in subs:
                if abs(c - sub["c"]) <= 0.5 * min(h, sub["h"]):
                    sub["w"].append(w)
                    break
            else:
                subs.append({"c": c, "h": h, "w": [w]})
        y = (line["y0"] + line["y1"]) / 2
        for sub in sorted(subs, key=lambda q: q["c"]):
            out.append({"x0": sub["w"][0][0], "x1": sub["w"][-1][2],
                        "y": y if len(subs) == 1 else sub["c"],
                        "text": " ".join(w[4] for w in sub["w"])})
    return out


# A one-off cell (a themed dinner) is CENTRED: its lines share a centre and start at
# different x. A bar's own text is LEFT-aligned: its lines share x0. Measured on the Nov 9-20
# calendar: Thanksgiving's 16 lines agree on centre to 2.5 units, Friday's bar restarts all
# start at 1060.4. Line spacing cannot tell them apart (cell gaps reach 59, gaps between
# bars go down to 53), which is why the nearest-bar rule sliced tall cells.
CENTRE_TOL, X0_SPREAD, LINE_GAP = 4.0, 8.0, 70.0
CLOSED = re.compile(r"\bwill be closed\b|\bclosed and reopen", re.I)
NOTICE = re.compile(r"scan the qr code for .*hours of operation", re.I)


def centred_cells(runs):
    """Group runs of ONE column into centred multi-line cells: [[run, ...], ...]."""
    out, cur = [], []
    for r in sorted(runs, key=lambda r: r["y"]):
        c = (r["x0"] + r["x1"]) / 2
        if cur and abs(c - cur[0]["_c"]) <= CENTRE_TOL and r["y"] - cur[-1]["y"] <= LINE_GAP:
            cur.append(dict(r, _c=c, _src=r))
            continue
        if len(cur) >= 2 and max(q["x0"] for q in cur) - min(q["x0"] for q in cur) > X0_SPREAD:
            out.append(cur)
        cur = [dict(r, _c=c, _src=r)]
    if len(cur) >= 2 and max(q["x0"] for q in cur) - min(q["x0"] for q in cur) > X0_SPREAD:
        out.append(cur)
    return out


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
        # A closure notice is a labelled bar across the whole week, starting in the Sunday
        # cell: "Wilbur: In observance of the Thanksgiving Holiday Wilbur will be closed and
        # reopen at Brunch Nov. 28" (Nov 23 calendar). The hall has no special that week; the
        # page already shows the closure from the hours page, so the notice is dropped.
        runs = [r for r in runs if not (LABEL.match(r["text"]) and col(r["x0"]) in (0, 1)
                                        and CLOSED.search(r["text"]))]
        # A weekend cell that is wholly the QR-code pointer to the holiday hours is not a meal.
        for c in (0, 6):
            cell = sorted((r for r in runs if col(r["x0"]) == c), key=lambda r: r["y"])
            if cell and NOTICE.fullmatch(" ".join(r["text"] for r in cell)):
                runs = [r for r in runs if col(r["x0"]) != c]
        # Band anchors: a labelled run starting in the Monday cell.
        anchors = []
        for r in runs:
            lm = LABEL.match(r["text"])
            if col(r["x0"]) == 1 and lm:
                anchors.append({"y": r["y"], "y1": r["y"], "hall": LABELS[lm.group(1).lower()], "cells": {}})
            elif col(r["x0"]) == 1 and anchors_wrap(anchors, r):
                anchors[-1]["y1"] = max(anchors[-1]["y1"], r["y"])
            elif col(r["x0"]) == 1 and re.match(r"^[A-Z][\w .'&]*:\s", r["text"]) and not anchors_wrap(anchors, r):
                errors.append(f"week {k + 1}: unknown hall label in {r['text']!r}")
        if not anchors:
            errors.append(f"week {k + 1}: no labelled hall bars")
            continue
        # Centred cells in Tuesday-Friday go whole to every bar they span (Thanksgiving: six
        # halls), or to the nearest bar if they span none; everything else, run by run.
        taken = set()
        for c in range(2, 6):
            for cell in centred_cells([r for r in runs if col(r["x0"]) == c and not LABEL.match(r["text"])]):
                y0, y1 = cell[0]["y"], cell[-1]["y"]
                text = re.sub(r"(\w)- (?=[A-Z])", r"\1-", " ".join(q["text"] for q in cell))  # "Maple-|Glazed"
                # A band is its label line through its wrapped lines: AFDC's Nov 23 bar
                # wraps to the line where Thanksgiving's cell starts, 37 below the label.
                inside = [a for a in anchors if y0 - 20 <= a["y1"] and a["y"] <= y1 + 20]
                for band in inside or [min(anchors, key=lambda a: abs(a["y"] - (y0 + y1) / 2))]:
                    band["cells"].setdefault(c, []).append({"x0": cell[0]["x0"], "y": y0, "text": text})
                taken.update(id(q["_src"]) for q in cell)
        for r in runs:
            if id(r) in taken:
                continue
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
    errors += cut_cells(rows)
    return {"from": start.isoformat(), "to": end.isoformat(), "specials": rows, "errors": errors}


def cut_cells(rows):
    """Errors for one-off cells the band assignment has sliced apart.

    Runs go to the NEAREST bar by y, which is right for a bar's own text but wrong for a tall
    one-off cell whose lines run down past its bar: the Nov 9-20 calendar's AFDC "Native
    American Heritage Month / Dinner" lost "Dinner" to Stern on two nights, and its
    Thanksgiving cell (11-19) became six halls' worth of menu fragments, two ending in a
    comma. Splitting them correctly needs the cell's outline, which is paint; until that is
    built, the slices are recognised by what they leave behind and the calendar is refused
    (main() then keeps the previous specials.json, so the page shows its lapse notice rather
    than a wrong special). Only rows flagged `event` are judged: a bar's own text is fine.
    """
    errs, by_date = [], {}
    for r in rows:
        if not r["event"]:
            continue
        t = r["text"].strip()
        by_date.setdefault(r["date"], set()).add(t)
        if t.endswith((",", ";", "-")) or len(t.split()) == 1 or t[:1].islower():
            errs.append(f"{r['hall']} {r['date']}: event text {t!r} looks cut from a taller cell")
    for date, texts in sorted(by_date.items()):
        if len(texts) >= 3:
            errs.append(f"{date}: {len(texts)} different one-off texts on one night — a cell "
                        f"spanning several bars was sliced by band")
    return errs


def anchors_wrap(anchors, run):
    """A wrapped second line of a labelled bar ("and Pickled Cabbage") is not a label."""
    return bool(anchors) and abs(anchors[-1]["y"] - run["y"]) < 60


def covers(specials):
    """"weekdays" when no hall-night falls on Sat/Sun, else "every day".

    bin/horizon reads this to know a Friday expiry is still right all weekend (the
    page's lapse notice is silent on weekends for the same reason). It is derived from
    the rows, not asserted: if R&DE ever prints a weekend night, the marker drops and
    horizon goes back to counting every calendar day.
    """
    days = {dt.date.fromisoformat(r["date"]).weekday() for r in specials}
    return "every day" if days & {5, 6} else "weekdays"


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
    out["covers"] = covers(out["specials"])
    tmp = OUT + ".tmp"
    with open(tmp, "w") as f:
        json.dump(out, f, indent=1)
    os.replace(tmp, OUT)
    ev = [f"{r['hall']} {r['date']} {r['text']}" for r in out["specials"] if r["event"]]
    print(f"specials: {len(out['specials'])} hall-nights from {len(links)} PDF(s); events: {ev or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
