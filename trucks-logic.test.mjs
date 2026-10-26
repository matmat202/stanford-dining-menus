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

/* Cases bin/mutate found missing on 2026-10-26, each one a survivor above that the
 * fixture above cannot distinguish. Kept on their own fixtures so the counts the
 * checks above assert stay the counts they were written for.
 *
 * Three of them survived by coincidence, not by omission, which is the whole argument
 * for mutating rather than eyeballing coverage:
 *   - `openNow` inverted to `!== 'open'` still returned 1, because the day above has
 *     exactly one open truck and exactly one that is not.
 *   - `next.rows` inverted still returned 2 rows, because Monday has 2 and the other
 *     two future dates have 1 each.
 *   - `RANK[a] - RANK[b]` summed instead still ordered 2 trucks correctly: V8 compares
 *     one pair for a 2-element array, and 0+1 and 1-0 are both positive.
 */
console.log('\n6. ordering and counts that need more than two trucks');
const MANY = [
  T('2026-10-26', '08:00', '09:00', 'Done Diner'),       // done at 12:00
  T('2026-10-26', '17:00', '20:00', 'Later Lunch'),      // later at 12:00
  T('2026-10-26', null, null, 'Unknown Wagon'),          // unknown
  T('2026-10-26', '11:30', '14:00', 'Open One'),         // open at 12:00
  T('2026-10-26', '12:00', '13:00', 'Open Two'),         // open at 12:00
];
const noon = at(2026, 10, 26, 12, 0);
p = L.plan(MANY, noon);
check('all four states rank open -> later -> unknown -> done',
  p.today.map(r => r.st.state).join() === 'open,open,later,unknown,done',
  p.today.map(r => `${r.vendor}:${r.st.state}`).join(' '));
check('two open now is counted as two, not as the rest', p.openNow === 2, String(p.openNow));
check('equal-rank trucks break the tie by opening time',
  p.today[0].vendor === 'Open One' && p.today[1].vendor === 'Open Two',
  p.today.map(r => r.vendor).join());

/* Three of them, handed over in the wrong order. Two is not enough: V8 compares a
 * single pair for a 2-element array, so a comparator that is wrong in a way that
 * happens to leave that one pair alone still sorts it correctly. Mutating
 * `(b.open || '')` to `(b.open && '')` is exactly that mutant. */
const TIES = [
  T('2026-10-26', '07:30', '08:00', 'Third'),
  T('2026-10-26', '06:00', '07:00', 'First'),
  T('2026-10-26', null, null, 'NoHours'),
  T('2026-10-26', '07:00', '07:30', 'Second'),
];
const ties = L.plan(TIES, noon);
check('three same-rank trucks sort by opening time, not input order',
  ties.today.filter(r => r.st.state === 'done').map(r => r.vendor).join() === 'First,Second,Third',
  ties.today.map(r => `${r.vendor}:${r.st.state}`).join(' '));
check('a truck with no hours still sorts, ahead of the finished ones',
  ties.today[0].vendor === 'NoHours', ties.today.map(r => r.vendor).join());

console.log('\n7. half-known hours, and minutes that are not :00');
check('a close with no open is unknown, not open',
  L.status({ date: '2026-10-26', open: null, close: '14:00' }, noon).state === 'unknown');
check('an open with no close is unknown, not open',
  L.status({ date: '2026-10-26', open: '11:00', close: null }, noon).state === 'unknown');
check('11:30 open is not read as 11:00',
  L.status(T('2026-10-26', '11:30', '14:00'), at(2026, 10, 26, 11, 15)).state === 'later');
check('minutes until a :30 opening', 
  L.status(T('2026-10-26', '11:30', '14:00'), at(2026, 10, 26, 11, 15)).inMin === 15);
check('minutes left to a :45 close',
  L.status(T('2026-10-26', '11:00', '13:45'), at(2026, 10, 26, 13, 20)).leftMin === 25);

console.log('\n8. next and week group the right rows');
const SPREAD = [
  T('2026-10-27', '10:00', '15:00', 'Tue A'),
  T('2026-10-27', '11:00', '14:00', 'Tue B'),
  T('2026-10-27', '12:00', '13:00', 'Tue C'),
  T('2026-10-29', '10:00', '15:00', 'Thu A'),
];
p = L.plan(SPREAD, at(2026, 10, 26, 12, 0));
check('next carries only that date\u2019s rows', p.next.date === '2026-10-27'
  && p.next.rows.map(r => r.vendor).join() === 'Tue A,Tue B,Tue C', JSON.stringify(p.next.rows.map(r => r.vendor)));
check('week groups 3 + 1, not 1 + 3',
  p.week.map(w => `${w.date}:${w.rows.length}`).join() === '2026-10-27:3,2026-10-29:1',
  p.week.map(w => `${w.date}:${w.rows.length}`).join());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
