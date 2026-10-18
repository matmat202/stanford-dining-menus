# Stanford Dining Menus

Every Stanford residential dining hall menu for the week, on one page, built for
phones. **Unofficial student project — not affiliated with or endorsed by Stanford
University.**

**→ https://matmat202.github.io/stanford-dining-menus/**

Add it to your home screen (Share → Add to Home Screen on iOS) and it runs like an
app, offline, with the last menus it fetched.

## What it does

- **Opens on the answer.** Today's date and the meal matching the clock — breakfast
  before 10:30, lunch before 16:00, dinner after.
- **Open now.** Real serving hours per hall, so halls are sorted serving-first and
  each shows `closes in 25 min` or `opens 5pm` rather than making you check a PDF.
- **Near me.** One tap for walking distance to each hall, sorted nearest-first.
- **Compare.** Every hall's menu for one meal, side by side in scrollable columns.
- **Map.** Pins coloured by whether a hall is serving, with directions links.
- **Diet filters and allergen exclusion.** Vegan, vegetarian, gluten-free, halal,
  kosher; exclude any of the allergens R&DE declares. Dishes available at exactly one
  hall are flagged `only here`.
- Every dish expands to its full ingredient list, declared allergens, and R&DE's
  "made on shared equipment with" trace list.

## Where the data comes from

| what | source |
|---|---|
| menus, ingredients, allergens, diet tags | [rdeapps.stanford.edu/dininghallmenu](https://rdeapps.stanford.edu/dininghallmenu/Menu.aspx) |
| serving hours, hall concepts, late night | [rde.stanford.edu — dining locations & hours](https://rde.stanford.edu/dining-hospitality/dining-locations-hours) |
| hall coordinates | [OpenStreetMap](https://www.openstreetmap.org/copyright) via Overpass |

There is no JSON API. `scrape.py` drives the ASP.NET form: each (hall, day, meal) is a
separate postback whose `__VIEWSTATE` and `__EVENTVALIDATION` are bound to the session
cookie that issued them, so the tokens are re-read from every response. Requests are
spaced 0.7 s apart.

## Rebuild it

```bash
./refresh.sh     # scrape + rebuild data/site.json, ~4 min
python3 -m http.server 8080
```

`build.py` de-duplicates: ~2,500 dish rows contain only ~380 distinct dishes, which
takes the payload from 629 KB to about 100 KB so the whole week loads at once and
filters without a server.

## Known gaps, stated rather than hidden

- **EVGR Dining** publishes no menu through this source.
- **Brunch returns empty for every hall.** R&DE serves weekend brunch but files it
  under *Lunch* (9:30–13:30 at Arrillaga and Lakeside, 10:30–13:30 elsewhere).
- **Gerhard Casper and Branner serve lunch and dinner only** — no breakfast.
- **Gerhard Casper's map pin is approximate** — the building is not in OpenStreetMap,
  so it is placed at the EVGR complex and labelled as approximate.
- R&DE's own data contains a literal `TRACEALLERGENS` placeholder in the allergens
  field of a few dishes; it is dropped, and any other unrecognised allergen token is
  reported at build time rather than silently shown.

## Allergen warning

Ingredient and allergen information comes from Stanford R&DE and changes without
notice. R&DE states it cannot guarantee the absence of allergens in its food or
facilities. **Do not rely on this page for a medically significant allergy** — confirm
at the hall.
