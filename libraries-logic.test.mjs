/* Tests for library open/closed reasoning. Run: node libraries-logic.test.mjs
 *
 * The cases worth having are the ones a glance at the page cannot reach: a record
 * that omits its time keys because it is closed, a window that closes at midnight,
 * and the all-night study room that opens 23:55 and shuts at 08:00 the next morning.
 *
 * TZ is pinned. This machine runs America/Monterrey, one hour off Pacific, so without
 * the pin every formatted label here would be wrong by an hour and the tests would
 * encode the developer's timezone rather than the reader's. Set before any Date is
 * constructed; ESM hoists the imports above it, but neither import builds a Date.
 */
process.env.TZ = 'America/Los_Angeles';

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// Resolve from this file, not the shell's cwd — the publish pipeline runs it from the
// project root, where a cwd-dependent path passes locally and fails there.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(HERE, 'libraries-logic.js'));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  — ' + detail : ''}`); }
};

/** An instant in Pacific time, written the way the source writes them. */
const pt = (iso) => new Date(iso + '-07:00');
const rec = (day, weekday, open, close) =>
  ({ day, weekday, closed: false, opens_at: `${day}T${open}:00.000-07:00`,
     closes_at: `${close.length > 5 ? close : day + 'T' + close + ':00.000'}-07:00` });
/** A closed day exactly as the API emits it: no time keys whatsoever. */
const shut = (day, weekday) => ({ day, weekday, closed: true });

console.log('\n1. a closed record omits its time keys — the shape that breaks naive parsers');
{
  check('span(closed) is null', L.span(shut('2026-10-18', 'Sunday')) === null);
  check('span(undefined) is null', L.span(undefined) === null);
  check('span({}) is null', L.span({}) === null);
  check('closed:false but no times is still null',
    L.span({ day: '2026-10-18', weekday: 'Sunday', closed: false }) === null);
  check('no throw on an all-closed week',
    L.libraryStatus([shut('2026-10-18', 'Sunday')], pt('2026-10-18T12:00')).neverThisWeek === true);
}

console.log('\n2. a plain daytime window — Business Library, Mon–Fri 09:00–17:00');
{
  const h = [shut('2026-10-18', 'Sunday'), rec('2026-10-19', 'Monday', '09:00', '17:00')];
  check('Monday 10:00 open', L.libraryStatus(h, pt('2026-10-19T10:00')).open === true);
  check('Monday 10:00 until 5pm', L.libraryStatus(h, pt('2026-10-19T10:00')).until === '5pm');
  check('Monday 08:00 closed', L.libraryStatus(h, pt('2026-10-19T08:00')).open === false);
  check('Monday 08:00 opens 9am', L.libraryStatus(h, pt('2026-10-19T08:00')).opensAt === '9am');
  check('Monday 18:00 closed', L.libraryStatus(h, pt('2026-10-19T18:00')).open === false);
  check('exactly at open is open', L.libraryStatus(h, pt('2026-10-19T09:00')).open === true);
  check('exactly at close is closed', L.libraryStatus(h, pt('2026-10-19T17:00')).open === false,
    'a venue shutting at 5pm is not open at 5pm');
}

console.log('\n3. closing at midnight — Green, Monday 08:00 to Tuesday 00:00');
{
  const h = [rec('2026-10-19', 'Monday', '08:00', '2026-10-20T00:00')];
  check('Monday 23:30 open', L.libraryStatus(h, pt('2026-10-19T23:30')).open === true);
  check('Monday 23:30 until 12am', L.libraryStatus(h, pt('2026-10-19T23:30')).until === '12am');
  check('Tuesday 00:30 closed', L.libraryStatus(h, pt('2026-10-20T00:30')).open === false);
  check('counts as late', L.isLate(h) === true);
}

console.log('\n4. the all-night room — Green East, 23:55 Monday to 08:00 Tuesday');
{
  // This is the case cafes-logic.js needs an explicit `overnight` flag for. Here the
  // record already names the day it closes on, so nothing special happens.
  const h = [rec('2026-10-19', 'Monday', '23:55', '2026-10-20T08:00')];
  check('Monday 23:58 open', L.libraryStatus(h, pt('2026-10-19T23:58')).open === true);
  check('Tuesday 03:00 open', L.libraryStatus(h, pt('2026-10-20T03:00')).open === true,
    'the small hours carried over, with no overnight branch');
  check('Tuesday 03:00 until 8am', L.libraryStatus(h, pt('2026-10-20T03:00')).until === '8am');
  check('Tuesday 09:00 closed', L.libraryStatus(h, pt('2026-10-20T09:00')).open === false);
  check('Monday 12:00 closed', L.libraryStatus(h, pt('2026-10-19T12:00')).open === false);
  check('Monday 12:00 opens 11:55pm',
    L.libraryStatus(h, pt('2026-10-19T12:00')).opensAt === '11:55pm');
}

