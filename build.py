#!/usr/bin/env python3
"""Compact the scraped menus into a payload the site can ship.

2,468 dish rows contain only 377 distinct dishes — the same "Scrambled Eggs" with the
same ingredient list appears in dozens of hall/day/meal slots. Storing each dish once
and referencing it by index cuts the payload by roughly 4x, which matters because the
whole point is a page that loads instantly and then filters client-side.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("DINING_SITE") or os.path.join(HERE, "site")
SRC = os.path.join(SITE, "data", "menus.json")
DST = os.path.join(SITE, "data", "site.json")

META = os.path.join(HERE, "halls.json")
TAG_CODE = {"vegan": "vg", "vegetarian": "v", "gluten-free": "gf",
            "halal": "h", "kosher": "k"}

# R&DE's own data contains the literal placeholder "TRACEALLERGENS" in the *allergens*
# field on a handful of dishes (verified against their served HTML, 2026-10-17) — it is
# their data-entry artifact, not a parsing error here. It is not an allergen, so it is
# dropped rather than offered as a filter. Anything else unrecognised is kept and
# reported, so a genuinely new allergen surfaces instead of being silently swallowed.
JUNK_ALLERGENS = {"TRACEALLERGENS"}
KNOWN_ALLERGENS = {"COCONUT", "EGG", "FISH", "MILK", "PEANUTS", "SESAME",
                   "SHELLFISH", "SOY", "TREENUTS", "WHEAT", "GLUTEN"}


def clean_allergens(raw):
    toks = [t.strip() for t in (raw or "").split(",") if t.strip()]
    kept = [t for t in toks if t.upper() not in JUNK_ALLERGENS]
    unknown = {t.upper() for t in kept} - KNOWN_ALLERGENS
    return ", ".join(kept), unknown


def main():
    with open(SRC) as f:
        raw = json.load(f)
    with open(META) as f:
        meta = json.load(f)
    halls_meta = meta["halls"]

    dishes, index = [], {}
    unknown_allergens, junk_hits = set(), 0
    menus = {}
    halls_seen, days, meals = [], raw["days"], []

    for key, items in raw["menus"].items():
        if not items:
            continue
        hall, day, meal = key.split("|")
        if hall not in halls_seen:
            halls_seen.append(hall)
        if meal not in meals:
            meals.append(meal)
        refs = []
        for it in items:
            alg, unknown = clean_allergens(it["allergens"])
            if alg != (it["allergens"] or ""):
                junk_hits += 1
            unknown_allergens |= unknown
            it = {**it, "allergens": alg}
            sig = (it["name"], it["ingredients"], it["allergens"],
                   it["trace_allergens"], tuple(it["tags"]))
            i = index.get(sig)
            if i is None:
                i = len(dishes)
                index[sig] = i
                dishes.append({
                    "n": it["name"],
                    "i": it["ingredients"],
                    "a": it["allergens"],
                    "x": it["trace_allergens"],
                    "t": [TAG_CODE.get(t, t) for t in it["tags"]],
                })
            refs.append(i)
        menus[f"{halls_seen.index(hall)}|{days.index(day)}|{meals.index(meal)}"] = refs

    # allergen vocabulary, for the exclusion filter
    allergens = sorted({a.strip() for d in dishes for a in d["a"].split(",") if a.strip()})

    def hall_entry(h):
        m = halls_meta.get(h, {})
        e = {"id": h, "name": m.get("name", h)}
        for k in ("concept", "specialty", "coords", "coords_approximate",
                  "hours", "latenight"):
            if k in m:
                e[k] = m[k]
        return e

    out = {
        "scraped_at": raw["scraped_at"],
        "source": raw["source"],
        "hours_source": meta["_source"]["hours"],
        "hours_note": meta["_source"]["note"],
        "halls": [hall_entry(h) for h in halls_seen],
        "days": days,
        "meals": meals,
        "allergens": allergens,
        "dishes": dishes,
        "menus": menus,
    }
    os.makedirs(os.path.dirname(DST), exist_ok=True)
    with open(DST, "w") as f:
        json.dump(out, f, separators=(",", ":"))

    before = os.path.getsize(SRC) / 1024
    after = os.path.getsize(DST) / 1024
    print(f"{len(raw['menus'])} menus -> {len(menus)} non-empty | "
          f"{sum(len(v) for v in raw['menus'].values())} rows -> {len(dishes)} unique dishes")
    print(f"{before:.0f} KB -> {after:.0f} KB ({after/before*100:.0f}%)")
    print(f"halls with data: {len(halls_seen)} | meals: {meals} | allergens: {len(allergens)}")
    empty = [h for h in raw["halls"] if h not in halls_seen]
    if empty:
        print(f"NOTE halls with no data at all: {', '.join(empty)}")
    if junk_hits:
        print(f"NOTE dropped R&DE's TRACEALLERGENS placeholder from {junk_hits} dish rows")
    if unknown_allergens:
        print(f"NOTE unrecognised allergen tokens kept as-is: "
              f"{', '.join(sorted(unknown_allergens))} — check whether R&DE added one")


if __name__ == "__main__":
    main()
