/* Tests for link encode/decode. Run: node url-state.test.mjs
 * Emphasis on hostile and stale input: a shared link must never blank the page.
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const U = require(path.join(HERE, 'url-state.js'));

let pass = 0, fail = 0;
const check = (n, c, d = '') => c ? (pass++, console.log(`  ok   ${n}`))
                                  : (fail++, console.log(`  FAIL ${n}${d ? '  — ' + d : ''}`));

const data = {
  days: ['10/17/2026','10/18/2026','10/19/2026','10/20/2026'],
  meals: ['Breakfast','Lunch','Dinner'],
  allergens: ['MILK','SOY','WHEAT'],
};
const now = new Date(2026, 9, 18, 12, 0);   // 18 Oct 2026, in range

console.log('\n1. dates, not indices');
check('payload date -> ISO', U.toISO('10/17/2026') === '2026-10-17', U.toISO('10/17/2026'));
check('resolves a date in range', U.parse('#d=2026-10-19', data, now).day === 2);
check('garbage date falls back to today',
  U.parse('#d=not-a-date', data, now).day === 1, 'today is index 1');
{
  const r = U.parse('#d=2026-12-25', data, now);
  check('out-of-week date falls back to today', r.day === 1, String(r.day));
  check('…and is reported as stale, not silently swapped', r.staleDate === '2026-12-25');
}
check('no date at all -> today', U.parse('', data, now).day === 1);

console.log('\n2. meal by name, case-insensitive');
check('Dinner -> 2', U.parse('#m=Dinner', data, now).meal === 2);
check('lowercase works', U.parse('#m=dinner', data, now).meal === 2);
check('unknown meal -> -1 (caller picks by clock)', U.parse('#m=Brunch', data, now).meal === -1);

console.log('\n3. untrusted values are dropped, not carried');
{
  const r = U.parse('#diet=vg,NOPE,gf&x=MILK,PLUTONIUM&v=evil', data, now);
  check('unknown diet code dropped', !r.diets.has('NOPE') && r.diets.has('vg') && r.diets.has('gf'));
  check('unknown allergen dropped', !r.exclude.has('PLUTONIUM') && r.exclude.has('MILK'));
  check('unknown view falls back to halls', r.view === 'halls', r.view);
}
check('known view kept', U.parse('#v=compare', data, now).view === 'compare');
check('libraries is a known view', U.parse('#v=libraries', data, now).view === 'libraries',
  'added with the library-hours section; a shared link to it must survive a reload');
check('rec is a known view', U.parse('#v=rec', data, now).view === 'rec',
  'added with the rec-hours section');
check('search is trimmed, lowercased and capped',
  U.parse('#q=' + encodeURIComponent('  ToFu  '), data, now).q === 'tofu');
check('absurdly long query is capped',
  U.parse('#q=' + 'a'.repeat(500), data, now).q.length === 80);
check('open flag only on exactly "1"',
  U.parse('#open=1', data, now).openOnly === true &&
  U.parse('#open=yes', data, now).openOnly === false);

console.log('\n4. round trip');
{
  const state = { day: 2, meal: 2, view: 'compare', diets: new Set(['vg','gf']),
                  exclude: new Set(['MILK']), q: 'tofu', openOnly: true };
  const h = U.serialize(state, data);
  const r = U.parse('#' + h, data, now);
  check('day survives',    r.day === 2, String(r.day));
  check('meal survives',   r.meal === 2);
  check('view survives',   r.view === 'compare');
  check('diets survive',   [...r.diets].sort().join() === 'gf,vg');
  check('excludes survive',[...r.exclude].join() === 'MILK');
  check('query survives',  r.q === 'tofu');
  check('open survives',   r.openOnly === true);
  check('defaults omitted from the link',
    !U.serialize({day:0,meal:0,view:'halls',diets:new Set(),exclude:new Set(),q:'',openOnly:false}, data)
      .includes('v='));
}

console.log('\n5. against the real payload');
{
  const real = JSON.parse(fs.readFileSync(path.join(HERE,'data','site.json'),'utf8'));
  const h = U.serialize({day:0,meal:1,view:'halls',diets:new Set(['vg']),
                         exclude:new Set([real.allergens[0]]),q:'',openOnly:false}, real);
  const r = U.parse('#'+h, real);
  check('real payload round-trips', r.day === 0 && r.meal === 1 && r.diets.has('vg'));
  check('every payload day converts to ISO', real.days.every(d => /^\d{4}-\d{2}-\d{2}$/.test(U.toISO(d))));
  check('empty hash never throws and yields a valid day',
    U.parse('', real).day >= 0 && U.parse('', real).day < real.days.length);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
