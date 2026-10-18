#!/usr/bin/env python3
"""Scrape Stanford R&DE dining hall menus into JSON.

Source: https://rdeapps.stanford.edu/dininghallmenu/Menu.aspx — an ASP.NET WebForms
page. There is no JSON API. Each (hall, day, meal) combination is a separate postback
carrying __VIEWSTATE and __EVENTVALIDATION, which are bound to the session cookie
that issued them: a stale viewstate returns ErrorPage.aspx. So every request re-reads
the tokens from the response it is about to post against.

Stdlib only.
"""
import html as H
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar

URL = "https://rdeapps.stanford.edu/dininghallmenu/Menu.aspx"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
F_HALL, F_DAY, F_MEAL = ("ctl00$MainContent$lst" + x for x in ("Locations", "Day", "MealType"))
HERE = os.path.dirname(os.path.abspath(__file__))
# DINING_SITE lets the same script serve both layouts: the sandbox keeps the page under
# site/, the published GitHub Pages repo is flattened to the repo root.
SITE = os.environ.get("DINING_SITE") or os.path.join(HERE, "site")
OUT = os.path.join(SITE, "data")
POLITE_DELAY = 0.7   # be a good citizen; this is someone else's server


def _attrs(tag):
    return dict(re.findall(r'([\w-]+)="([^"]*)"', tag))


class Session:
    """Holds the cookie jar plus the viewstate from the most recent response."""

    def __init__(self):
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
        self.tokens = {}
        self.options = {}

    def _absorb(self, body):
        """Re-read the ASP.NET tokens and the dropdown options from a response."""
        self.tokens = {}
        for tag in re.findall(r"<input\b[^>]*>", body):
            a = _attrs(tag)
            n, t = a.get("name"), (a.get("type") or "").lower()
            if n and t in ("hidden", "submit"):
                self.tokens[n] = H.unescape(a.get("value", ""))
        for m in re.finditer(r'<select\b[^>]*name="([^"]+)"[^>]*>(.*?)</select>', body, re.S):
            name, inner = m.group(1), m.group(2)
            self.options[name] = [H.unescape(v) for v in
                                  re.findall(r'<option[^>]*value="([^"]*)"', inner)]
        return body

    def get(self):
        req = urllib.request.Request(URL, headers={"User-Agent": UA})
        return self._absorb(self.op.open(req, timeout=45).read().decode("utf-8", "replace"))

    def post(self, hall, day, meal):
        fields = dict(self.tokens)
        fields.update({F_HALL: hall, F_DAY: day, F_MEAL: meal,
                       "__EVENTTARGET": "", "__EVENTARGUMENT": ""})
        req = urllib.request.Request(
            URL, data=urllib.parse.urlencode(fields).encode(),
            headers={"User-Agent": UA, "Referer": URL,
                     "Content-Type": "application/x-www-form-urlencoded"})
        body = self.op.open(req, timeout=45).read().decode("utf-8", "replace")
        if "application error" in body.lower():
            raise RuntimeError("ASP.NET error page (stale viewstate or bad field set)")
        return self._absorb(body)


DIET_CLASS = {"clsGF_Row": "gluten-free", "clsVGN_Row": "vegan",
              "clsV_Row": "vegetarian", "clsHALAL_Row": "halal"}


def _clean(frag):
    """HTML fragment -> collapsed plain text."""
    return " ".join(H.unescape(re.sub(r"<[^>]+>", " ", frag)).split())


def _span(li, cls):
    """Text of <span class="cls">…</span>, with its nested section label stripped."""
    m = re.search(r'<span class="%s">(.*?)</span>\s*</div>' % cls, li, re.S)
    if not m:
        m = re.search(r'<span class="%s">(.*?)(?=</span>\s*</div>)' % cls, li, re.S)
    if not m:
        return ""
    inner = re.sub(r'<span class="clsSectionName[^"]*">.*?</span>', "", m.group(1), flags=re.S)
    return _clean(inner)


def parse_menu(body):
    """Extract dishes from a menu response.

    Each dish is one <li class="clsMenuItem …">. Dietary status is encoded twice —
    in the li's class list (clsGF_Row, clsVGN_Row, clsV_Row, clsHALAL_Row) and as
    icon images with alt text. We read the classes as primary (they drive the site's
    own filters) and union the icon alts, since either can be absent.
    """
    items = []
    for m in re.finditer(r'<li[^>]*class="(clsMenuItem[^"]*)"[^>]*>(.*?)</li>', body, re.S):
        classes, li = m.group(1), m.group(2)
        name = _clean(re.search(r'<h3[^>]*class="clsLabel_Name">(.*?)</h3>', li, re.S).group(1)) \
            if re.search(r'<h3[^>]*class="clsLabel_Name">', li) else ""
        if not name:
            continue
        tags = {v for k, v in DIET_CLASS.items() if k in classes}
        for alt in re.findall(r'<img[^>]*class="clsLabel_IconImage"[^>]*alt="([^"]*)"', li):
            a = alt.strip().lower()
            tags.add({"gluten free": "gluten-free", "vegan": "vegan",
                      "vegetarian": "vegetarian", "halal": "halal"}.get(a, a))
        allergens = _span(li, "clsLabel_Allergens")
        trace = _span(li, "clsLabel_TraceAllergens")
        items.append({
            "name": name,
            "description": _span(li, "clsLabel_Description"),
            "ingredients": _span(li, "clsLabel_Ingredients"),
            "allergens": allergens,
            "trace_allergens": trace,
            "tags": sorted(t for t in tags if t),
        })
    return items


def scrape(days=None, halls=None, meals=None, verbose=True):
    s = Session()
    s.get()
    halls = halls or s.options.get(F_HALL) or []
    days = days or s.options.get(F_DAY) or []
    meals = meals or s.options.get(F_MEAL) or []
    halls = [h for h in halls if h]
    days = [d for d in days if d]
    meals = [m for m in meals if m]
    if verbose:
        print(f"halls={len(halls)} days={len(days)} meals={len(meals)} "
              f"-> {len(halls)*len(days)*len(meals)} requests", file=sys.stderr)

    out = {"source": URL, "scraped_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
           "halls": halls, "days": days, "meals": meals, "menus": {}}
    errors = 0
    for hall in halls:
        for day in days:
            for meal in meals:
                key = f"{hall}|{day}|{meal}"
                try:
                    body = s.post(hall, day, meal)
                    items = parse_menu(body)
                except (urllib.error.URLError, RuntimeError, TimeoutError) as e:
                    errors += 1
                    if verbose:
                        print(f"  ! {key}: {e}", file=sys.stderr)
                    s.get()          # re-seed tokens after a failure
                    time.sleep(1.5)
                    continue
                if items:
                    out["menus"][key] = items
                if verbose:
                    print(f"  {key}: {len(items)} items", file=sys.stderr)
                time.sleep(POLITE_DELAY)
    out["errors"] = errors
    return out


if __name__ == "__main__":
    probe = "--probe" in sys.argv
    data = scrape(days=["10/17/2026"], halls=["Arrillaga"], meals=["Dinner"]) if probe else scrape()
    if probe:
        print(json.dumps(data, indent=2)[:3000])
    else:
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, "menus.json"), "w") as f:
            json.dump(data, f, separators=(",", ":"))
        print(f"wrote {OUT}/menus.json — {len(data['menus'])} menus, {data['errors']} errors")
