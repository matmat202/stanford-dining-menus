/* pin-logic.js — "my hall first".
 *
 * Without Near me, halls tie on status at mealtime and fall back to the alphabet, and only
 * the first two cards open. Measured 2026-10-26 at 420px, lunch: Wilbur's card starts
 * 2,565px down (3.3 screens), collapsed. A student who eats at one hall paid that scroll
 * and a tap on every visit.
 *
 * A pin is a tiebreak, not an override: it ranks first among halls of the same status, so
 * a pinned hall that has stopped serving (or closes before you could walk there) still
 * sits below the ones you can actually eat at. Keyed by hall name, not index, because the
 * payload's hall order is R&DE's and can change between scrapes.
 */
(function (root) {
  const KEY = 'dining/pinned-halls/v1';

  /** localStorage, guarded: private mode and blocked storage must not break the page. */
  function load(store) {
    try {
      const v = JSON.parse(store.getItem(KEY) || '[]');
      return new Set(Array.isArray(v) ? v.filter(s => typeof s === 'string' && s) : []);
    } catch { return new Set(); }
  }
  function save(store, pinned) {
    try { pinned.size ? store.setItem(KEY, JSON.stringify([...pinned])) : store.removeItem(KEY); } catch {}
  }

  /** A new set with `name` flipped; the old one is left alone. */
  function toggle(pinned, name) {
    const next = new Set(pinned);
    next.has(name) ? next.delete(name) : next.add(name);
    return next;
  }

  /** Sort comparator on hall names: pinned before unpinned, 0 between equals. */
  function cmp(pinned, a, b) {
    return (pinned.has(b) ? 1 : 0) - (pinned.has(a) ? 1 : 0);
  }

  const api = { KEY, load, save, toggle, cmp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PinLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