console.log('\n5. the next opening can be days away — a weekend-shut library');
{
  const h = [rec('2026-10-23', 'Friday', '09:00', '17:00'),
             shut('2026-10-24', 'Saturday'), shut('2026-10-25', 'Sunday'),
             rec('2026-10-26', 'Monday', '09:00', '17:00')];
  const st = L.libraryStatus(h, pt('2026-10-24T14:00'));
  check('Saturday afternoon closed', st.open === false);
  check('names Monday as the next day', st.opensDay === 'Monday');
  check('picks the soonest, not the first listed', st.opensAt === '9am');
  check('label names the weekday when far off',
    L.statusLabel(st) === 'Opens Monday 9am', L.statusLabel(st));
  const soon = L.libraryStatus(h, pt('2026-10-23T07:00'));
  check('label omits the weekday when within the day',
    L.statusLabel(soon) === 'Opens 9am', L.statusLabel(soon));
}

console.log('\n6. defensive — a record whose close is not after its open');
{
  check('close == open rejected',
    L.span(rec('2026-10-19', 'Monday', '09:00', '09:00')) === null);
  check('close before open rejected',
    L.span(rec('2026-10-19', 'Monday', '17:00', '09:00')) === null);
  check('unparseable date rejected',
    L.span({ closed: false, opens_at: 'not-a-date', closes_at: 'also-not' }) === null);
}

console.log('\n7. labels and counts');
{
  const open = [rec('2026-10-19', 'Monday', '08:00', '2026-10-20T00:00')];
  check('open label', L.statusLabel(L.libraryStatus(open, pt('2026-10-19T10:00')))
    === 'Open until 12am');
  check('closed-all-week label',
    L.statusLabel({ open: false, neverThisWeek: true }) === 'Closed this week');
  check('empty status label is blank', L.statusLabel(null) === '');
  check('not late when it shuts at 17:00',
    L.isLate([rec('2026-10-19', 'Monday', '09:00', '17:00')]) === false);
  check('isLate survives an all-closed week', L.isLate([shut('2026-10-18', 'Sunday')]) === false);
  const venues = [{ hours: open }, { hours: [shut('2026-10-19', 'Monday')] }];
  check('openCount counts only the open', L.openCount(venues, pt('2026-10-19T10:00')) === 1);
  check('openCount on empty input is 0', L.openCount(null, pt('2026-10-19T10:00')) === 0);
  check('weekLabel marks a closed day',
    L.weekLabel([shut('2026-10-18', 'Sunday')])[0] === 'Sun closed');
}

console.log('\n8. against the real scraped payload, not a fabrication');
{
  const p = path.join(HERE, 'data/libraries.json');
  if (!fs.existsSync(p)) {
    check('data/libraries.json present', false, 'run `python3 scrape_libraries.py` first');
  } else {
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    check('24 libraries', d.venues.length === 24, `got ${d.venues.length}`);
    check('every venue has 7 day records',
      d.venues.every(v => v.hours.length === 7));
    check('no venue record carries times while closed',
      d.venues.every(v => v.hours.every(h => !h.closed || (!h.opens_at && !h.closes_at))));
    // The whole point of the probe: every one of these must evaluate without throwing.
    let threw = null;
    for (const v of d.venues) {
      for (const hhmm of ['2026-10-19T03:00', '2026-10-19T10:00', '2026-10-19T23:59']) {
        try { L.libraryStatus(v.hours, pt(hhmm)); L.statusLabel(L.libraryStatus(v.hours, pt(hhmm))); }
        catch (e) { threw = `${v.id} @ ${hhmm}: ${e.message}`; }
      }
    }
    check('no venue throws at 03:00, 10:00 or 23:59', threw === null, threw || '');
    const slac = d.venues.find(v => v.id === 'slac');
    check('slac is closed all week',
      slac && L.libraryStatus(slac.hours, pt('2026-10-19T10:00')).neverThisWeek === true);
    check('slac sorts last, after the open libraries',
      d.venues[d.venues.length - 1].id === 'slac');
    const green = d.venues.find(v => v.id === 'green');
    check('green exists with sub-locations', green && green.locations.length > 0);
    const night = green.locations.find(s => /after hours|all.night/i.test(s.name + s.id));
    check('green carries the after-hours study room', !!night, green.locations.map(s => s.id).join());
    if (night) {
      // 03:00 on a Tuesday is precisely when this matters and the main desk is shut.
      const nightSt = L.libraryStatus(night.hours, pt('2026-10-20T03:00'));
      const deskSt = L.libraryStatus(green.hours, pt('2026-10-20T03:00'));
      check('after-hours room open at 3am Tuesday', nightSt.open === true,
        JSON.stringify(nightSt));
      check('while the main desk is shut', deskSt.open === false);
    }
    check('every sub-location opens at some point',
      d.venues.every(v => v.locations.every(s => s.hours.some(h => !h.closed))));
  }
}

// Labels are campus time even when the reader's clock is not (the pin above hid this:
// fmt12 used to format in the reader's zone, so a Monterrey reader saw "Opens 9am").
{
  process.env.TZ = 'America/Monterrey';
  check('fmt12 is campus time under Monterrey', L.fmt12(new Date('2026-10-19T08:00:00.000-07:00')) === '8am',
    L.fmt12(new Date('2026-10-19T08:00:00.000-07:00')));
  check('isLate is campus time under Monterrey (closes 20:30 PT = 21:30 CST)',
    L.isLate([rec('2026-10-19', 'Monday', '09:00', '20:30')]) === false);
  process.env.TZ = 'America/Los_Angeles';
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
