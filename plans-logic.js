/* plans-logic.js — which undergraduate meal plan wastes least for how you actually eat.
 *
 * R&DE prices the 19, 15 and 12 meal plans the same; fewer swipes come with more Meal Plan
 * Dollars. When the prices are equal, a plan with more swipes than you eat is strictly worse
 * than the smallest one that still covers you: the extra swipes expire every Saturday, and
 * the smaller plan pays you dollars for them instead. That claim depends on the prices being
 * equal, so it is checked per quarter rather than assumed; if R&DE ever prices them apart,
 * the picker shows the numbers and makes no recommendation.
 *
 * Dates are ISO 'YYYY-MM-DD' strings compared as strings, and day counts are computed in
 * UTC, so the viewer's timezone and DST cannot shift a week.
 */
(function (root) {
  const DAY = 86400000;
  const utc = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const addDays = (iso, n) => new Date(utc(iso) + n * DAY).toISOString().slice(0, 10);

  /** Plan weeks in a quarter, inclusive of both end dates. */
  const weeksIn = q => (utc(q.end) - utc(q.start) + DAY) / DAY / 7;

  /** R&DE: "You may change your meal plan during the first three weeks of the quarter." */
  const SWITCH_DAYS = 21;

  /** The quarter a decision is about on `today`: the one in progress, else the next one.
   *  Between quarters that is the coming one; after the last, null. */
  function quarterFor(dates, today) {
    const sorted = [...dates].sort((a, b) => a.start.localeCompare(b.start));
    return sorted.find(q => q.start <= today && today <= q.end)
      || sorted.find(q => q.start > today) || null;
  }

  /** When the plan can next be changed: {quarter, from, until, open}. `open` means today is
   *  inside the window. Once this quarter's window has shut, it is the next quarter's. */
  function switchWindow(dates, today) {
    const sorted = [...dates].sort((a, b) => a.start.localeCompare(b.start));
    for (const q of sorted) {
      const until = addDays(q.start, SWITCH_DAYS - 1);
      if (today <= until)
        return { quarter: q.quarter, from: q.start, until, open: today >= q.start };
    }
    return null;
  }

  /**
   * Compare the plans for one quarter at `meals` hall meals a week.
   * data: plans.json. Returns null if the quarter is missing from any plan.
   * {quarter, weeks, sameCost, rows:[{swipes, cost, mpd, eligible, used, wasted, short}],
   *  pick (swipes, or null), rates:[{from, to, perSwipe}]}
   */
  function compare(data, quarterName, meals, { upper = true } = {}) {
    const q = data.dates.find(d => d.quarter === quarterName);
    if (!q) return null;
    const weeks = weeksIn(q);
    const rows = [];
    for (const p of data.plans) {
      const pq = p.quarters.find(x => x.quarter === quarterName);
      if (!pq) return null;
      const used = Math.min(meals, p.swipes);
      rows.push({ swipes: p.swipes, cost: pq.cost, mpd: pq.mpd, eligible: upper || !p.upper_only,
                  used, wasted: p.swipes - used, short: meals - used });
    }
    rows.sort((a, b) => b.swipes - a.swipes);
    const sameCost = rows.every(r => r.cost === rows[0].cost);

    let pick = null;
    if (sameCost) {
      const ok = rows.filter(r => r.eligible);
      const covering = ok.filter(r => r.swipes >= meals);
      pick = covering.length ? covering[covering.length - 1].swipes
        : ok.length ? ok[0].swipes : null;
    }

    // What one swipe a week, given up for the quarter, is bought back at.
    const rates = [];
    for (let i = 0; i + 1 < rows.length; i++) {
      const a = rows[i], b = rows[i + 1];
      const swipes = (a.swipes - b.swipes) * weeks;
      if (swipes > 0) rates.push({ from: a.swipes, to: b.swipes, perSwipe: (b.mpd - a.mpd) / swipes });
    }
    return { quarter: quarterName, weeks, sameCost, rows, pick, rates };
  }

  const api = { weeksIn, quarterFor, switchWindow, compare, SWITCH_DAYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PlanLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
