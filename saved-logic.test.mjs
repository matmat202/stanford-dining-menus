/* Tests for saved-dish time reasoning. Run: node saved-logic.test.mjs */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const S = require(path.join(HERE, 'saved-logic.js'));

let pass = 0, fail = 0;
const check = (n, c, d = '') => c ? (pass++, console.log(`  ok   ${n}`))
                                  : (fail++, console.log(`  FAIL ${n}${d ? '  — ' + d : ''}`));

const data = {
  halls: [{ name: 'Arrillaga' }, { name: 'Wilbur' }],
  days: ['10/17/2026', '10/18/2026', '10/19/2026'],
  meals: ['Breakfast', 'Lunch', 'Dinner'],
  menus: {
    '0|0|1': [7], '0|0|2': [7, 9],
    '0|1|1': [9], '1|1|2': [7],
    '0|2|0': [7], '1|2|2': [9],
  },
};
const idx = S.buildIndex(data);
const at = (dayOffset, h, m = 0) => new Date(2026, 9, 17 + dayOffset, h, m);

console.log('\n1. index inversion');
check('dish 7 found in 4 slots', (idx.get(7) || []).length === 4, String((idx.get(7)||[]).length));
check('dish 9 found in 3 slots', (idx.get(9) || []).length === 3);
check('unknown dish yields nothing', (idx.get(99) || []).length === 0);

console.log('\n2. same-day meal cutoffs (the off-by-one that would show a missed meal)');
{
  const lunchToday = { hall: 'Arrillaga', dayIdx: 0, mealIdx: 1 };
  check('lunch at 09:00 is upcoming',  S.isUpcoming(lunchToday, data, at(0, 9)) === true);
  check('lunch at 15:59 is upcoming',  S.isUpcoming(lunchToday, data, at(0, 15, 59)) === true);
  check('lunch at 16:30 is PAST',      S.isUpcoming(lunchToday, data, at(0, 16, 30)) === false);
  const bfastToday = { hall: 'Arrillaga', dayIdx: 2, mealIdx: 0 };
  check('breakfast at 08:00 is upcoming', S.isUpcoming(bfastToday, data, at(2, 8)) === true);
  check('breakfast at 11:00 is PAST',     S.isUpcoming(bfastToday, data, at(2, 11)) === false);
  const dinnerToday = { hall: 'Arrillaga', dayIdx: 0, mealIdx: 2 };
  check('dinner still upcoming at 19:00', S.isUpcoming(dinnerToday, data, at(0, 19)) === true);
}

console.log('\n3. past and future days');
{
  const slot = { hall: 'Wilbur', dayIdx: 1, mealIdx: 2 };
  check('tomorrow is upcoming',        S.isUpcoming(slot, data, at(0, 20)) === true);
  check('yesterday is not',           S.isUpcoming(slot, data, at(2, 8)) === false);
}

console.log('\n4. servingsFor ordering and capping');
{
  const r = S.servingsFor(7, idx, data, at(0, 8));
  check('all four servings counted',  r.total === 4, String(r.total));
  check('all still upcoming at 08:00 day 0', r.upcoming.length === 4, String(r.upcoming.length));
  check('sorted by day then meal',
    r.upcoming.every((s, i) => i === 0 ||
      s.dayIdx > r.upcoming[i-1].dayIdx ||
      (s.dayIdx === r.upcoming[i-1].dayIdx && s.mealIdx >= r.upcoming[i-1].mealIdx)));
  const later = S.servingsFor(7, idx, data, at(0, 17));
  check('after 16:00 today\'s lunch drops out', later.upcoming.length === 3,
    String(later.upcoming.length));
}

