/* holidays-logic.js — R&DE's break schedule over the regular weekly hours.
 *
 * R&DE publishes break hours only as a one-off PDF; the hours pages keep listing the
 * regular quarter through the break (Wayback, Thanksgiving 2025). So halls.json and
 * cafes.json say "open" for venues the PDF says are closed. data/holidays.json is that
 * PDF transcribed by hand (projects/holiday-hours/BRIEF.md says why not parsed):
 *
 *   labels:     [{from, until, label}]  which break a date belongs to (optional)
 *   closed:     [{keys, from, until, reopens}]  local 'YYYY-MM-DDTHH:MM', until exclusive
 *   days:       {key: {'YYYY-MM-DD': [open, close] | null}}  a whole day's hours, null = closed
 *   hall_hours: [{ids, from, to, hours: {Meal: [start, end]}}]  replaces a hall's meal windows
 *
 * ONE top-level `label` was enough while the file held one break. It cannot hold two:
 * Thanksgiving runs out 2026-12-01 and winter break is the next PDF R&DE posts
 * (projects/prize-watch watch 'dininghours' fires when it appears), and with a single
 * label every winter closure would read "Closed for Thanksgiving". `labels` resolves the
 * break by DATE instead of per entry, which is what makes it cover all three structures
 * at once -- breaks are date-disjoint, so one lookup serves `closed`, `days` and
 * `hall_hours` rather than fixing `closed` and leaving the other two mislabelled. Absent
 * `labels`, `label` still answers, so a one-break file keeps working unchanged.
 *
 * Keys: 'hall:<halls.json id>', 'late:<hall id>' (its late-night service), and
 * 'venue:<name>', where the name goes through CafeLogic.payKey so R&DE's spellings join.
 * Every lookup takes a campus-clock Date and compares local fields, never toISOString(),
 * which is UTC and would move a 7 pm Pacific lookup to tomorrow.
 */
(function (root) {
  const CL = (typeof module !== 'undefined' && module.exports) ? require('./cafes-logic.js') : root.CafeLogic;
  const p2 = n => String(n).padStart(2, '0');
  const dayKey = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const stamp = d => `${dayKey(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}`;

  function norm(key) {
    const i = String(key).indexOf(':');
    const kind = key.slice(0, i), name = key.slice(i + 1);
    return kind === 'venue' ? `venue:${CL.payKey(name)}` : `${kind}:${name}`;
  }

  /** Which break `now` falls in: the matching `labels` range, else the file's single
   *  `label`, else null. Null rather than a default, because the two callers word the
   *  no-label case differently ('break' vs 'the break') and flattening them here would
   *  quietly change the sentence a venue shows. */
  function labelAt(H, now) {
    if (!H) return null;
    const t = stamp(now);
    if (H.labels) for (const l of H.labels) if (t >= l.from && t < l.until) return l.label;
    return H.label || null;
  }

  /** -> {reopens, label} when the break schedule closes `key` at `now`, else null. */
  function closure(H, key, now) {
    if (!H || !H.closed) return null;
    const k = norm(key), t = stamp(now);
    for (const c of H.closed) {
      if (t >= c.from && t < c.until && c.keys.some(x => norm(x) === k))
        return { reopens: c.reopens, label: labelAt(H, now) || 'break' };
    }
    return null;
  }

  /** A venue's break hours for now's date: undefined when the PDF has no row for that
   *  day (regular hours apply), null when it says CLOSED, else [open, close]. */
  function dayHours(H, key, now) {
    if (!H || !H.days) return undefined;
    const k = norm(key);
    for (const [name, days] of Object.entries(H.days)) {
      if (norm(name) === k && Object.prototype.hasOwnProperty.call(days, dayKey(now))) return days[dayKey(now)];
    }
    return undefined;
  }

  /** CafeLogic.venueStatus with the break applied: {open:false, holiday:'…'} when closed. */
  function venueStatus(H, name, windows, now) {
    const c = closure(H, `venue:${name}`, now);
    if (c) return { open: false, holiday: `Closed for ${c.label} · reopens ${c.reopens}` };
    const h = dayHours(H, `venue:${name}`, now);
    if (h === null) return { open: false, holiday: `Closed today for ${labelAt(H, now) || 'the break'}` };
    if (h) return CL.venueStatus([{ days: [CL.jsDayToIdx(now.getDay())], open: h[0], close: h[1], overnight: false }], now);
    return CL.venueStatus(windows, now);
  }

  /** A hall's meal windows for `date` during the break ({Meal: [start, end]}), else null. */
  function hallHours(H, id, date) {
    if (!H || !H.hall_hours) return null;
    const d = dayKey(date);
    for (const r of H.hall_hours) if (r.ids.includes(id) && d >= r.from && d <= r.to) return r.hours;
    return null;
  }

  const api = { dayKey, stamp, labelAt, closure, dayHours, venueStatus, hallHours };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HolidayLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
