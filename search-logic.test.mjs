/* Tests for the dish search matcher. Run: node search-logic.test.mjs
 *
 * Pins two things: queries typed plainly find dishes whose names carry accents,
 * apostrophes, '&', hyphens or plurals; and nothing the old raw-substring test found is
 * lost (section 3 replays the old test against the live payload).
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const S = require(path.join(HERE, 'search-logic.js'));

let pass = 0, fail = 0;
const check = (n, c, d = '') => c ? (pass++, console.log(`  ok   ${n}`))
                                  : (fail++, console.log(`  FAIL ${n}${d ? '  — ' + d : ''}`));

console.log('1. plainly typed queries find the dish (each was a miss before)');
const finds = [
  ['gyudon', 'Gyūdon'], ['spatzle', 'Spätzle'], ['sauteed', 'Sautéed Gai Lan with Garlic'],
  ['oahu', 'Oʻahu Kalua Pork Plate'], ['chickn', 'Huli Huli Chick’n'], ['chickn strips', "Chick'n Strips"],
  ['chefs choice', "Chef's Choice Egg Special"], ['gluten free waffles', 'Gluten-Free Waffles'],
  ['biscuits and gravy', 'Buttermilk Biscuits & Gravy'], ['tri tip', 'Santa Maria-Style Tri-Tip'],
  ['plant powered eggs', 'Plant Powered "Eggs”'], ['burgers', 'Black Bean Burger'],
  ['tacos', 'Breakfast Taco Bar'], ['potatoes', 'Baked Potato Bar'], ['berries', 'Mixed Berry Parfait'],
  ['  Gyūdon ', 'Gyūdon'], ['GLUTEN-FREE', 'Gluten-Free Waffles'],
];
for (const [q, n] of finds) check(`${JSON.stringify(q)} -> ${n}`, S.matches(q, n, ''));

console.log('2. what must still hold');
check('ingredients are searched', S.matches('rice flour', 'Chicken Tenders', 'chicken, rice flour, salt'));
check('half-typed word still matches', S.matches('chick', 'Chicken Tikka Masala', ''));
check('half-typed plural-looking word', S.matches('chees', 'Mac & Cheese', ''));
check('compound words still match (unanchored)', S.matches('fruit', 'Smoky BBQ Jackfruit', ''));
check('-ies plural not lost to stemming', S.matches('veggie', 'Rice Noodles with Veggies', ''));
check('empty query matches everything', S.matches('   ', 'Anything', ''));
check('words out of order do NOT match', !S.matches('rice fried', 'Fried Rice', ''));
check('no false match across name/ingredient words',
  !S.matches('fried rice', 'Chicken Tenders', 'chicken, fried in oil, rice flour'));
check('unrelated query misses', !S.matches('sushi', 'Gyūdon', 'beef, rice, onion'));
check('-ss words keep their s', S.stem('swiss') === 'swiss' && S.stem('bass') === 'bass');
check('short words untouched', S.stem('gas') === 'gas' && S.stem('pes') === 'pes');

console.log('3. superset of the old matcher on the real payload');
const file = path.join(HERE, 'data', 'menus.json');
if (!fs.existsSync(file)) { check('menus.json present', false, file); }
else {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const dishes = new Map();
  for (const v of Object.values(d.menus)) for (const x of v) dishes.set(x.name, x.ingredients || '');
  const words = new Set();
  for (const n of dishes.keys()) for (const w of n.toLowerCase().match(/[a-z]{2,}/g) || []) words.add(w);
  const queries = [...words, ...[...dishes.keys()].map(n => n.toLowerCase())];
  let lost = [];
  for (const q of queries) for (const [n, i] of dishes)
    if ((n + ' ' + i).toLowerCase().includes(q) && !S.matches(q, n, i)) lost.push(`${q} -> ${n}`);
  check(`${queries.length} queries x ${dishes.size} dishes: none lost vs old test`, lost.length === 0,
        lost.slice(0, 5).join('; '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
