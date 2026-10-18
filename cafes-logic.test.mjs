/* Tests for café open/closed reasoning. Run: node cafes-logic.test.mjs
 * The point is the midnight-crossing and day-boundary cases, which a glance at the
 * page can never exercise.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const L = require('./cafes-logic.js');
import fs from 'fs';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  — ' + detail : ''}`); }
};
// 2026-10-19 is a Monday. Local time, matching how the page reads the clock.
const at = (day, h, m = 0) => new Date(2026, 9, 18 + day, h, m);

console.log('\n1. day index conversion (scraper is Mon=0, JS is Sun=0)');
check('Sunday  js 0 -> 6', L.jsDayToIdx(0) === 6);
check('Monday  js 1 -> 0', L.jsDayToIdx(1) === 0);
check('Saturday js 6 -> 5', L.jsDayToIdx(6) === 5);

console.log('\n2. a plain daytime window, Mon–Fri 07:00–15:00');
{
  const w = [{ days: [0,1,2,3,4], open: '07:00', close: '15:00', overnight: false }];
  check('Monday 09:00 open',      L.venueStatus(w, at(1, 9)).open === true);
  check('Monday 06:00 closed',    L.venueStatus(w, at(1, 6)).open === false);
  check('Monday 06:00 says 7am',  L.venueStatus(w, at(1, 6)).opensAt === '7am');
  check('Monday 16:00 closed',    L.venueStatus(w, at(1, 16)).open === false);
  check('Saturday 09:00 closed',  L.venueStatus(w, at(6, 9)).open === false, 'weekday-only');
}

console.log('\n3. overnight window — Axe & Palm, Mon–Fri 11:00–02:00');
{
  const w = [{ days: [0,1,2,3,4], open: '11:00', close: '02:00', overnight: true }];
  check('Monday 12:00 open',        L.venueStatus(w, at(1, 12)).open === true);
  check('Monday 23:30 open',        L.venueStatus(w, at(1, 23, 30)).open === true);
  check('Tuesday 00:30 open (carried from Monday)',
                                    L.venueStatus(w, at(2, 0, 30)).open === true);
  check('Tuesday 03:00 closed',     L.venueStatus(w, at(2, 3)).open === false);
  check('Saturday 00:30 open (carried from Friday)',
                                    L.venueStatus(w, at(6, 0, 30)).open === true);
  check('Sunday 00:30 CLOSED (Saturday is not in the band)',
                                    L.venueStatus(w, at(7, 0, 30)).open === false);
  check('reports closing time',     L.venueStatus(w, at(1, 12)).until === '2am');
}

console.log('\n4. EVGR Pub — Thu–Sat 17:00–00:00');
{
  const w = [{ days: [3,4,5], open: '17:00', close: '00:00', overnight: true }];
  check('Thursday 18:00 open',  L.venueStatus(w, at(4, 18)).open === true);
  check('Wednesday 18:00 closed', L.venueStatus(w, at(3, 18)).open === false);
}

console.log('\n5. labels');
check('contiguous run collapses', L.daysLabel([0,1,2,3,4]) === 'Mon–Fri', L.daysLabel([0,1,2,3,4]));
check('all seven',               L.daysLabel([0,1,2,3,4,5,6]) === 'Every day');
check('scattered days listed',   L.daysLabel([0,3]) === 'Mon Thu', L.daysLabel([0,3]));
check('noon is 12pm not 0pm',    L.fmt12('12:00') === '12pm', L.fmt12('12:00'));
check('midnight is 12am',        L.fmt12('00:00') === '12am', L.fmt12('00:00'));

console.log('\n6. against the real scraped data');
{
  const d = JSON.parse(fs.readFileSync('./data/cafes.json', 'utf8'));
  check('every venue has windows or verbatim text',
    d.venues.every(v => (v.windows && v.windows.length) || (v.hours_text && v.hours_text.length)));
  check('every window has a valid day index',
    d.venues.every(v => v.windows.every(w => w.days.every(x => x >= 0 && x <= 6))));
  const late = d.venues.filter(v => v.windows.some(L.isLate)).map(v => v.name);
  check('late-night venues detected', late.length >= 2, late.join(', '));
  console.log(`       late: ${late.join(', ')}`);
  // no venue should ever be open at 4am
  const fourAm = d.venues.filter(v => L.venueStatus(v.windows, at(3, 4)).open).map(v => v.name);
  check('nothing open at 4am Wednesday', fourAm.length === 0, fourAm.join(', '));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
