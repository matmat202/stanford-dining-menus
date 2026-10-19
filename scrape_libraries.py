#!/usr/bin/env python3
"""scrape_libraries.py — campus library hours, as a third venue kind.

Unlike the halls (ASP.NET postbacks) and the cafés (HTML prose), this source is an
open JSON:API document and needs no credential:

    https://library-hours.stanford.edu/libraries.json

What the probe established before a line of this was written — each of these is a
thing the obvious parser gets wrong:

  * A `closed: true` record **omits `opens_at` and `closes_at` entirely**. It is not
    null, it is absent. Indexing those keys raises on srwc, ars and slac on the very
    first day. Hence `.get()` everywhere and `closed` as the branch, not a hint.
  * Each library carries exactly 7 date-keyed records, one per day, no duplicates —
    so there are no split hours (open 09-12, 14-17) in this window. If that ever
    changes, `--dump` prints duplicate days and the site model needs widening.
  * `attributes.hours` on a library is byte-identical to its primary location's hours
    for all 24 libraries, so the top-level venue needs `data[]` alone.
  * The interesting part is `included[]`: 64 sub-locations, of which the useful ones
    are those open when their parent desk is shut. green/all-night runs 23:55–08:00.

Times are kept as the source's full ISO-8601 strings with offset, deliberately. They
are absolute instants, so the page can compare them with `new Date(...)` and the
midnight-close case that cafes-logic.js needs a special branch for simply does not
arise. It also means a reader in another timezone gets the right answer.
"""
import json
import os
import sys
import urllib.request

URL = "https://library-hours.stanford.edu/libraries.json"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site/data/libraries.json")
UA = "stanford-dining-menus/1.0 (+https://github.com/matmat202/stanford-dining-menus)"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def clean_hours(raw):
    """Normalise one library's or location's hours array.

    Keeps the ISO instants verbatim. Emits `closed` days as {day, weekday, closed}
    with no time keys at all, mirroring the source rather than inventing nulls.
    """
    out = []
    for h in raw or []:
        rec = {"day": h.get("day"), "weekday": h.get("weekday")}
        if h.get("closed") or not h.get("opens_at") or not h.get("closes_at"):
            rec["closed"] = True
        else:
            rec["closed"] = False
            rec["opens_at"] = h["opens_at"]
            rec["closes_at"] = h["closes_at"]
        out.append(rec)
    return out


def any_open(hours):
    return any(not h["closed"] for h in hours)


def build(doc):
    locations = {}
    for item in doc.get("included", []):
        if item.get("type") != "locations":
            continue
        locations[item["id"]] = item

    venues = []
    for lib in doc.get("data", []):
        attrs = lib.get("attributes", {})
        primary_id = attrs.get("primary_location")
        hours = clean_hours(attrs.get("hours"))

        # Sub-locations worth showing: not the primary (its hours are the venue's own),
        # and open at some point this week. The permanently-shut desks — privileges,
        # online reference, request-pickup — are noise on a page about where to go now.
        subs = []
        for ref in lib.get("relationships", {}).get("locations", {}).get("data", []):
            loc = locations.get(ref.get("id"))
            if not loc or ref.get("id") == primary_id:
                continue
            lh = clean_hours(loc.get("attributes", {}).get("hours"))
            if not any_open(lh):
                continue
            subs.append({
                "id": loc["id"],
                "name": loc.get("attributes", {}).get("name") or loc["id"],
                "hours": lh,
            })
        subs.sort(key=lambda s: s["name"])

        venues.append({
            "id": lib.get("id"),
            "name": attrs.get("name") or lib.get("id"),
            "hours": hours,
            "open_this_week": any_open(hours),
            "locations": subs,
        })

    venues.sort(key=lambda v: (not v["open_this_week"], v["name"]))
    return {"source": URL, "venues": venues}


def main():
    try:
        doc = fetch(URL)
    except Exception as e:  # noqa: BLE001 — the caller only needs the reason
        print(f"scrape_libraries: fetch failed: {e}", file=sys.stderr)
        return 2

    if not isinstance(doc, dict) or not isinstance(doc.get("data"), list) or not doc["data"]:
        print("scrape_libraries: no data[] array — the API shape changed", file=sys.stderr)
        return 2

    payload = build(doc)
    venues = payload["venues"]

    if "--dump" in sys.argv:
        dups = 0
        for v in venues:
            days = [h["day"] for h in v["hours"]]
            dup = sorted({d for d in days if days.count(d) > 1})
            if dup:
                dups += 1
            openly = sum(1 for h in v["hours"] if not h["closed"])
            flag = "" if v["open_this_week"] else "   (CLOSED ALL WEEK)"
            print(f"\n{v['name']}  [{v['id']}]{flag}")
            print(f"    {openly}/{len(v['hours'])} days open"
                  + (f"   DUPLICATE DAYS {dup} — split hours, model needs widening" if dup else ""))
            for h in v["hours"]:
                if h["closed"]:
                    print(f"    {h['weekday'][:3]} closed")
                else:
                    print(f"    {h['weekday'][:3]} {h['opens_at'][11:16]}–{h['closes_at'][11:16]}"
                          + ("  (next day)" if h["closes_at"][:10] != h["day"] else ""))
            for s in v["locations"]:
                mon = next((x for x in s["hours"] if not x["closed"]), None)
                span = f"{mon['opens_at'][11:16]}–{mon['closes_at'][11:16]}" if mon else "—"
                print(f"      + {s['name']}  (e.g. {span})")
        print(f"\n{len(venues)} libraries, "
              f"{sum(1 for v in venues if v['open_this_week'])} open at some point this week, "
              f"{sum(len(v['locations']) for v in venues)} sub-locations kept")
        if dups:
            print(f"WARNING: {dups} libraries have duplicate day records", file=sys.stderr)
        return 0

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    size = os.path.getsize(OUT)
    print(f"wrote {OUT} — {len(venues)} libraries, "
          f"{sum(len(v['locations']) for v in venues)} sub-locations, {size // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