console.log('\n5. staple summarisation (the 94-serving problem)');
{
  const many = { ...data, menus: {} };
  // a dish on all three days, several meals each
  for (let d = 0; d < 3; d++) for (let m = 0; m < 3; m++) many.menus[`0|${d}|${m}`] = [1];
  const i2 = S.buildIndex(many);
  const r = S.servingsFor(1, i2, many, at(0, 6));
  check('counts every serving', r.total === 9, String(r.total));
  check('caps the shown list', r.shown.length === S.MAX_SHOWN, String(r.shown.length));
  check('reports the overflow', r.more === 9 - S.MAX_SHOWN, String(r.more));
  check('3 days is not yet "everyday"', r.everyday === false, `dayCount=${r.dayCount}`);
}

console.log('\n6. against the real payload');
{
  const real = JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'site.json'), 'utf8'));
  const ri = S.buildIndex(real);
  check('every dish index resolves', real.dishes.every((_, i) => ri.has(i)));
  const staples = real.dishes
    .map((d, i) => ({ n: d.n, r: S.servingsFor(i, ri, real, new Date(2026, 9, 17, 6)) }))
    .filter(x => x.r.everyday);
  check('staples detected and summarised', staples.length > 0, `${staples.length} dishes`);
  console.log(`       summarised as "most days": ${staples.length} of ${real.dishes.length}`);
  check('no serving list ever exceeds the cap',
    real.dishes.every((_, i) => S.servingsFor(i, ri, real).shown.length <= S.MAX_SHOWN));
}

// Cases found by bin/mutate (projects/mutation-audit).
console.log('\n7. exact cutoffs, real ordering, and the overflow floor (bin/mutate survivors)');
{
  const bfast = { hall: 'Arrillaga', dayIdx: 2, mealIdx: 0 };
  check('breakfast at 10:29 is upcoming', S.isUpcoming(bfast, data, at(2, 10, 29)) === true);
  check('breakfast at 10:30 is PAST',     S.isUpcoming(bfast, data, at(2, 10, 30)) === false);
  const lunch = { hall: 'Arrillaga', dayIdx: 0, mealIdx: 1 };
  check('lunch at 16:00 is PAST',         S.isUpcoming(lunch, data, at(0, 16)) === false);
  // Keys inserted newest-first, so the index comes out unsorted and only the sort
  // in servingsFor can put it right. The fixture above is already in order.
  const rev = { ...data, menus: { '0|2|2': [5], '0|1|0': [5], '0|1|2': [5], '0|0|1': [5] } };
  const r = S.servingsFor(5, S.buildIndex(rev), rev, at(0, 8));
  check('upcoming sorted by day then meal from unsorted input',
    r.upcoming.map(s => `${s.dayIdx}${s.mealIdx}`).join() === '01,10,12,22',
    r.upcoming.map(s => `${s.dayIdx}${s.mealIdx}`).join());
  check('no overflow when under the cap', r.more === 0, String(r.more));
  const days = n => { const d = { ...data, days: [], menus: {} };
    for (let i = 0; i < n; i++) { d.days.push(`10/${17 + i}/2026`); d.menus[`0|${i}|2`] = [3]; }
    return d; };
  const five = days(5), four = days(4);
  check('5 days is "everyday"', S.servingsFor(3, S.buildIndex(five), five, at(0, 6)).everyday === true);
  check('4 days is not', S.servingsFor(3, S.buildIndex(four), four, at(0, 6)).everyday === false);
}

