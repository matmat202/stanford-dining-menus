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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
