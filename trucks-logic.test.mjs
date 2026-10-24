/* Tests for food-truck now/later/done reasoning. Run: node trucks-logic.test.mjs
 * Driven with a fabricated campus clock, against the real 2026-10-24 scrape shape.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(HERE, 'trucks-logic.js'));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  — ' + detail : ''}`); }
};
const T = (date, open, close, vendor) => ({ date, open, close, vendor });
const trucks = [
  T('2026-10-26', '10:00', '15:00', 'Oaxacan Kitchen Mobile'),
  T('2026-10-26', '11:00', '14:00', 'Hint Of Desi'),
  T('2026-10-27', '10:00', '15:00', 'Thai Thai'),
  T('2026-10-30', '11:00', '14:00', 'Chubby’s Chick’n'),
];
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi);

// date key comes from local (campus) fields, not UTC
check('dateKey uses local fields', L.dateKey(at(2026, 10, 26, 23, 30)) === '2026-10-26');
check('dateKey pads month/day', L.dateKey(at(2026, 1, 5, 9, 0)) === '2026-01-05');

// boundaries
const s = r => L.status(r, at(2026, 10, 26, ...r.t)).state;
check('09:59 is later', s({ ...trucks[0], t: [9, 59] }) === 'later');
check('10:00 is open', s({ ...trucks[0], t: [10, 0] }) === 'open');
check('14:59 is open', s({ ...trucks[0], t: [14, 59] }) === 'open');
check('15:00 is done (close is exclusive)', s({ ...trucks[0], t: [15, 0] }) === 'done');
check('no hours is unknown', L.status({ date: '2026-10-26', open: null, close: null }, at(2026, 10, 26, 12, 0)).state === 'unknown');
check('minutes left', L.status(trucks[1], at(2026, 10, 26, 13, 15)).leftMin === 45);
check('minutes until open', L.status(trucks[1], at(2026, 10, 26, 10, 20)).inMin === 40);

// plan on a Monday at 10:30: one open, one later, ranked open first
let p = L.plan(trucks, at(2026, 10, 26, 10, 30));
check('Mon 10:30 two trucks today', p.today.length === 2);
check('Mon 10:30 one open now', p.openNow === 1, String(p.openNow));
check('open ranked first', p.today[0].vendor === 'Oaxacan Kitchen Mobile');
check('next day is Tuesday', p.next && p.next.date === '2026-10-27');

// Monday 14:30: Hint Of Desi done, ranked after the open one
p = L.plan(trucks, at(2026, 10, 26, 14, 30));
check('Mon 14:30 done ranked last', p.today[1].vendor === 'Hint Of Desi' && p.today[1].st.state === 'done');

// Saturday: nothing today, next is Monday; week lists every future date once, in order
p = L.plan(trucks, at(2026, 10, 24, 12, 0));
check('Sat no trucks today', p.today.length === 0 && p.openNow === 0);
check('Sat next is Monday', p.next.date === '2026-10-26' && p.next.rows.length === 2);
check('week is 3 dates in order', p.week.map(w => w.date).join() === '2026-10-26,2026-10-27,2026-10-30');

// Wednesday gap: next skips the empty days to Friday
p = L.plan(trucks, at(2026, 10, 28, 12, 0));
check('Wed next skips to Friday', p.next.date === '2026-10-30');

// after the last date: no next
p = L.plan(trucks, at(2026, 10, 31, 12, 0));
check('past the data: next is null', p.next === null && p.week.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