console.log('\n8. calendar export (.ics)');
{
  const H = { weekday: { Breakfast: ['7:30', '10:00'], Lunch: ['11:00', '13:30'], Dinner: ['17:00', '20:00'] },
              weekend: { Lunch: ['10:30', '13:30'], Dinner: ['17:00', '20:00'] } };
  // 10/17/2026 is a Saturday, 10/19 a Monday.
  const cd = {
    halls: [{ id: 'Arr', name: 'Arrillaga', concept: 'Arrillaga Family Dining Commons', hours: H },
            { id: 'Wil', name: 'Wilbur', hours: H }],
    days: ['10/17/2026', '10/18/2026', '10/19/2026'],
    meals: ['Breakfast', 'Lunch', 'Dinner'],
    dishes: [{ n: 'Pho; Beef, Rare' }, { n: 'Crème brûlée' }, { n: 'Rice' }],
    menus: { '0|0|2': [0, 1], '0|0|0': [1], '1|2|1': [0], '0|2|1': [2] },
  };
  const ci = S.buildIndex(cd);
  const { slots, skipped } = S.calendarSlots([0, 1], ci, cd, at(0, 8));
  check('dishes at one hall+meal share one event', slots.length === 3, String(slots.length));
  const dinner = slots.find(e => e.dayIdx === 0 && e.mealIdx === 2);
  check('shared event names both dishes', dinner && dinner.dishes.length === 2);
  const wkBfast = slots.find(e => e.dayIdx === 0 && e.mealIdx === 0);
  check('weekend breakfast with no listed window is all-day, not invented', wkBfast && wkBfast.start === null);
  const mon = slots.find(e => e.dayIdx === 2);
  check('Monday lunch uses the weekday window', mon && mon.start.join(':') === '11:0' && mon.end.join(':') === '13:30');
  check('weekend dinner uses the weekend window', dinner.start.join(':') === '17:0');
  const late = S.calendarSlots([0, 1], ci, cd, at(0, 21)).slots;
  check('meals already past are left out', !late.some(e => e.dayIdx === 0), late.map(e => e.dayIdx).join());
  const st = { ...cd, days: ['10/19/2026','10/20/2026','10/21/2026','10/22/2026','10/23/2026'],
    menus: { '0|0|1': [2], '0|1|1': [2], '0|2|1': [2], '0|3|1': [2], '0|4|1': [2] } };
  const sr = S.calendarSlots([2], S.buildIndex(st), st, at(2, 6));
  check('staples are skipped and reported', sr.slots.length === 0 && sr.skipped[0] === 'Rice');

  const ics = S.toICS(slots, cd, new Date(Date.UTC(2026, 9, 17, 15, 4, 5)));
  const lines = ics.split('\r\n');
  check('CRLF line endings throughout', !/[^\r]\n/.test(ics) && ics.endsWith('\r\n'));
  const enc = new TextEncoder();
  check('no line over 75 octets', lines.every(l => enc.encode(l).length <= 75),
    String(Math.max(...lines.map(l => enc.encode(l).length))));
  const unfolded = ics.replace(/\r\n /g, '');
  check('folding never splits a character', unfolded.includes('Crème brûlée'));
  check('commas and semicolons escaped', unfolded.includes('Pho\; Beef\\, Rare'));
  check('timed event in campus zone', unfolded.includes('DTSTART;TZID=America/Los_Angeles:20261017T170000'));
  check('all-day event ends the next day', unfolded.includes('DTSTART;VALUE=DATE:20261017') &&
    unfolded.includes('DTEND;VALUE=DATE:20261018'));
  check('DTSTAMP is UTC', unfolded.includes('DTSTAMP:20261017T150405Z'));
  check('stable UID per slot', unfolded.includes('UID:20261017-dinner-Arr@stanford-dining-menus'));
  check('alarm only on timed events', (unfolded.match(/BEGIN:VALARM/g) || []).length === 2);
  const bal = k => (unfolded.match(new RegExp('BEGIN:' + k, 'g')) || []).length ===
                   (unfolded.match(new RegExp('END:' + k, 'g')) || []).length;
  check('BEGIN/END balanced', ['VCALENDAR', 'VEVENT', 'VALARM', 'VTIMEZONE'].every(bal));
  check('month rollover in all-day end', (() => {
    const o = { ...cd, days: ['10/31/2026'], menus: { '0|0|0': [1] } };   // Saturday breakfast
    const sl = S.calendarSlots([1], S.buildIndex(o), o, at(0, 0)).slots;
    return S.toICS(sl, o).includes('DTEND;VALUE=DATE:20261101');
  })());

  // Real payload: every saved-able dish exports to a well-formed file.
  const realP = path.join(HERE, 'data', 'site.json');
  if (fs.existsSync(realP)) {
    const real = JSON.parse(fs.readFileSync(realP, 'utf8'));
    const ri = S.buildIndex(real);
    const all = S.calendarSlots(real.dishes.map((_, i) => i), ri, real, new Date(2000, 0, 1));
    const rics = S.toICS(all.slots, real);
    check(`real week: ${all.slots.length} events, every line <= 75 octets`,
      rics.split('\r\n').every(l => enc.encode(l).length <= 75));
  }
}

