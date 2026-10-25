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

  /**
   * The campus wall clock, as a Date whose LOCAL fields (getHours, getDay, getDate) read
   * Stanford time whatever the viewer's timezone. Every hours source here is campus
   * wall-clock text, so "now" must be too: on a laptop set to America/Monterrey the
   * browser's own clock made some venue's open/closed answer wrong 66% of a PDT week
   * and 85% of a PST one (projects/campus-clock/measure.mjs). Only for field reads and
   * comparisons against wall-clock windows; the result is not the true instant.
   */
  const CAMPUS_TZ = 'America/Los_Angeles';
  const campusFmt = new Intl.DateTimeFormat('en-US', { timeZone: CAMPUS_TZ, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  function campusDate(d = new Date()) {
    const p = {};
    for (const x of campusFmt.formatToParts(d)) p[x.type] = +x.value;
    return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  }
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
   * @param {Date}  now      campus wall clock (campusDate); injectable so tests can fabricate one
   */
  function venueStatus(windows, now = campusDate()) {
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
      } else if (w.days.includes(today) && mins >= o && mins < c) {
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

  /**
   * One key per venue across R&DE's pages, which name the same place differently:
   * "The Axe & Palm (TAP)" / "The Axe & Palm at Old Union*", "Olives at Bldg. 160" /
   * "Olives @ Bldg. 160", "The Med Café" / "Med Café". Exact keys only: a prefix match
   * would make "Decadence" swallow "Decadence Mini Market".
   */
  const KEY_ALIAS = { cardinalcaferedwoodcity: 'cardinalcafe' };
  function payKey(name) {
    const k = String(name).normalize('NFKD').replace(/[̀-ͯ​﻿]/g, '')
      .toLowerCase().replace(/\(.*?\)/g, ' ').replace(/@/g, ' at ')
      .replace(/\bat old union\b/g, ' ').replace(/^\s*the\s+/, '').replace(/[^a-z0-9]/g, '');
    return KEY_ALIAS[k] || k;
  }

  /**
   * Cafés page venues + pay.json -> one list, each row with `pay` ({cd, mpd, cashback})
   * when R&DE's accepts table names it, or `pay: null` when it does not — which on that
   * table means "not a location accepting either", so filters treat it as no. Venues with
   * hours only on the Tresidder/Markets pages are appended; accepts rows with no hours
   * anywhere (UMe Tea, the late-night halls) are appended with empty windows, so a
   * "takes Meal Plan $" list is complete even where it cannot say open or closed.
   */
  function mergePay(cafeVenues, pay) {
    const acc = new Map(((pay && pay.accepts) || []).map(a => [payKey(a.name), a]));
    const out = [], seen = new Set();
    const add = v => {
      const k = payKey(v.name);
      if (seen.has(k)) return;
      seen.add(k);
      const a = acc.get(k);
      out.push({ ...v, windows: v.windows || [], hours_text: v.hours_text || [],
                 pay: a ? { cd: !!a.cd, mpd: !!a.mpd, cashback: !!a.cashback } : null });
    };
    (cafeVenues || []).forEach(add);
    ((pay && pay.venues) || []).forEach(add);
    for (const a of acc.values()) add({ name: a.name.replace(/\*+$/, '').trim(), description: '' });
    return out;
  }

  const api = { jsDayToIdx, campusDate, CAMPUS_TZ, toMin, fmt12, daysLabel, isLate, venueStatus, DOW_SHORT,
                payKey, mergePay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CafeLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
