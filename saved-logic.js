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
        where.get(r).push({ hall: data.halls[hi].name, hallIdx: hi, dayIdx: di, mealIdx: mi });
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

  /* ---- calendar export ------------------------------------------------------
   * 73% of the week's dishes are served on exactly one day (measured 10-24 over the
   * published week), so a saved dish is usually one chance; a calendar alert reaches
   * you without opening the site. One event per (hall, day, meal) slot, naming every
   * saved dish served then, so three saved dishes at one dinner are one alert not three.
   * Staples (MANY_DAYS or more) are left out: a daily event is noise, not a reminder.
   */
  const pad = n => String(n).padStart(2, '0');
  const hmParts = s => s.split(':').map(Number);

  /** [{dayIdx, mealIdx, hallIdx, hall, dishes:[name], start:[h,m]|null, end:[h,m]|null}] */
  function calendarSlots(dishIdxs, index, data, now = new Date()) {
    const slots = new Map(), skipped = [];
    for (const di of dishIdxs) {
      const r = servingsFor(di, index, data, now);
      const name = data.dishes[di].n;
      if (r.everyday) { skipped.push(name); continue; }
      for (const s of r.upcoming) {
        const key = `${s.hallIdx}|${s.dayIdx}|${s.mealIdx}`;
        if (!slots.has(key)) slots.set(key, { ...s, dishes: [] });
        const e = slots.get(key);
        if (!e.dishes.includes(name)) e.dishes.push(name);
      }
    }
    const out = [...slots.values()].sort((a, b) =>
      a.dayIdx - b.dayIdx || a.mealIdx - b.mealIdx || a.hall.localeCompare(b.hall));
    for (const e of out) {
      const [m, d, y] = data.days[e.dayIdx].split('/').map(Number);
      const dow = new Date(y, m - 1, d).getDay();
      const hours = (data.halls[e.hallIdx] || {}).hours || {};
      const w = (hours[(dow === 0 || dow === 6) ? 'weekend' : 'weekday'] || {})[data.meals[e.mealIdx]];
      e.ymd = `${y}${pad(m)}${pad(d)}`;
      // No listed window (e.g. a weekend breakfast menu where the hours page lists only
      // brunch): an all-day event, said plainly, rather than an invented time.
      e.start = w ? hmParts(w[0]) : null;
      e.end = w ? hmParts(w[1]) : null;
      // isUpcoming holds dinner until midnight (right for "next serving"), but an event
      // for a window that has already closed today is a reminder for nothing.
      const sameDay = y === now.getFullYear() && m - 1 === now.getMonth() && d === now.getDate();
      e.over = sameDay && !!e.end && e.end[0] * 60 + e.end[1] <= now.getHours() * 60 + now.getMinutes();
    }
    return { slots: out.filter(e => !e.over), skipped };
  }

  const esc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;')
    .replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  /** RFC 5545 3.1: lines over 75 octets fold with CRLF + space; never split a UTF-8 char. */
  function fold(line) {
    const enc = new TextEncoder(), parts = [];
    let cur = '', n = 0;
    for (const ch of line) {
      const b = enc.encode(ch).length;
      if (n + b > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; n = 0; }
      cur += ch; n += b;
    }
    parts.push(cur);
    return parts.join('\r\n ');
  }

  // Campus time, with its DST rules, so a phone in another zone still alerts at 11:00 PT.
  const VTZ = ['BEGIN:VTIMEZONE', 'TZID:America/Los_Angeles',
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0800', 'TZOFFSETTO:-0700', 'TZNAME:PDT',
    'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:-0700', 'TZOFFSETTO:-0800', 'TZNAME:PST',
    'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
    'END:VTIMEZONE'];

  /** The .ics text for calendarSlots(...).slots. `stamp` is a Date (DTSTAMP, UTC). */
  function toICS(slots, data, stamp = new Date()) {
    const z = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//stanford-dining-menus//saved//EN',
      'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...VTZ];
    for (const e of slots) {
      const meal = data.meals[e.mealIdx];
      const what = e.dishes.length === 1 ? e.dishes[0] : `${e.dishes.length} saved dishes`;
      L.push('BEGIN:VEVENT',
        // Stable per slot, so re-importing updates the event instead of duplicating it.
        `UID:${e.ymd}-${meal.toLowerCase()}-${data.halls[e.hallIdx].id || e.hallIdx}@stanford-dining-menus`,
        `DTSTAMP:${z}`);
      if (e.start) {
        L.push(`DTSTART;TZID=America/Los_Angeles:${e.ymd}T${pad(e.start[0])}${pad(e.start[1])}00`,
               `DTEND;TZID=America/Los_Angeles:${e.ymd}T${pad(e.end[0])}${pad(e.end[1])}00`);
      } else {
        const [y, m, d] = [+e.ymd.slice(0, 4), +e.ymd.slice(4, 6), +e.ymd.slice(6)];
        const nx = new Date(Date.UTC(y, m - 1, d + 1));
        L.push(`DTSTART;VALUE=DATE:${e.ymd}`,
               `DTEND;VALUE=DATE:${nx.getUTCFullYear()}${pad(nx.getUTCMonth() + 1)}${pad(nx.getUTCDate())}`);
      }
      const desc = `${meal} at ${e.hall}: ${e.dishes.join(', ')}.` +
        (e.start ? '' : ' Serving hours not listed for this meal; check the hall.') +
        ' Menus change; check the site before you go.';
      L.push(`SUMMARY:${esc(`${what} — ${meal.toLowerCase()} at ${e.hall}`)}`,
        `LOCATION:${esc(data.halls[e.hallIdx].concept || e.hall)}`,
        `DESCRIPTION:${esc(desc)}`);
      if (e.start) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT30M',
        `DESCRIPTION:${esc(what)}`, 'END:VALARM');
      L.push('END:VEVENT');
    }
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }

  /* ---- last served ---------------------------------------------------------
   * The week's payload forgets a dish the day it scrolls out, and 44% of archived dishes
   * (260/592, measured 10-24) were served in the past week but not in the week ahead —
   * exactly the saved dishes this view otherwise says nothing useful about. history.json
   * (archive.py index) remembers them. It also holds days ahead of its build, so only
   * days strictly before `today` count: a stale index must not call next week "last".
   */
  /** 'YYYY-MM-DD' for the calendar day of `now` (campus time is the caller's job). */
  const ymd = now => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  /** -> {date:'YYYY-MM-DD', daysAgo, meal, halls:[name]} or null. */
  function lastServed(name, hist, data, now = new Date()) {
    const rows = hist && hist.dishes && hist.dishes[name];
    if (!rows) return null;
    const today = ymd(now);
    const past = rows.filter(r => r[0] < today);
    if (!past.length) return null;
    const date = past.reduce((a, r) => r[0] > a ? r[0] : a, '');
    const on = past.filter(r => r[0] === date);
    const names = new Map((data && data.halls || []).map(h => [h.id, h.name]));
    const halls = [...new Set(on.map(r => {
      const id = hist.halls[r[1]];
      return names.get(id) || id;
    }))].sort();
    const [y, m, d] = date.split('-').map(Number);
    const daysAgo = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate())
      - new Date(y, m - 1, d)) / 86400000);
    return { date, daysAgo, meal: hist.meals[on[0][2]], halls };
  }

  /** "Last served Wed 10/22 at Branner, Stern (2 days ago)" — the line the view shows. */
  function lastServedText(r) {
    if (!r) return '';
    const [y, m, d] = r.date.split('-').map(Number);
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(y, m - 1, d).getDay()];
    const where = r.halls.length > 2 ? `${r.halls.slice(0, 2).join(', ')} +${r.halls.length - 2}`
      : r.halls.join(' & ');
    const ago = r.daysAgo === 1 ? 'yesterday' : `${r.daysAgo} days ago`;
    return `Last served ${dow} ${m}/${d} at ${where} (${ago}).`;
  }

  /**
   * The meal the page should open on: the one some hall is serving right now, else the
   * next one any hall starts today, else the day's last (after dinner you still want to
   * see what dinner was). Read from the hours, not a fixed clock: R&DE serves weekend
   * brunch under "Lunch" from 9:30, and a fixed "Breakfast before 10:30" opened every
   * Saturday and Sunday morning on eight "no breakfast service" cards while brunch was
   * already open. Falls back to that old clock rule only when no hall lists hours.
   * @param halls  site payload halls, each with optional hours.{weekday,weekend}
   * @param now    a Date already in campus time
   * @returns a meal name from `meals`
   */
  function defaultMeal(meals, halls, now) {
    const hm = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const mins = now.getHours() * 60 + now.getMinutes();
    const wk = (now.getDay() === 0 || now.getDay() === 6) ? 'weekend' : 'weekday';
    let current = -1, next = -1, last = -1;
    meals.forEach((name, mi) => {
      for (const h of halls) {
        const w = ((h.hours || {})[wk] || {})[name];
        if (!w) continue;
        const [a, b] = [hm(w[0]), hm(w[1])];
        if (b < a) continue;                       // overnight window: not a meal slot
        if (mins >= a && mins <= b && current === -1) current = mi;
        if (mins < a && (next === -1 || a < next.start)) next = { mi, start: a };
        if (last === -1 || b > last.end) last = { mi, end: b };
      }
    });
    if (current !== -1) return meals[current];
    if (next !== -1) return meals[next.mi];
    if (last !== -1) return meals[last.mi];
    const h = mins / 60;
    return h < 10.5 ? 'Breakfast' : h < 16 ? 'Lunch' : 'Dinner';
  }

  const api = { defaultMeal, lastServed, lastServedText, buildIndex, isUpcoming, servingsFor, calendarSlots, toICS, fold, MANY_DAYS, MAX_SHOWN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SavedLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