console.log('\nN. last served (history.json)');
{
  const hist = { halls: ['Branner', 'FlorenceMoore', 'Stern'], meals: ['Breakfast', 'Lunch', 'Dinner'],
    dishes: {
      Pho: [['2026-10-29', 0, 2], ['2026-10-22', 2, 1], ['2026-10-22', 1, 1], ['2026-10-20', 0, 1]],
      Tacos: [['2026-10-24', 0, 1]],
    } };
  const site = { halls: [{ id: 'Branner', name: 'Branner' }, { id: 'FlorenceMoore', name: 'Florence Moore' },
                         { id: 'Stern', name: 'Stern' }] };
  const now = new Date(2026, 9, 24, 12, 0);            // Sat 10/24, noon
  const r = S.lastServed('Pho', hist, site, now);
  check('a day AHEAD of today is never "last" (stale index holds the week ahead)', r && r.date === '2026-10-22',
    JSON.stringify(r));
  check('every hall serving it that day, by display name', r && r.halls.join('|') === 'Florence Moore|Stern');
  check('days ago counted in calendar days', r && r.daysAgo === 2);
  check('today does not count as last served (it may still be ahead)', S.lastServed('Tacos', hist, site, now) === null);
  check('a dish the index never saw is null, not a crash', S.lastServed('Nope', hist, site, now) === null);
  check('no index at all is null', S.lastServed('Pho', null, site, now) === null);
  check('text: weekday, date, halls, age', S.lastServedText(r) === 'Last served Thu 10/22 at Florence Moore & Stern (2 days ago).',
    S.lastServedText(r));
  const many = { ...r, halls: ['A', 'B', 'C', 'D'], daysAgo: 1 };
  check('text: more than two halls folds to +N, one day says yesterday',
    S.lastServedText(many) === 'Last served Thu 10/22 at A, B +2 (yesterday).', S.lastServedText(many));
  check('text of null is empty', S.lastServedText(null) === '');

  // Real index, if built: every row points at a real hall and meal.
  const hp = path.join(HERE, 'data', 'history.json');
  if (fs.existsSync(hp)) {
    const h = JSON.parse(fs.readFileSync(hp, 'utf8'));
    const bad = Object.values(h.dishes).flat().filter(x => !h.halls[x[1]] || !h.meals[x[2]] || !/^\d{4}-\d\d-\d\d$/.test(x[0]));
    check(`real history.json: ${Object.keys(h.dishes).length} dishes, every row resolves`, bad.length === 0, JSON.stringify(bad.slice(0, 3)));
  }
}

