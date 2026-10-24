/* trucks-logic.js — which food truck is serving now, later today, or next.
 *
 * Trucks are DATED shifts ({date:'2026-10-26', open:'10:00', close:'15:00'}), not the
 * recurring weekday windows of cafés and rec, so CafeLogic.venueStatus does not apply.
 * The risky parts are the date key (it must come from the campus wall clock's local
 * fields, never toISOString(), which is UTC and turns 5 pm Pacific into tomorrow) and
 * the boundaries: a truck closing at 14:00 is closed at 14:00.
 *
 * `now` is a Date whose local fields read Stanford time (CafeLogic.campusDate).
 */
(function (root) {
  const pad = n => String(n).padStart(2, '0');
  const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const minutes = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

  /** 'open' (with minutes left), 'later' (opens today), 'done', or 'unknown' (no hours). */
  function status(row, now) {
    if (!row.open || !row.close) return { state: 'unknown' };
    const t = now.getHours() * 60 + now.getMinutes();
    const o = minutes(row.open), c = minutes(row.close);
    if (t < o) return { state: 'later', inMin: o - t };
    if (t < c) return { state: 'open', leftMin: c - t };
    return { state: 'done' };
  }

  const RANK = { open: 0, later: 1, unknown: 2, done: 3 };

  /** Today's trucks ranked open -> later -> done, and the next date after today that has any. */
  function plan(trucks, now) {
    const today = dateKey(now);
    const todays = trucks.filter(r => r.date === today)
      .map(r => ({ ...r, st: status(r, now) }))
      .sort((a, b) => (RANK[a.st.state] - RANK[b.st.state]) || (a.open || '').localeCompare(b.open || ''));
    const future = trucks.filter(r => r.date > today);
    const nextDate = future.length ? future.map(r => r.date).sort()[0] : null;
    return {
      today: todays,
      openNow: todays.filter(r => r.st.state === 'open').length,
      next: nextDate ? { date: nextDate, rows: future.filter(r => r.date === nextDate) } : null,
      week: [...new Set(future.map(r => r.date))].sort()
        .map(d => ({ date: d, rows: future.filter(r => r.date === d) })),
    };
  }

  const api = { dateKey, status, plan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TruckLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
