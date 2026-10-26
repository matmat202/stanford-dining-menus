/* Tests for the meal-plan picker. Run: node plans-logic.test.mjs
 * Driven by R&DE's 2026-27 numbers as scraped on 2026-10-25 (fixtures/plans-2026-10-25.json)
 * plus fabricated variants for the cases the real page does not show (unequal prices).
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(HERE, 'plans-logic.js'));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  — ' + detail : ''}`); }
};
const near = (a, b, eps = 0.005) => Math.abs(a - b) < eps;

const FX = path.join(HERE, '..', 'fixtures', 'plans-2026-10-25.json');
if (!fs.existsSync(FX)) {           // the published copy carries no fixtures
  console.log('fixtures/ not present: skipped (run from the sandbox copy)');
  process.exit(0);
}
const D = JSON.parse(fs.readFileSync(FX, 'utf8'));

console.log('\n1. weeks per quarter (inclusive dates, UTC day math)');
const fall = D.dates.find(d => d.quarter === 'Fall');
check('Fall 2026-09-18..12-11 is 85 days', near(L.weeksIn(fall) * 7, 85));
check('Winter is 77 days = 11 weeks', near(L.weeksIn(D.dates.find(d => d.quarter === 'Winter')), 11));
check('a span across the November DST change is still whole days',
  near(L.weeksIn({ start: '2026-10-31', end: '2026-11-06' }), 1));

console.log('\n2. which quarter a date is about');
check('mid-Fall -> Fall', L.quarterFor(D.dates, '2026-10-25').quarter === 'Fall');
check('first day counts', L.quarterFor(D.dates, '2026-09-18').quarter === 'Fall');
check('last day counts', L.quarterFor(D.dates, '2026-12-11').quarter === 'Fall');
check('winter break -> the coming Winter', L.quarterFor(D.dates, '2026-12-20').quarter === 'Winter');
check('after Spring -> null', L.quarterFor(D.dates, '2027-07-01') === null);

console.log('\n3. the switch window (first three weeks)');
{
  const w = L.switchWindow(D.dates, '2026-09-20');
  check('Fall window open on day 3', w.quarter === 'Fall' && w.open, JSON.stringify(w));
  check('Fall window ends on day 21 (Oct 8)', w.until === '2026-10-08', w.until);
  const last = L.switchWindow(D.dates, '2026-10-08');
  check('still open on its last day', last.quarter === 'Fall' && last.open);
  const after = L.switchWindow(D.dates, '2026-10-25');
  check('after it shuts, the next is Winter, not yet open',
    after.quarter === 'Winter' && !after.open && after.from === '2027-01-02' && after.until === '2027-01-22',
    JSON.stringify(after));
  check('after Spring\'s window there is none', L.switchWindow(D.dates, '2027-05-01') === null);
}

console.log('\n4. the pick, at the real (equal) prices');
{
  const c = L.compare(D, 'Fall', 11);
  check('prices are equal in Fall', c.sameCost);
  check('11 meals -> the 12', c.pick === 12, c.pick);
  const r19 = c.rows.find(r => r.swipes === 19), r12 = c.rows.find(r => r.swipes === 12);
  check('on the 19, 8 swipes a week expire', r19.wasted === 8 && r19.short === 0);
  check('the 12 adds $210 in Fall', r12.mpd === 210 && r12.wasted === 1);
  check('exactly 12 -> the 12', L.compare(D, 'Fall', 12).pick === 12);
  check('13 -> the 15 (the 12 would leave you a meal short)', L.compare(D, 'Fall', 13).pick === 15);
  check('15 -> the 15', L.compare(D, 'Fall', 15).pick === 15);
  check('16 -> the 19', L.compare(D, 'Fall', 16).pick === 19);
  check('25 (more than any plan) -> the biggest, the 19', L.compare(D, 'Fall', 25).pick === 19);
  const big = L.compare(D, 'Fall', 25).rows.find(r => r.swipes === 19);
  check('...and says how many it leaves uncovered', big.short === 6);
  check('0 meals -> the 12', L.compare(D, 'Fall', 0).pick === 12);
}

console.log('\n5. the 12 is upper-class only');
{
  const c = L.compare(D, 'Fall', 10, { upper: false });
  check('a frosh at 10 meals gets the 15, not the 12', c.pick === 15, c.pick);
  check('the 12 row is marked ineligible', !c.rows.find(r => r.swipes === 12).eligible);
}

console.log('\n6. what a given-up swipe is bought back at');
{
  const c = L.compare(D, 'Fall', 15);
  const a = c.rates.find(r => r.from === 19 && r.to === 15);
  const b = c.rates.find(r => r.from === 15 && r.to === 12);
  // 19->15: $110 for 4 swipes x 85/7 weeks = 48.57 swipes; 15->12: $100 for 36.43.
  check('19 -> 15 is $2.26 a swipe in Fall', near(a.perSwipe, 110 / (4 * 85 / 7)), a.perSwipe);
  check('15 -> 12 is $2.75 a swipe in Fall', near(b.perSwipe, 100 / (3 * 85 / 7)), b.perSwipe);
  check('rates are in swipe order, two of them', c.rates.length === 2);
}

console.log('\n7. unequal prices: show numbers, recommend nothing');
{
  const U = JSON.parse(JSON.stringify(D));
  U.plans.find(p => p.swipes === 12).quarters.find(q => q.quarter === 'Fall').cost = 2700;
  const c = L.compare(U, 'Fall', 11);
  check('sameCost is false', !c.sameCost);
  check('no pick', c.pick === null, c.pick);
  check('Winter is still equal, so Winter still picks', L.compare(U, 'Winter', 11).pick === 12);
}

console.log('\n8. missing data');
check('unknown quarter -> null', L.compare(D, 'Summer', 10) === null);
{
  const M = JSON.parse(JSON.stringify(D));
  M.plans[1].quarters = M.plans[1].quarters.filter(q => q.quarter !== 'Spring');
  check('a plan missing the quarter -> null, not a partial table', L.compare(M, 'Spring', 10) === null);
}

// bin/mutate 2026-10-26 survivors. Feb is the short month, so a month index off by one
// changes the day count; the fixture's quarters all straddle 30/31-day months only.
console.log('\n9. day math across February, the first day of the window, and plan order');
{
  check('Feb 20 - Mar 5 2027 is exactly 2 weeks', L.weeksIn({ start: '2027-02-20', end: '2027-03-05' }) === 2,
    String(L.weeksIn({ start: '2027-02-20', end: '2027-03-05' })));
  const q = [{ quarter: 'W', start: '2027-02-20', end: '2027-04-01' }];
  const w = L.switchWindow(q, '2027-02-20');
  check('the switch window is open ON its first day and runs 21 days across Feb',
    w && w.open === true && w.until === '2027-03-12', JSON.stringify(w));
  const plan = (swipes, mpd) => ({ swipes, upper_only: false, quarters: [{ quarter: 'W', cost: 100, mpd }] });
  const c = L.compare({ dates: q, plans: [plan(10, 900), plan(19, 100), plan(14, 500)] }, 'W', 12);
  check('rows sorted most swipes first from scrambled input', c.rows.map(r => r.swipes).join() === '19,14,10', c.rows.map(r => r.swipes).join());
  const dup = L.compare({ dates: q, plans: [plan(14, 500), plan(14, 600)] }, 'W', 12);
  check('two plans with the same swipes produce no rate (no divide by zero)', dup.rates.length === 0, JSON.stringify(dup.rates));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
