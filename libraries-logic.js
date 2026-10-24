/* libraries-logic.js — open/closed reasoning for campus library hours.
 *
 * Deliberately NOT built on cafes-logic.js, despite both answering "is it open now".
 * The café source is prose describing a recurring week ("Thursday - Saturday | 5pm -
 * 12am"), so that module models weekday sets and does minute arithmetic, and needs an
 * explicit `overnight` branch to handle a window crossing midnight.
 *
 * The library source is different in kind: a rolling seven days of **date-keyed
 * absolute instants** with offsets, e.g.
 *     opens_at  "2026-10-19T08:00:00.000-07:00"
 *     closes_at "2026-10-20T00:00:00.000-07:00"
 * Once those are Date objects, "closes at midnight" is just an instant later than
 * "opens", and the overnight special case disappears entirely — there is nothing to
 * special-case, because the record already says which day it ends on. Comparing
 * instants also gives the right answer to a reader who is not in Pacific time, which
 * minute-of-day arithmetic against a local clock cannot.
 *
 * Keeping date-specificity is the point: libraries close for holidays and quarter
 * breaks, and slac is shut all week. Folding these into a recurring weekly pattern
 * would throw away the exact thing that makes the answer true.
 *
 * A `closed` record carries NO time keys at all (the API omits them, it does not
 * null them), so `closed` is the branch everywhere and times are never assumed.
 */
(function (root) {
  /** An instant's campus wall-clock fields. Labels name Stanford time, like every other
   *  tab: a reader on a non-Pacific clock was told the library opened an hour late. */
  const campusFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles',
    hourCycle: 'h23', day: 'numeric', hour: 'numeric', minute: 'numeric' });
  function campus(d) {
    const p = {};
    for (const x of campusFmt.formatToParts(d)) p[x.type] = +x.value;
    return { date: p.day, hours: p.hour, minutes: p.minute };
  }

  /** Format an instant in campus time: 8am, 12am, 4:30pm. */
  function fmt12(d) {
    const { hours: h, minutes: m } = campus(d);
    return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h >= 12 ? 'pm' : 'am'}`;
  }

  /** Parse one record into instants, or null when the record says closed. */
  function span(h) {
    if (!h || h.closed || !h.opens_at || !h.closes_at) return null;
    const open = new Date(h.opens_at), close = new Date(h.closes_at);
    if (isNaN(open) || isNaN(close) || close <= open) return null;
    return { open, close, rec: h };
  }

  /**
   * Status of a venue or sub-location from its seven date-keyed records.
   *
   * Because the records are absolute intervals, there is no need to work out which
   * one is "today": the open check is simply whether any interval contains `now`.
   * An interval opening 23:55 Monday and closing 08:00 Tuesday answers correctly at
   * 03:00 Tuesday without the caller knowing it is an overnight window.
   *
   * @param {Array}  hours [{day, weekday, closed, opens_at?, closes_at?}]
   * @param {Date}   now   injectable so tests can fabricate a clock
   * @returns {{open:boolean, until?:string, opensAt?:string, opensDay?:string,
   *            opensInMin?:number, neverThisWeek?:boolean}}
   */
  function libraryStatus(hours, now = new Date()) {
    const spans = (hours || []).map(span).filter(Boolean);
    if (!spans.length) return { open: false, neverThisWeek: true };

    for (const s of spans) {
      if (now >= s.open && now < s.close) {
        return { open: true, until: fmt12(s.close), closesAt: s.close };
      }
    }

    // Not open: the soonest future opening, which may be days away.
    let next = null;
    for (const s of spans) if (s.open > now && (!next || s.open < next.open)) next = s;
    if (!next) return { open: false, neverThisWeek: true };

    return {
      open: false,
      opensAt: fmt12(next.open),
      opensDay: next.rec.weekday || null,
      opensInMin: Math.round((next.open - now) / 60000),
      opensOn: next.open,
    };
  }

  /** True when a venue closes at or after 21:00 on some day, or runs past midnight. */
  function isLate(hours) {
    return (hours || []).map(span).filter(Boolean).some(s =>
      campus(s.close).date !== campus(s.open).date || campus(s.close).hours >= 21);
  }

  /** "Open until 12am" / "Opens 8am" / "Opens Monday 8am" / "Closed this week". */
  function statusLabel(st) {
    if (!st) return '';
    if (st.open) return `Open until ${st.until}`;
    if (st.neverThisWeek) return 'Closed this week';
    // Within the next ~16 hours the weekday is noise; beyond that it is the useful part.
    if (st.opensInMin != null && st.opensInMin <= 16 * 60) return `Opens ${st.opensAt}`;
    return st.opensDay ? `Opens ${st.opensDay} ${st.opensAt}` : `Opens ${st.opensAt}`;
  }

  /** Compact week summary: one line per distinct span, days grouped. */
  function weekLabel(hours) {
    const parts = [];
    for (const h of hours || []) {
      const s = span(h);
      const day = (h.weekday || '').slice(0, 3);
      parts.push(s ? `${day} ${fmt12(s.open)}–${fmt12(s.close)}` : `${day} closed`);
    }
    return parts;
  }

  /** How many of a list of venues are open right now. */
  function openCount(venues, now = new Date()) {
    return (venues || []).filter(v => libraryStatus(v.hours, now).open).length;
  }

  const api = { fmt12, span, libraryStatus, isLate, statusLabel, weekLabel, openCount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LibraryLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
