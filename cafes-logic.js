/* cafes-logic.js — pure open/closed reasoning for café hours.
 *
 * Separated from the page for the same reason park-finder's detector is: the risky
 * parts here are a day-index conversion and windows that cross midnight, and neither
 * can be exercised by looking at the page on a Tuesday afternoon. As a module it can
 * be driven with a fabricated clock from node.
 *
 * Day indices: the scraper writes 0=Monday..6=Sunday (R&DE lists weeks Monday-first);
 * JavaScript's getDay() is 0=Sunday. The conversion lives in exactly one named place.
 */
(function (root) {
  const DOW_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const jsDayToIdx = d => (d + 6) % 7;
  const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

  function fmt12(t) {
    const m = toMin(t), mm = m % 60;
    return `${Math.floor(m / 60) % 12 || 12}${mm ? ':' + String(mm).padStart(2, '0') : ''}`
      + (m >= 720 ? 'pm' : 'am');
  }

  function daysLabel(days) {
    if (days.length === 7) return 'Every day';
    const s = [...days].sort((a, b) => a - b);
    const contiguous = s.every((d, i) => i === 0 || d === s[i - 1] + 1);
    if (contiguous && s.length > 2) return `${DOW_SHORT[s[0]]}–${DOW_SHORT[s.at(-1)]}`;
    return s.map(d => DOW_SHORT[d]).join(' ');
  }

  /** A window closing at or after 21:00, or crossing midnight, counts as late. */
  const isLate = w => w.overnight || toMin(w.close) >= 21 * 60;

  /**
   * @param {Array} windows  [{days:[0..6], open:'HH:MM', close:'HH:MM', overnight:bool}]
   * @param {Date}  now      injectable so tests can fabricate a clock
   */
  function venueStatus(windows, now = new Date()) {
    const today = jsDayToIdx(now.getDay());
    const yesterday = (today + 6) % 7;
    const mins = now.getHours() * 60 + now.getMinutes();
    let soonest = null;

    for (const w of windows || []) {
      const o = toMin(w.open), c = toMin(w.close);
      if (w.overnight) {
        // 11:00-02:00 on Mon-Fri means Monday 11am through Tuesday 2am. Both halves
        // must be checked: the evening side today, and the small hours carried over
        // from yesterday's window.
        if (w.days.includes(today) && mins >= o) return { open: true, until: fmt12(w.close) };
        if (w.days.includes(yesterday) && mins < c) return { open: true, until: fmt12(w.close) };
      } else if (w.days.includes(today) && mins >= o && mins <= c) {
        return { open: true, until: fmt12(w.close) };
      }
      if (w.days.includes(today) && mins < o && (soonest === null || o < soonest)) soonest = o;
    }
    if (soonest !== null) {
      const hh = String(Math.floor(soonest / 60)).padStart(2, '0');
      return { open: false, opensAt: fmt12(`${hh}:${String(soonest % 60).padStart(2, '0')}`) };
    }
    return { open: false };
  }

  const api = { jsDayToIdx, toMin, fmt12, daysLabel, isLate, venueStatus, DOW_SHORT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CafeLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