console.log('\n9. default meal follows the hours, not a fixed clock');
{
  const site = JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'site.json'), 'utf8'));
  const M = site.meals, H = site.halls;
  const sat = (h, m = 0) => new Date(2026, 9, 24, h, m);   // Sat 10/24
  const sun = (h, m = 0) => new Date(2026, 9, 25, h, m);
  const mon = (h, m = 0) => new Date(2026, 9, 26, h, m);
  const dm = d => S.defaultMeal(M, H, d);
  check('Sat 09:45 opens on Lunch (brunch open at Arrillaga/Lakeside)', dm(sat(9, 45)) === 'Lunch', dm(sat(9, 45)));
  check('Sat 08:00 opens on Lunch (next to start; no weekend breakfast)', dm(sat(8)) === 'Lunch', dm(sat(8)));
  check('Sun 06:00 opens on Lunch', dm(sun(6)) === 'Lunch', dm(sun(6)));
  check('Sat 14:30 opens on Dinner', dm(sat(14, 30)) === 'Dinner', dm(sat(14, 30)));
  check('Sat 22:00 stays on Dinner', dm(sat(22)) === 'Dinner', dm(sat(22)));
  check('Mon 06:00 opens on Breakfast', dm(mon(6)) === 'Breakfast', dm(mon(6)));
  check('Mon 09:30 opens on Breakfast (Arrillaga until 10:00)', dm(mon(9, 30)) === 'Breakfast', dm(mon(9, 30)));
  check('Mon 10:15 opens on Lunch (every breakfast over)', dm(mon(10, 15)) === 'Lunch', dm(mon(10, 15)));
  check('Mon 12:00 opens on Lunch', dm(mon(12)) === 'Lunch', dm(mon(12)));
  check('Mon 15:30 opens on Dinner (every lunch over)', dm(mon(15, 30)) === 'Dinner', dm(mon(15, 30)));
  check('Mon 23:00 stays on Dinner', dm(mon(23)) === 'Dinner', dm(mon(23)));
  check('no hours anywhere falls back to the clock rule',
    S.defaultMeal(M, [{ id: 'x' }], sat(9, 45)) === 'Breakfast' && S.defaultMeal(M, [], mon(12)) === 'Lunch');
  check('overnight window is ignored, not treated as open',
    S.defaultMeal(['Breakfast', 'Late'], [{ hours: { weekday: { Breakfast: ['7:00', '9:00'], Late: ['21:00', '1:00'] } } }], mon(23, 30)) === 'Breakfast');
}

