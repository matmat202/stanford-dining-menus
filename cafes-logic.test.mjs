/* Tests for café open/closed reasoning. Run: node cafes-logic.test.mjs
 * The point is the midnight-crossing and day-boundary cases, which a glance at the
 * page can never exercise.
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// Resolve from this file, not the shell's cwd: the publish pipeline runs it from the
// project root and a cwd-dependent test fails there while passing locally.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(HERE, 'cafes-logic.js'));

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
  const d = JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'cafes.json'), 'utf8'));
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

// campusDate: the page's clock is Stanford's whatever the viewer's timezone. Run with
// the viewer on this machine's own zone, an hour ahead of PDT and two ahead of PST.
{
  const prev = process.env.TZ;
  for (const tz of ['America/Monterrey', 'America/New_York', 'Asia/Tokyo', 'America/Los_Angeles']) {
    process.env.TZ = tz;
    const pdt = L.campusDate(new Date('2026-10-21T03:30:00Z'));   // Tue 20:30 PDT
    check(`campusDate PDT under ${tz}`, pdt.getDay() === 2 && pdt.getDate() === 20
      && pdt.getHours() === 20 && pdt.getMinutes() === 30, pdt.toString());
    const pst = L.campusDate(new Date('2026-11-03T07:59:00Z'));   // Mon 23:59 PST
    check(`campusDate PST under ${tz}`, pst.getDay() === 1 && pst.getDate() === 2
      && pst.getHours() === 23 && pst.getMinutes() === 59, pst.toString());
    // Arrillaga-shaped dinner 17:00-20:30: open at 20:15 campus time, which a Monterrey
    // browser clock reads as 21:15 and called closed.
    const w = [{ days: [0, 1, 2, 3, 4], open: '17:00', close: '20:30', overnight: false }];
    check(`venueStatus on the campus clock under ${tz}`,
      L.venueStatus(w, L.campusDate(new Date('2026-10-21T03:15:00Z'))).open === true);
  }
  process.env.TZ = prev; if (prev === undefined) delete process.env.TZ;
}

// Cases found by bin/mutate (projects/mutation-audit): each one kills a planted bug the
// suite above let through.
console.log('\n7. boundaries the earlier cases never touched (bin/mutate survivors)');
{
  const w = [{ days: [0,1,2,3,4], open: '07:00', close: '15:00', overnight: false }];
  check('exactly at open is open',   L.venueStatus(w, at(1, 7)).open === true);
  check('exactly at close is closed', L.venueStatus(w, at(1, 15)).open === false,
    'same rule as libraries-logic: a venue shutting at 3pm is not open at 3pm');
  check('15:10 is closed (minutes count, not just hours)',
    L.venueStatus(w, at(1, 15, 10)).open === false);
  const ov = [{ days: [0,1,2,3,4], open: '11:00', close: '02:00', overnight: true }];
  check('overnight: exactly at open is open', L.venueStatus(ov, at(1, 11)).open === true);
  check('overnight: exactly at close is closed', L.venueStatus(ov, at(2, 2)).open === false);
  // Two windows today, listed late-first: the soonest one must win.
  const two = [{ days: [0], open: '17:00', close: '20:00', overnight: false },
               { days: [0], open: '07:30', close: '10:00', overnight: false }];
  check('soonest of two later windows, out of order', L.venueStatus(two, at(1, 6)).opensAt === '7:30am',
    L.venueStatus(two, at(1, 6)).opensAt);
  check('between windows, the evening one is next', L.venueStatus(two, at(1, 12)).opensAt === '5pm',
    L.venueStatus(two, at(1, 12)).opensAt);
  check('a window that has already closed is not "next"', L.venueStatus(two, at(1, 21)).opensAt === undefined);
  check('close at 21:00 counts as late', L.isLate({ close: '21:00', overnight: false }) === true);
  check('close at 20:59 is not late',     L.isLate({ close: '20:59', overnight: false }) === false);
  check('two contiguous days are listed, not ranged', L.daysLabel([0,1]) === 'Mon Tue', L.daysLabel([0,1]));
  check('three contiguous days are ranged', L.daysLabel([0,1,2]) === 'Mon–Wed', L.daysLabel([0,1,2]));
  check('three scattered days are listed', L.daysLabel([0,2,4]) === 'Mon Wed Fri', L.daysLabel([0,2,4]));
  check('unsorted input is sorted first', L.daysLabel([4,0,2,1,3]) === 'Mon–Fri', L.daysLabel([4,0,2,1,3]));
}

console.log('\n8. Meal Plan / Cardinal Dollars join (fixtures from 2026-10-25)');
// publish.sh copies the *.test.mjs files to the repo root, where backstop.sh runs them in
// CI without fixtures/. There the join section is skipped, and it says that it skipped.
if (!fs.existsSync(path.join(HERE, '../fixtures/pay-2026-10-25.json'))) {
  console.log('  skip (fixtures/ not present; this copy is the published one)');
} else {
  const cafes = JSON.parse(fs.readFileSync(path.join(HERE, '../fixtures/cafes-2026-10-25.json'), 'utf8'));
  const pay = JSON.parse(fs.readFileSync(path.join(HERE, '../fixtures/pay-2026-10-25.json'), 'utf8'));
  const rows = L.mergePay(cafes.venues, pay);
  const by = Object.fromEntries(rows.map(r => [r.name, r]));
  check('TAP (cafés page) joins "The Axe & Palm at Old Union*"', by['The Axe & Palm (TAP)']?.pay?.mpd === true);
  check('"Olives @ Bldg. 160" joins "Olives at Bldg. 160"', by['Olives at Bldg. 160']?.pay?.mpd === true);
  check('"Med Café" joins "The Med Café"', by['The Med Café']?.pay?.mpd === true);
  check('Redwood City Cardinal Café joins, Cardinal $ only', by['Cardinal Café']?.pay?.cd === true && by['Cardinal Café'].pay.mpd === false);
  check('Decadence and Decadence Mini Market stay two rows', !!by['Decadence'] && !!by['Decadence Mini Market']);
  check('every accepts row lands on exactly one venue', rows.filter(r => r.pay).length === pay.accepts.length,
    `${rows.filter(r => r.pay).length} vs ${pay.accepts.length}`);
  check('no venue appears twice', new Set(rows.map(r => L.payKey(r.name))).size === rows.length);
  check('Ray’s Grill, not in the table, has pay null', by['Ray’s Grill']?.pay === null);
  check('UMe Tea is listed with no hours rather than dropped', by['UMe Tea inside The AXe & Palm']?.windows.length === 0);
  check('11 venues take Meal Plan $', rows.filter(r => r.pay?.mpd).length === 11);
  // The 2025-11 ask: "where can I use my dining dollars on the weekends?" Saturday 8 pm.
  const satEve = at(6, 20);
  const open = rows.filter(r => r.pay?.mpd && L.venueStatus(r.windows, satEve).open).map(r => r.name).sort();
  check('Saturday 8pm: TAP, EVGR, Market at Munger take MP$ and are open',
    JSON.stringify(open) === JSON.stringify(['EVGR Pub & Brewery', 'The Axe & Palm (TAP)', 'The Market at Munger']),
    JSON.stringify(open));
  check('Saturday 10pm adds Arrillaga Nights', rows.filter(r => r.pay?.mpd && L.venueStatus(r.windows, at(6, 22)).open)
    .some(r => r.name === 'Arrillaga Nights @ AFDC'));
  check('no pay.json: every venue has pay null, list unchanged',
    L.mergePay(cafes.venues, null).every(r => r.pay === null) && L.mergePay(cafes.venues, null).length === cafes.venues.length);
}


console.log('\nlate-night hall service (halls.json latenight)');
{
  const AN = { label: 'Arrillaga Nights', days: 'Tue–Sat', hours: ['21:00', '02:00'] };
  const LN = { label: 'Late Night', days: 'Sun–Thu', hours: ['21:30', '02:00'] };
  check('Tue–Sat -> Mon=0 indices', JSON.stringify(L.rangeDays('Tue–Sat')) === '[1,2,3,4,5]');
  check('Sun–Thu wraps the week', JSON.stringify(L.rangeDays('Sun–Thu')) === '[6,0,1,2,3]');
  check('unreadable days -> null', L.rangeDays('weekends') === null && L.lateNow({ ...AN, days: '?' }, at(2, 22)) === null);
  const tue22 = L.lateNow(AN, at(2, 22));
  check('Tuesday 22:00: Arrillaga Nights open until 2am', tue22 && tue22.until === '2am' && tue22.label === 'Arrillaga Nights');
  check('Tuesday 20:59: not yet', L.lateNow(AN, at(2, 20, 59)) === null);
  check('Wednesday 00:30 carries Tuesday night', !!L.lateNow(AN, at(3, 0, 30)));
  check('Wednesday 02:00: over', L.lateNow(AN, at(3, 2)) === null);
  check('Monday 22:00: Arrillaga Nights does not run Mondays', L.lateNow(AN, at(1, 22)) === null);
  check('Tuesday 00:30 is Monday night: none', L.lateNow(AN, at(2, 0, 30)) === null);
  check('Sunday 21:45: Lakeside Late Night open', !!L.lateNow(LN, at(0, 21, 45)));
  check('Friday 22:00: Lakeside has none', L.lateNow(LN, at(5, 22)) === null);
  check('no latenight -> null', L.lateNow(undefined, at(2, 22)) === null);
}

// bin/mutate 2026-10-26 survivors.
console.log('\nedges: afternoon opening, Monday-bounded ranges, merged fields');
{
  check('opens at 17:00 says 5pm (hours read with /60, not near it)',
    L.venueStatus([{ days: [0], open: '17:00', close: '20:00' }], at(1, 12)).opensAt === '5pm',
    L.venueStatus([{ days: [0], open: '17:00', close: '20:00' }], at(1, 12)).opensAt);
  check('ranges starting or ending on Monday (index 0) read',
    JSON.stringify(L.rangeDays('Mon–Fri')) === '[0,1,2,3,4]' && JSON.stringify(L.rangeDays('Fri–Mon')) === '[4,5,6,0]');
  check('one unreadable end is enough to be unreadable', L.rangeDays('Foo–Fri') === null && L.rangeDays('Fri–Foo') === null);
  const m = L.mergePay([{ name: 'Coupa', windows: [], hours_text: ['Mon–Fri 7am–3pm'] }],
    { accepts: [{ name: 'Coupa', cd: 1, mpd: 0 }] });
  check('merge keeps hours_text and coerces pay flags to booleans',
    m[0] && JSON.stringify(m[0].hours_text) === '["Mon–Fri 7am–3pm"]' && JSON.stringify(m[0].pay) === '{"cd":true,"mpd":false,"cashback":false}',
    JSON.stringify(m[0]));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
