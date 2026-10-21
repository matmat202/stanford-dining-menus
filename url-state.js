/* url-state.js — encode and decode the view as a shareable link.
 *
 * Two decisions worth stating, both from thinking about what a link means a week later:
 *
 * 1. **Dates and names, not indices.** `d=2` would point at a different day next week,
 *    silently. `d=2026-10-19` either resolves or is honestly out of range. Same for the
 *    meal: the name survives a change to the meal list, a position does not.
 * 2. **Everything from the URL is untrusted.** A hand-edited or stale link must degrade
 *    to a sane view, never to a blank page, so every field is validated against the
 *    payload and unknown values are dropped rather than carried.
 */
(function (root) {
  const DIETS = ['vg', 'v', 'gf', 'h', 'k'];
  const VIEWS = ['halls', 'compare', 'map', 'cafes', 'libraries', 'rec'];

  const pad = n => String(n).padStart(2, '0');

  /** payload day string "M/D/YYYY" -> "YYYY-MM-DD" */
  function toISO(mdy) {
    const [m, d, y] = String(mdy).split('/').map(Number);
    if (!m || !d || !y) return '';
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  /** Build the hash fragment for the current state. Omits anything at its default. */
  function serialize(state, data) {
    const p = new URLSearchParams();
    const iso = toISO(data.days[state.day]);
    if (iso) p.set('d', iso);
    if (data.meals[state.meal]) p.set('m', data.meals[state.meal]);
    if (state.view && state.view !== 'halls') p.set('v', state.view);
    const diets = [...(state.diets || [])].filter(x => DIETS.includes(x));
    if (diets.length) p.set('diet', diets.join(','));
    const ex = [...(state.exclude || [])];
    if (ex.length) p.set('x', ex.join(','));
    if (state.q) p.set('q', state.q);
    if (state.openOnly) p.set('open', '1');
    return p.toString();
  }

  /**
   * Decode a hash fragment against the payload.
   * @returns {{day:number, meal:number, view:string, diets:Set, exclude:Set,
   *            q:string, openOnly:boolean, staleDate:?string}}
   *   `staleDate` is set when the link named a date the current payload does not
   *   cover — the caller shows that rather than pretending the link worked.
   */
  function parse(hash, data, now = new Date()) {
    const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    const out = {
      day: null, meal: 0, view: 'halls',
      diets: new Set(), exclude: new Set(), q: '', openOnly: false, staleDate: null,
    };

    const isoDays = data.days.map(toISO);
    const wanted = p.get('d');
    if (wanted) {
      const i = isoDays.indexOf(wanted);
      if (i >= 0) out.day = i;
      else out.staleDate = wanted;     // valid-looking but not in this week's data
    }
    if (out.day === null) {
      const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const t = isoDays.indexOf(today);
      out.day = t >= 0 ? t : 0;
    }

    const meal = p.get('m');
    const mi = meal ? data.meals.findIndex(x => x.toLowerCase() === meal.toLowerCase()) : -1;
    out.meal = mi >= 0 ? mi : -1;      // -1 means "caller picks by clock"

    const v = p.get('v');
    if (v && VIEWS.includes(v)) out.view = v;

    for (const c of (p.get('diet') || '').split(',')) {
      if (DIETS.includes(c)) out.diets.add(c);
    }
    const known = new Set(data.allergens || []);
    for (const a of (p.get('x') || '').split(',')) {
      const up = a.trim().toUpperCase();
      if (known.has(up)) out.exclude.add(up);
    }
    out.q = (p.get('q') || '').trim().slice(0, 80).toLowerCase();
    out.openOnly = p.get('open') === '1';
    return out;
  }

  const api = { serialize, parse, toISO, DIETS, VIEWS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UrlState = api;
})(typeof window !== 'undefined' ? window : globalThis);