// bin/mutate, 2026-10-26: 40 of 160 survived. Every check below was written after planting
// the survivor and printing what the function returned.
console.log('\n10. edges the earlier sections never stood on (bin/mutate survivors)');
{
  const H = { weekday: { Breakfast: ['7:30', '10:00'], Lunch: ['11:00', '13:30'], Dinner: ['17:00', '20:00'] },
              weekend: { Lunch: ['10:30', '13:30'], Dinner: ['17:00', '20:00'] } };
  const cd = {
    halls: [{ id: 'Arr', name: 'Arrillaga', hours: H }, { id: 'Wil', name: 'Wilbur', hours: H }],
    days: ['10/17/2026', '10/18/2026', '10/19/2026'], meals: ['Breakfast', 'Lunch', 'Dinner'],
    dishes: [{ n: 'Pho' }, { n: 'Rice' }],
    // dish 0 at Wilbur only, dish 1 at Arrillaga only, so dish order inserts Wilbur first
    menus: { '1|2|1': [0], '1|0|2': [0], '0|0|2': [1], '0|0|1': [1], '0|1|2': [1] },
  };
  const ci = S.buildIndex(cd);
  const keys = sl => sl.map(e => `${e.hall[0]}${e.dayIdx}${e.mealIdx}`).join();
  const all = S.calendarSlots([0, 1], ci, cd, at(0, 8)).slots;
  check('calendar events sorted day, meal, then hall, from input that is none of those',
    keys(all) === 'A01,A02,W02,A12,W21', keys(all));
  check('a window ending exactly now is over; a minute before it is not',
    keys(S.calendarSlots([1], ci, cd, at(0, 13, 30)).slots) === 'A02,A12'
    && keys(S.calendarSlots([1], ci, cd, at(0, 13, 29)).slots) === 'A01,A02,A12'
    && keys(S.calendarSlots([0], ci, cd, at(0, 20)).slots) === 'W21'
    && keys(S.calendarSlots([0], ci, cd, at(0, 19, 59)).slots) === 'W02,W21');
  check('"over" is only for TODAY: at 21:00, later days\' 13:30 lunches stay',
    keys(S.calendarSlots([0, 1], ci, cd, at(0, 21)).slots) === 'A12,W21');
  const ics = S.toICS(S.calendarSlots([0, 1], ci, cd, at(0, 8)).slots.slice(0, 1), cd, new Date(0)).replace(/\r\n /g, '');
  const two = { ...cd, menus: { '0|0|1': [0, 1] } };
  const ics2 = S.toICS(S.calendarSlots([0, 1], S.buildIndex(two), two, at(0, 8)).slots, two, new Date(0)).replace(/\r\n /g, '');
  check('one dish names itself, two say "2 saved dishes"',
    ics.includes('SUMMARY:Rice — lunch at Arrillaga') && ics2.includes('SUMMARY:2 saved dishes — lunch at Arrillaga'));
  const rev = { ...data, menus: { '0|1|2': [5], '0|1|1': [5], '0|1|0': [5], '0|2|0': [5] } };
  const r = S.servingsFor(5, S.buildIndex(rev), rev, at(0, 8));
  check('same-day meals sorted from three handed over in reverse', r.upcoming.map(s => `${s.dayIdx}${s.mealIdx}`).join() === '10,11,12,20',
    r.upcoming.map(s => `${s.dayIdx}${s.mealIdx}`).join());
  const many = { ...data, menus: {} };
  for (let d = 0; d < 3; d++) for (let m = 0; m < 3; m++) many.menus[`0|${d}|${m}`] = [1];
  const rm = S.servingsFor(1, S.buildIndex(many), many, at(0, 6));
  check('the cap is 4 shown, 5 more (literal: S.MAX_SHOWN moves with a mutant)', rm.shown.length === 4 && rm.more === 5);
  check('fold: 75 octets stay one line, 76 fold, continuations hold 74 + the space',
    S.fold('x'.repeat(75)) === 'x'.repeat(75) && S.fold('x'.repeat(76)) === 'x'.repeat(75) + '\r\n x'
    && S.fold('x'.repeat(150)) === 'x'.repeat(75) + '\r\n ' + 'x'.repeat(74) + '\r\n x');
  const r3 = { date: '2026-10-22', daysAgo: 2, halls: ['A', 'B', 'C'] };
  check('text: three halls fold to +1', S.lastServedText(r3) === 'Last served Thu 10/22 at A, B +1 (2 days ago).', S.lastServedText(r3));
  const hist = { halls: ['Branner', 'Stern'], meals: ['Breakfast', 'Lunch', 'Dinner'],
    dishes: { Pho: [['2026-10-20', 1, 1], ['2026-10-22', 0, 1], ['2026-10-21', 1, 1]] } };   // latest at hall 0, so comparing
  // the hall index instead of the date cannot land on it by luck (the first draft did)
  const ls = S.lastServed('Pho', hist, { halls: [] }, new Date(2026, 9, 24, 12));
  check('last served is the latest past date, wherever it sits in the rows', ls && ls.date === '2026-10-22' && ls.halls.join() === 'Branner', JSON.stringify(ls));
  const dm = (h, m, halls = [cd.halls[0]]) => S.defaultMeal(cd.meals, halls, new Date(2026, 9, 26, h, m));   // Monday
  check('default meal: a window is open from its first minute to its last',
    dm(7, 30) === 'Breakfast' && dm(10, 0) === 'Breakfast' && dm(10, 1) === 'Lunch' && dm(13, 0) === 'Lunch' && dm(13, 31) === 'Dinner',
    [dm(7, 30), dm(10, 0), dm(10, 1), dm(13, 0), dm(13, 31)].join());
  const clock = (h, m) => S.defaultMeal(cd.meals, [], new Date(2026, 9, 26, h, m));
  check('fallback clock: 10:29 Breakfast, 10:30 Lunch, 15:59 Lunch, 16:00 Dinner',
    [clock(10, 29), clock(10, 30), clock(15, 59), clock(16, 0)].join() === 'Breakfast,Lunch,Lunch,Dinner',
    [clock(10, 29), clock(10, 30), clock(15, 59), clock(16, 0)].join());
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
