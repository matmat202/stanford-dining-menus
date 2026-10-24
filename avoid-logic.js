/* avoid-logic.js — "hide dishes made with things I don't eat".
 *
 * The allergen chips cover R&DE's ten tagged allergens and nothing else. Measured on the
 * 10/23 payload (projects/avoid-list/BRIEF.md): mushroom is in 41 of 361 dishes and 31 of
 * those say so only in the ingredient list; cilantro 39 / 34; onion 177 / 176. A dish name
 * does not tell you, so the list has to be read for you.
 *
 * Whole words, not substrings, and that is the risky part: a substring test hides
 * Eggplant for "egg", Graham crackers for "ham" and Scallions for "scallop"'s cousin. A
 * false hide is worse than a miss here, because a hidden dish is one nobody sees to
 * question. Plurals fold through SearchLogic's stem, so "mushroom" catches "mushrooms"
 * and "berries" catches "berry".
 */
(function (root) {
  const SL = (typeof module !== 'undefined' && module.exports)
    ? require('./search-logic.js') : root.SearchLogic;

  const KEY = 'dining-avoid-v1';
  const MAX_TERMS = 30;

  /** "Mushrooms, cilantro;  bell peppers" -> ['mushroom', 'cilantro', 'bell pepper'] (folded, stemmed, unique). */
  function parse(text) {
    const out = [];
    for (const part of String(text || '').split(/[,;\n]+/)) {
      const t = SL.fold(part);
      if (t && !out.includes(t)) out.push(t);
      if (out.length >= MAX_TERMS) break;
    }
    return out;
  }

  const cache = new Map();
  /** " folded stemmed words " with sentinel spaces, so a term matches only on word boundaries. */
  function words(name, ingredients) {
    const k = name + '\u0000' + (ingredients || '');
    let w = cache.get(k);
    if (w === undefined) {
      w = ' ' + SL.fold(name + ' ' + (ingredients || '')) + ' ';
      cache.set(k, w);
    }
    return w;
  }

  /** The terms (already parsed) that this dish's name or ingredients contain, in list order. */
  function hits(terms, name, ingredients) {
    if (!terms || !terms.length) return [];
    const w = words(name, ingredients);
    return terms.filter(t => w.includes(' ' + t + ' '));
  }

  /** Per-term counts over a list of dishes ({n, i}), for "mushroom hides 9" in the drawer. */
  function tally(terms, dishes) {
    const counts = Object.fromEntries(terms.map(t => [t, 0]));
    let hidden = 0;
    for (const d of dishes) {
      const h = hits(terms, d.n, d.i);
      if (h.length) hidden++;
      for (const t of h) counts[t]++;
    }
    return { hidden, counts };
  }

  /** localStorage, guarded: private mode and blocked storage must not break the page. */
  function load(store) {
    try { const v = JSON.parse(store.getItem(KEY) || '[]'); return Array.isArray(v) ? parse(v.join(',')) : []; }
    catch { return []; }
  }
  function save(store, terms) {
    try { terms.length ? store.setItem(KEY, JSON.stringify(terms)) : store.removeItem(KEY); } catch {}
  }

  const api = { KEY, parse, hits, tally, load, save };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AvoidLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
