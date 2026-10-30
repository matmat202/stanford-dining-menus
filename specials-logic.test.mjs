/* Tests for the dinner-special lookup. Run: node specials-logic.test.mjs
 * Against the real parse of R&DE's Oct 26 - Nov 6 2026 calendar (fixtures/specials-2026-10-26.json).
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(HERE, 'specials-logic.js'));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  — ' + detail : ''}`); }
};
let fx = path.join(HERE, '..', 'fixtures', 'specials-2026-10-26.json');
if (!fs.existsSync(fx)) fx = path.join(HERE, 'fixtures', 'specials-2026-10-26.json');
if (!fs.existsSync(fx)) {   // the public repo's flat copy ships no fixtures
  console.log('SKIP specials-logic.test.mjs: fixtures/specials-2026-10-26.json not here'); process.exit(0);
}
const data = JSON.parse(fs.readFileSync(fx, 'utf8'));
const at = (y, mo, d, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi);

check('dateKey uses local fields, late evening stays today', L.dateKey(at(2026, 10, 29, 23, 30)) === '2026-10-29');
const st = L.forHall(data, 'Stern', at(2026, 10, 29), 'Dinner');
check('Stern Thu 10-29 is the Dia de Muertos dinner', st && st.text === 'Dia de Muertos Dinner' && st.event === true, JSON.stringify(st));
const fri = L.forHall(data, 'Stern', at(2026, 10, 30), 'Dinner');
check('Stern Fri 10-30 returns to the Quesadilla Bar, not an event', fri && fri.text === 'Quesadilla Bar' && !fri.event, JSON.stringify(fri));
const dw = L.forHall(data, 'FlorenceMoore', at(2026, 11, 5), 'Dinner');
check('FloMo Thu 11-05 is Diwali Dinner', dw && dw.text === 'Diwali Dinner' && dw.event);
check('FloMo Wed 11-04 is the soba special', L.forHall(data, 'FlorenceMoore', at(2026, 11, 4), 'Dinner')?.text === 'Miso-Sesame Soba Noodles');
check('AFDC label maps to Arrillaga', /Pork Belly/.test(L.forHall(data, 'Arrillaga', at(2026, 10, 26), 'Dinner')?.text || ''));
check('lunch shows no dinner special', L.forHall(data, 'Stern', at(2026, 10, 29), 'Lunch') === null);
check('Saturday has none', L.forHall(data, 'Stern', at(2026, 10, 31), 'Dinner') === null);
check('a hall the calendar does not list has none', L.forHall(data, 'Nowhere', at(2026, 10, 26), 'Dinner') === null);
check('not loaded is null, not a throw', L.forHall(null, 'Stern', at(2026, 10, 26), 'Dinner') === null);
check('every weeknight hall-pair is one row (8 halls x 10 nights)', data.specials.length === 80
      && new Set(data.specials.map(r => r.hall + r.date)).size === 80);
check('label names an event as a themed dinner', L.label(st).lead === 'Themed dinner' && L.label(fri).lead === 'R&DE special');
check('label(null) is null', L.label(null) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
