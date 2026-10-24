/* walk-logic.js — "can I get there before it closes?"
 *
 * With Near me on, the Halls view sorts open halls first and then by distance. That
 * sort alone sent people to halls that shut before they arrived. Measured over 311
 * campus buildings and every meal-minute (projects/walk-reach/measure.py), the top
 * "serving" hall closed before a walker got there in 6-10% of weekday minutes. In a
 * third of those cases, another open hall was still reachable.
 *
 * So distance becomes walking minutes, and an open hall is judged against them:
 *   late  — it closes before you would arrive; sorted below the halls you can reach
 *   tight — you would arrive with under TIGHT minutes of service left
 * Straight-line metres times DETOUR at SPEED m/min. Campus paths are not straight, so
 * this errs slightly long, which is the safe direction for a "you won't make it" call.
 */
(function (root) {
  const DETOUR = 1.25;   // path length over crow-fly distance
  const SPEED = 80;      // m/min, about 4.8 km/h
  const TIGHT = 10;      // minutes at the hall that still count as a meal
  const WALKABLE = 2000; // beyond this, show km: nobody walks 30 min to lunch

  function minutes(m) {
    return Math.max(1, Math.ceil(m * DETOUR / SPEED));
  }

  /** "6 min walk" up to WALKABLE metres, then "2.4 km". */
  function label(m) {
    if (m > WALKABLE) return `${(m / 1000).toFixed(1)} km`;
    return `${minutes(m)} min walk`;
  }

  /** st is statusFor()'s result; an open status carries `left` (minutes to close). */
  function reach(st, m) {
    if (m == null || !st || st.k !== 'open' || st.left == null) return null;
    const walk = minutes(m), spare = st.left - walk;
    if (spare < 0) return { k: 'late', walk, txt: 'closes before you’d get there' };
    if (spare < TIGHT) return { k: 'tight', walk, txt: `~${spare} min left when you arrive` };
    return { k: 'ok', walk };
  }

  /** Sort rank: reachable open, then opening soon, then open-but-late, then shut. */
  function rank(st, r) {
    if (st.k === 'open') return r && r.k === 'late' ? 1.5 : 0;
    return st.k === 'soon' ? 1 : 2;
  }

  const api = { minutes, label, reach, rank, DETOUR, SPEED, TIGHT, WALKABLE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WalkLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
