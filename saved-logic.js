/* saved-logic.js — "when is this dish served next?"
 *
 * Separated and tested because the risky part is time reasoning, not rendering:
 * whether today's lunch still counts as upcoming at 2pm depends on meal ordering, and
 * an off-by-one there shows a student a meal they have already missed.
 *
 * Also handles a fact the data forced: 169 of 382 dishes recur, and the staples recur
 * 80-94 times a week. Enumerating those is noise, so anything appearing on five or
 * more days is reported as "most days" rather than listed out.
 */
(function (root) {
  const MANY_DAYS = 5;          // at or above this, summarise instead of enumerate
  const MAX_SHOWN = 4;

  /** dishIndex -> [{hall, dayIdx, mealIdx}] for everything in the payload. */
  function buildIndex(data) {
    const where = new Map();
    for (const [key, refs] of Object.entries(data.menus)) {
      const [hi, di, mi] = key.split('|').map(Number);
      for (const r of refs) {
        if (!where.has(r)) where.set(r, []);
        where.get(r).push({ hall: data.halls[hi].name, dayIdx: di, mealIdx: mi });
      }
    }
    return where;
  }

  /** Which (day, meal) slots are still ahead of `now`, given the payload's day list. */
  function isUpcoming(slot, data, now) {
    const [m, d, y] = data.days[slot.dayIdx].split('/').map(Number);
    const dayStart = new Date(y, m - 1, d);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (dayStart > today) return true;
    if (dayStart < today) return false;
    // Same day: a meal is still ahead if the clock has not passed its serving window.
    // Breakfast counts as past after 10:30, lunch after 16:00; dinner holds until
    // midnight. These mirror the hour thresholds the page uses to pick a default meal.
    const mins = now.getHours() * 60 + now.getMinutes();
    const name = data.meals[slot.mealIdx];
    if (name === 'Breakfast') return mins < 10 * 60 + 30;
    if (name === 'Lunch') return mins < 16 * 60;
    return true;
  }

  /**
   * @returns {{total:number, upcoming:Array, dayCount:number, everyday:boolean}}
   */
  function servingsFor(dishIdx, index, data, now = new Date()) {
    const all = index.get(dishIdx) || [];
    const upcoming = all.filter(s => isUpcoming(s, data, now))
      .sort((a, b) => a.dayIdx - b.dayIdx || a.mealIdx - b.mealIdx);
    const dayCount = new Set(all.map(s => s.dayIdx)).size;
    return {
      total: all.length,
      upcoming,
      shown: upcoming.slice(0, MAX_SHOWN),
      more: Math.max(0, upcoming.length - MAX_SHOWN),
      dayCount,
      everyday: dayCount >= MANY_DAYS,
    };
  }

  const api = { buildIndex, isUpcoming, servingsFor, MANY_DAYS, MAX_SHOWN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SavedLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
