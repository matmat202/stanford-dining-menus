/* search-logic.js — does a typed query match a dish?
 *
 * The search box used to be a raw substring test on the lowercased name and ingredients.
 * Measured on the 10-23..10-29 payload, 69 of 355 dishes (19.4%) could not be found by
 * typing their own name the way a phone keyboard types it: "gyudon" for Gyūdon, "chefs
 * choice" for Chef's Choice, "gluten free" for Gluten-Free, "biscuits and gravy" for
 * Biscuits & Gravy. Plurals missed too: "burgers" found none of the five burger dishes.
 *
 * So both sides are folded the same way before the substring test: accents stripped,
 * apostrophes and the Hawaiian ʻokina dropped (chick'n -> chickn), '&' read as "and",
 * every other non-alphanumeric run turned into one space; and a second, stemmed
 * comparison drops plural endings (see matches). It stays a contiguous substring on
 * purpose: matching words in any order across name+ingredients was tried and returned
 * Chicken Tenders for "fried rice" (fried batter, rice flour), which is worse than a miss.
 */
(function (root) {
  const APOS = /['’‘ʻ`´]/g;

  /** One word's plural ending off: tacos->taco, potatoes->potato, berries->berry.
   *  Short words and -ss words (bass, swiss) are left alone. */
  function stem(w) {
    if (w.length <= 3 || w.endsWith('ss')) return w;
    if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.endsWith('oes')) return w.slice(0, -2);
    if (w.endsWith('s')) return w.slice(0, -1);
    return w;
  }

  /** Accents, apostrophes, '&' and punctuation folded; plural endings too unless stems=false. */
  function fold(s, stems = true) {
    const t = String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(APOS, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
    return t && stems ? t.split(' ').map(stem).join(' ') : t;
  }

  const cache = new Map();
  /** [plain, stemmed] folds of "name ingredients"; cached because render() runs per keystroke. */
  function haystack(name, ingredients) {
    const k = name + '\u0000' + (ingredients || '');
    let h = cache.get(k);
    if (h === undefined) {
      const raw = name + ' ' + (ingredients || '');
      h = [fold(raw, false), fold(raw)];
      cache.set(k, h);
    }
    return h;
  }

  /** True when the query (raw, as typed) matches the dish. An empty query matches all.
   *  Unanchored, like the old test. Anchoring at word starts was measured and dropped
   *  real compounds: "fruit" lost jackfruit, "fish" catfish, "bread" cornbread, "pea"
   *  chickpea, "fried" refried (projects/search-fold/measure.cjs).
   *  Two tests, not one: plain-vs-plain keeps the matches the old test had (stemming alone
   *  lost "veggie" -> Veggies, which stems to veggy); stemmed-vs-stemmed adds plurals.
   *  Stemmed query vs plain dish is the third: "chilis" stems to chili and "Chilies" to
   *  chily, so neither of the others found Green Chilies. Over 3,342 queries x 331 live
   *  dishes (2026-10-27) it lost no match and added 8, all -is spellings of -ies words. */
  function matches(query, name, ingredients) {
    const plain = fold(query, false);
    if (!plain) return true;
    const [hp, hs] = haystack(name, ingredients);
    const stemmed = fold(query);
    return hp.includes(plain) || hs.includes(stemmed) || hp.includes(stemmed);
  }

  const api = { fold, stem, matches };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SearchLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
