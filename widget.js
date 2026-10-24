/* Stanford dining widget \u2014 one script tag, no build, no dependencies.
 *
 *   <div data-stanford-dining="Arrillaga"></div>
 *   <script src="widget.js" defer></script>
 *
 * Optional attributes on the container:
 *   data-meal="Dinner"     pin a meal instead of choosing by the clock
 *   data-diet="vg"         only dishes carrying this tag (vg v gf h k)
 *   data-limit="8"         rows before "Show all"; 0 shows everything
 *   data-src="\u2026/site.json" feed URL; defaults to the live dining site's payload
 *   data-theme="dark"      force a theme; otherwise follows prefers-color-scheme
 *
 * The feed is the one dining-menus already publishes. Its menus are keyed by INDEX \u2014
 * "hallIdx|dayIdx|mealIdx" -> [dishIdx\u2026] \u2014 not by name, so every lookup goes through
 * the arrays rather than guessing at strings.
 *
 * "Now" is campus time (America/Los_Angeles), not the viewer's: a widget can be embedded
 * on a page read from anywhere, and "today's lunch" means Stanford's today. The main site
 * can use local time because its readers are on campus; this cannot assume that.
 */
(function (root) {
  'use strict';

  const FEED = 'https://matmat202.github.io/stanford-dining-menus/data/site.json';
  const SITE = 'https://matmat202.github.io/stanford-dining-menus/';
  const TZ = 'America/Los_Angeles';
  const TAGS = { vg: 'Vegan', v: 'Vegetarian', gf: 'Gluten-free', h: 'Halal', k: 'Kosher' };

  // ------------------------------------------------------------------ pure core

  /** Campus date and minute-of-day for an instant: {day:'MM/DD/YYYY', minutes, weekend}. */
  function campusNow(date = new Date()) {
    const parts = {};
    for (const p of new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
    }).formatToParts(date)) parts[p.type] = p.value;
    return {
      day: `${parts.month}/${parts.day}/${parts.year}`,
      minutes: Number(parts.hour) * 60 + Number(parts.minute),
      weekend: parts.weekday === 'Sat' || parts.weekday === 'Sun',
    };
  }

  const hm = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const fmt = mins => {
    const h = Math.floor(mins / 60) % 24, m = mins % 60;
    const ap = h >= 12 ? 'pm' : 'am', h12 = h % 12 === 0 ? 12 : h % 12;
    return m ? `${h12}:${String(m).padStart(2, '0')}${ap}` : `${h12}${ap}`;
  };

  /** Hall index by id or display name, case-insensitive; -1 if unknown. */
  function hallIndex(data, want) {
    const w = String(want || '').trim().toLowerCase();
    if (!w) return -1;
    return data.halls.findIndex(h => h.id.toLowerCase() === w || h.name.toLowerCase() === w);
  }

  /** Meal indices that have a published menu for this hall and day, in feed order. */
  function mealsServed(data, hi, di) {
    return data.meals.map((_, mi) => mi)
      .filter(mi => (data.menus[`${hi}|${di}|${mi}`] || []).length > 0);
  }

  /** Serving window [start, end] in minutes, or null when the hours page lists none.
   *  An end before its start (late night) is not a meal window and is not handled here. */
  function windowFor(hall, mealName, weekend) {
    const w = ((hall.hours || {})[weekend ? 'weekend' : 'weekday'] || {})[mealName];
    return w ? [hm(w[0]), hm(w[1])] : null;
  }

  /** The meal to show at this minute: the one being served, else the next one today,
   *  else the last one served (after dinner you still want to see what dinner was).
   *  Only meals with a published menu are candidates. -1 if the day has none. */
  function pickMeal(data, hi, di, now) {
    const served = mealsServed(data, hi, di);
    if (!served.length) return -1;
    const hall = data.halls[hi];
    let next = -1;
    for (const mi of served) {
      const w = windowFor(hall, data.meals[mi], now.weekend);
      if (!w) continue;
      if (now.minutes >= w[0] && now.minutes <= w[1]) return mi;
      if (now.minutes < w[0] && next === -1) next = mi;
    }
    return next !== -1 ? next : served[served.length - 1];
  }

  /** Status phrase for a meal today: {open:boolean, text}. */
  function mealStatus(hall, mealName, now) {
    const w = windowFor(hall, mealName, now.weekend);
    if (!w) return { open: false, text: 'hours not listed' };
    if (now.minutes >= w[0] && now.minutes <= w[1]) return { open: true, text: `open until ${fmt(w[1])}` };
    if (now.minutes < w[0]) return { open: false, text: `${fmt(w[0])}\u2013${fmt(w[1])}` };
    return { open: false, text: `closed ${fmt(w[1])}` };
  }

  /** Dishes for one hall/day/meal, optionally only those carrying a diet tag. */
  function dishesFor(data, hi, di, mi, diet) {
    const refs = data.menus[`${hi}|${di}|${mi}`] || [];
    const out = [];
    for (const r of refs) {
      const d = data.dishes[r];
      if (!d) continue;                         // a dangling index must not throw
      if (diet && !(d.t || []).includes(diet)) continue;
      out.push(d);
    }
    return out;
  }

  /** First `limit` items and how many were held back. A lunch at Arrillaga is 25 rows,
   *  which is a page, not a widget. limit <= 0 or not a number means no limit. */
  function clip(list, limit) {
    const n = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : list.length;
    return { shown: list.slice(0, n), hidden: Math.max(0, list.length - n) };
  }

  /** Everything the renderer needs, or {error} naming why there is nothing to show.
   *  Pure: same feed, options and instant give the same answer. */
  function resolve(data, opts, date = new Date()) {
    const hi = hallIndex(data, opts.hall);
    if (hi === -1) return { error: `Unknown dining hall \u201c${opts.hall || ''}\u201d.` };
    const now = campusNow(date);
    const di = data.days.indexOf(now.day);
    const hall = data.halls[hi];
    if (di === -1) return { error: `No menu published for ${hall.name} today.`, hall };
    const served = mealsServed(data, hi, di);
    if (!served.length) return { error: `${hall.name} has no menu today.`, hall };
    let mi = -1;
    if (opts.meal) {
      const want = data.meals.findIndex(m => m.toLowerCase() === String(opts.meal).toLowerCase());
      if (served.includes(want)) mi = want;
    }
    if (mi === -1) mi = pickMeal(data, hi, di, now);
    const diet = TAGS[opts.diet] ? opts.diet : null;
    return {
      hall, hi, di, mi, diet, now, served,
      meal: data.meals[mi],
      status: mealStatus(hall, data.meals[mi], now),
      dishes: dishesFor(data, hi, di, mi, diet),
      scrapedAt: data.scraped_at,
    };
  }

  const core = { campusNow, hallIndex, mealsServed, windowFor, pickMeal, mealStatus,
                 dishesFor, clip, resolve, fmt, TAGS, FEED };

  // ------------------------------------------------------------------ renderer

  /* Shadow DOM, because the whole promise is "drop it on any page": the host's CSS must
     not restyle the widget, and the widget's must not leak out. Colours are checked for
     4.5:1 in both themes; the badge text is the darkest/lightest of its pair for that. */
  const CSS = `
:host{all:initial;display:block;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;
  --bg:#ffffff;--fg:#1c1c1e;--muted:#5a5a60;--line:#d9d9de;--accent:#8c1515;--open:#1f6b3a;
  --chip:#f2f2f4;--chip-fg:#1c1c1e;color:var(--fg)}
:host([data-theme="dark"]){--bg:#1c1c1e;--fg:#f2f2f4;--muted:#b4b4bb;--line:#3a3a3f;
  --accent:#ff8a8a;--open:#7fd49b;--chip:#2c2c30;--chip-fg:#f2f2f4}
@media (prefers-color-scheme: dark){:host(:not([data-theme="light"])){--bg:#1c1c1e;--fg:#f2f2f4;
  --muted:#b4b4bb;--line:#3a3a3f;--accent:#ff8a8a;--open:#7fd49b;--chip:#2c2c30;--chip-fg:#f2f2f4}}
/* :host loses to a host page's !important rules on the host element, and whatever wins
   there INHERITS in. Measured on a hostile page: lime dish names, uppercase, 30px serif.
   Inside the shadow tree a rule beats inheritance, so the card resets and re-declares. */
.card{all:initial;display:block;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;
  color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:10px;
  padding:14px 16px;max-width:28rem;box-sizing:border-box;text-align:left}
h2{margin:0;font-size:1.05em;font-weight:650;color:var(--fg)}
.sub{margin:2px 0 10px;color:var(--muted);font-size:.9em}
.sub .open{color:var(--open);font-weight:600}
.tabs{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}
.tabs button{font:inherit;font-size:.9em;padding:4px 10px;border-radius:999px;cursor:pointer;
  border:1px solid var(--line);background:var(--chip);color:var(--chip-fg);min-height:28px}
.tabs button[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:var(--bg)}
.more{font:inherit;font-size:.9em;margin-top:6px;padding:4px 0;min-height:28px;border:0;
  background:none;color:var(--accent);cursor:pointer;text-decoration:underline}
li:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.tabs button:focus-visible,a:focus-visible,.more:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
ul{list-style:none;margin:0;padding:0}
li{padding:6px 0;border-top:1px solid var(--line);display:flex;flex-wrap:wrap;gap:4px 8px;
  align-items:baseline;overflow-wrap:anywhere}
li:first-child{border-top:0}
.tag{font-size:.75em;padding:1px 6px;border-radius:4px;background:var(--chip);color:var(--chip-fg)}
.empty,.err{color:var(--muted);margin:4px 0}
.foot{margin-top:10px;font-size:.8em;color:var(--muted)}
.foot a{color:var(--accent)}`;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function updated(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('en-US', { timeZone: TZ, month: 'short',
      day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function paint(shadow, data, opts) {
    const r = resolve(data, opts);
    const card = el('section', 'card');
    shadow.replaceChildren(Object.assign(document.createElement('style'), { textContent: CSS }), card);
    if (r.error) {
      if (r.hall) card.append(el('h2', null, r.hall.name));
      card.append(el('p', 'err', r.error));
    } else {
      card.setAttribute('aria-label', `${r.hall.name} ${r.meal} menu`);
      card.append(el('h2', null, r.hall.name));
      const sub = el('p', 'sub');
      sub.append(`${r.meal} today \u00b7 `);
      sub.append(el('span', r.status.open ? 'open' : null, r.status.text));
      // A filtered list that does not say so reads as the hall serving only that.
      if (r.diet) sub.append(` \u00b7 ${TAGS[r.diet].toLowerCase()} only`);
      card.append(sub);
      if (r.served.length > 1) {
        const tabs = el('div', 'tabs');
        tabs.setAttribute('role', 'group');
        tabs.setAttribute('aria-label', 'Meal');
        for (const mi of r.served) {
          const b = el('button', null, data.meals[mi]);
          b.type = 'button';
          b.setAttribute('aria-pressed', String(mi === r.mi));
          b.onclick = () => { paint(shadow, data, { ...opts, meal: data.meals[mi], expanded: false });
                              shadow.querySelector('.tabs button[aria-pressed="true"]').focus(); };
          tabs.append(b);
        }
        card.append(tabs);
      }
      if (!r.dishes.length) {
        card.append(el('p', 'empty', r.diet ? `No ${TAGS[r.diet].toLowerCase()} dishes listed for ${r.meal.toLowerCase()}.`
                                            : 'No dishes listed.'));
      } else {
        const ul = el('ul');
        const { shown, hidden } = opts.expanded ? clip(r.dishes, 0) : clip(r.dishes, opts.limit);
        for (const d of shown) {
          const li = el('li');
          li.append(el('span', null, d.n));
          for (const t of d.t || []) if (TAGS[t]) li.append(el('span', 'tag', TAGS[t]));
          ul.append(li);
        }
        card.append(ul);
        if (hidden) {
          const more = el('button', 'more', `Show all ${r.dishes.length}`);
          more.type = 'button';
          more.onclick = () => { paint(shadow, data, { ...opts, expanded: true });
                                 shadow.querySelectorAll('li')[shown.length]?.setAttribute('tabindex', '-1');
                                 shadow.querySelectorAll('li')[shown.length]?.focus(); };
          card.append(more);
        }
      }
    }
    const foot = el('p', 'foot');
    const when = updated(data.scraped_at);
    foot.append(when ? `R&DE menus, updated ${when} \u00b7 ` : 'R&DE menus \u00b7 ');
    const a = el('a', null, 'Full menus & allergens');
    a.href = SITE; a.target = '_blank'; a.rel = 'noopener';
    foot.append(a);
    card.append(foot);
  }

  const feeds = new Map();   // one fetch per feed URL, however many widgets share it
  function load(src) {
    if (!feeds.has(src)) feeds.set(src, fetch(src).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }).then(d => {
      // a dish R&DE lists at two stations of one meal is one dish here (index.html boot())
      for (const k in d.menus) d.menus[k] = [...new Set(d.menus[k])];
      return d;
    }));
    return feeds.get(src);
  }

  function mount(host) {
    if (host.__stanfordDining) return;
    host.__stanfordDining = true;
    const shadow = host.attachShadow({ mode: 'open' });
    const opts = { hall: host.dataset.stanfordDining, meal: host.dataset.meal, diet: host.dataset.diet,
                   limit: host.dataset.limit == null ? 8 : Number(host.dataset.limit) };
    shadow.replaceChildren(Object.assign(document.createElement('style'), { textContent: CSS }),
                           // Inside the card: bare text would sit on whatever the host page paints.
                           Object.assign(el('section', 'card'), { textContent: 'Loading menu\u2026' }));
    load(host.dataset.src || FEED)
      .then(data => paint(shadow, data, opts))
      .catch(() => {
        const card = el('section', 'card');
        card.append(el('p', 'err', 'Menu unavailable right now.'));
        const a = el('a', null, 'Open the dining site');
        a.href = SITE; a.target = '_blank'; a.rel = 'noopener';
        const p = el('p', 'foot'); p.append(a); card.append(p);
        shadow.replaceChildren(Object.assign(document.createElement('style'), { textContent: CSS }), card);
      });
  }

  function mountAll(scope = document) {
    scope.querySelectorAll('[data-stanford-dining]').forEach(mount);
  }

  if (typeof module === 'object' && module.exports) module.exports = core;
  if (typeof document !== 'undefined') {
    root.StanfordDining = { ...core, mount, mountAll };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountAll());
    else mountAll();
  }
})(typeof window !== 'undefined' ? window : globalThis);
