#!/usr/bin/env python3
"""Scrape Stanford R&DE café and retail venues — names, hours, descriptions.

Why this is shaped differently from scrape.py: the cafés page is prose, not a form.
Hours appear as free text in every format R&DE has ever used —
`Thursday - Saturday | 5pm - 12am`, `: Monday - Friday, 11 a.m. - 2:00 p.m.`,
`Monday – Sunday 9:00 a.m. – 10:00 p.m.`, `7:00 a.m.- 3:00 p.m.` — with mixed
separators, mixed dashes, missing spaces, and meal labels embedded mid-sentence.

So the rule here is: **extract structurally, parse best-effort, never guess.**

- Venue names and blocks come from the page's own structure (`h2` headings inside
  `paragraphs-image-text-section--text--inner` blocks), not from guessing which line
  of prose sits nearest a time.
- Hours are kept **verbatim** as published. A tolerant parse into day-band windows is
  attempted on top, and when it fails the venue simply has no machine-readable window
  and the site shows the published text instead. A café shown as "open now" on a
  guessed window would be worse than one that just prints its hours.

    python3 scrape_cafes.py           # write site/data/cafes.json
    python3 scrape_cafes.py --dump    # print what was found, write nothing
"""
import html as H
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("DINING_SITE") or os.path.join(HERE, "site")
OUT = os.path.join(SITE, "data", "cafes.json")
URL = "https://rde.stanford.edu/dining-hospitality/cafes"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/140.0 Safari/537.36")

BLOCK = "paragraphs-image-text-section--text--inner"
DAYS = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
        "friday": 4, "saturday": 5, "sunday": 6}
# tolerant: optional minutes, optional dots, any dash, any amount of space
T = r"(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?"
RANGE = re.compile(T + r"\s*[-–—]\s*" + T, re.I)
BAND = re.compile(r"\b(" + "|".join(DAYS) + r")\s*[-–—]\s*(" + "|".join(DAYS) + r")\b", re.I)
SINGLE_DAY = re.compile(r"\b(" + "|".join(DAYS) + r")\b", re.I)
# navigation/marketing headings that are not venues
NOT_VENUE = re.compile(r"^(top header|r&de|dining,|left column|middle column|right column|"
                       r"now offering|simple, delicious|footer|menu|search)\b", re.I)


def text_of(frag):
    return " ".join(H.unescape(re.sub(r"<[^>]+>", " ", frag)).split())


def to_min(h, m, ap):
    h = int(h) % 12 + (12 if ap.lower() == "p" else 0)
    return h * 60 + int(m or 0)


def parse_windows(line):
    """-> [{days:[0..6], open:'HH:MM', close:'HH:MM', overnight:bool}] or []."""
    m = RANGE.search(line)
    if not m:
        return []
    o = to_min(m.group(1), m.group(2), m.group(3))
    c = to_min(m.group(4), m.group(5), m.group(6))
    band = BAND.search(line)
    if band:
        a, b = DAYS[band.group(1).lower()], DAYS[band.group(2).lower()]
        days = [d % 7 for d in range(a, (b if b >= a else b + 7) + 1)]
    else:
        singles = [DAYS[d.lower()] for d in SINGLE_DAY.findall(line)]
        days = sorted(set(singles)) if singles else []
    if not days:
        return []                       # no day information -> no window, show verbatim
    return [{"days": days, "open": f"{o//60:02d}:{o%60:02d}",
             "close": f"{c//60:02d}:{c%60:02d}", "overnight": c <= o}]


def fetch():
    req = urllib.request.Request(URL, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=45).read().decode("utf-8", "replace")


def venues(page):
    out = []
    # Each venue is one text block; its name is the h2 inside or immediately before it.
    parts = page.split(BLOCK)
    for i, part in enumerate(parts[1:], start=1):
        chunk = part[:9000]
        names = re.findall(r"<h2[^>]*>(.*?)</h2>", parts[i - 1][-4000:] + chunk, re.S)
        name = ""
        for n in reversed(names):
            t = text_of(n)
            if t and not NOT_VENUE.match(t):
                name = t
                break
        if not name:
            continue
        marked = re.sub(r"<br\s*/?>|</p>|</li>|</div>|</h\d>", "\n@@\n", chunk)
        lines = [l for l in (text_of(x) for x in marked.split("@@")) if l]
        hours_lines = [l for l in lines if RANGE.search(l)]
        if not hours_lines:
            continue
        # Skip the venue's own name, anything with a time in it, and any line that
        # merely repeats the name as a prefix (R&DE headings often recur in the body).
        desc = next((l for l in lines
                     if len(l) > 40 and not RANGE.search(l)
                     and l != name and not l.startswith(name)), "")
        # R&DE often puts the day band on its own line and the times on the next
        # ("Monday - Friday" / "Lunch 11:00 a.m. - 2:00 p.m."). Carry the most recent
        # band forward within the block — the page groups them visually, so this is
        # reading the structure, not guessing. A line with its own band overrides it.
        wins, verbatim, band_ctx = [], [], ""
        for l in lines:
            b = BAND.search(l)
            if b and not RANGE.search(l):
                band_ctx = b.group(0)
                continue
            if not RANGE.search(l):
                continue
            verbatim.append(l)
            got = parse_windows(l)
            if not got and band_ctx:
                got = parse_windows(f"{band_ctx} {l}")
            wins.extend(got)
        if not any(v["name"] == name for v in out):
            out.append({"name": name, "description": desc[:240],
                        "hours_text": verbatim, "windows": wins})
    return out


def main():
    page = fetch()
    vs = venues(page)
    if not vs:
        print("scrape_cafes: found no venues — the page layout changed", file=sys.stderr)
        return 2
    parsed = sum(1 for v in vs if v["windows"])
    if "--dump" in sys.argv:
        for v in vs:
            print(f"\n{v['name']}")
            for l in v["hours_text"]:
                print(f"    text: {l[:88]}")
            for w in v["windows"]:
                d = "".join("MTWTFSS"[x] for x in w["days"])
                print(f"    -> {d} {w['open']}-{w['close']}"
                      + ("  (overnight)" if w["overnight"] else ""))
            if not v["windows"]:
                print("    -> NO WINDOW PARSED — site will show the text verbatim")
        print(f"\n{len(vs)} venues, {parsed} with a machine-readable window")
        return 0
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump({"source": URL, "venues": vs}, f, separators=(",", ":"))
    print(f"wrote {OUT} — {len(vs)} venues, {parsed} with parsed windows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
