/* Tests for the ingredients-vs-tags check. Run: node allergen-check.test.mjs
 * Every case is a real dish from the 2026-10-17..21 payloads, judged by hand
 * (projects/allergen-xcheck/NOTES.md). Ingredient strings are trimmed to the part that matters. */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const A = require(path.join(HERE, 'allergen-check.js'));

let pass = 0, fail = 0;
const check = (n, c, d = '') => c ? (pass++, console.log(`  ok   ${n}`))
                                  : (fail++, console.log(`  FAIL ${n}${d ? '  — ' + d : ''}`));
const flags = (i, a = '', x = '') => A.untagged({ i, a, x }).map(h => h.allergen).sort().join(',');

console.log('\n1. real misses are flagged, with the phrase');
check('soy sauce, untagged -> SOY and WHEAT', flags('jackfruit, soy sauce, lime') === 'SOY,WHEAT');
check('mayonnaise, tagged MILK SOY -> EGG', flags('corn, mayonnaise, cotija', 'MILK, SOY') === 'EGG');
check('coconut liquid aminos -> COCONUT', flags('portobello, coconut liquid aminos') === 'COCONUT');
check('coconut milk, untagged -> COCONUT (milk alternative must not hide coconut)',
      flags('beef, red curry paste, coconut milk, lime juice') === 'COCONUT');
check('cashews in ingredients, TREENUTS only as shared equipment -> TREENUTS',
      flags('shrimp, cream, cashews', 'MILK, SHELLFISH', 'TREENUTS') === 'TREENUTS');
check('smoky aioli -> EGG; hot dog bun -> WHEAT',
      flags('sausage, hot dog bun, smoky aioli sauce') === 'EGG,WHEAT');
const h = A.untagged({ i: 'jackfruit, soy sauce', a: '' }).find(x => x.allergen === 'WHEAT');
check('the matched phrase is returned for quoting', h && h.phrase === 'soy sauce', JSON.stringify(h));

console.log('\n2. tagged allergens are not re-reported');
check('tofu tagged SOY', flags('tofu, ginger', 'SOY') === '');
check('mayonnaise tagged EGG', flags('ramen noodles, mayonnaise', 'EGG, SESAME, SOY, WHEAT') === '');

console.log('\n3. known false positives stay quiet');
check('"soy-free sauce"', flags('pork, lemongrass marinade (soy-free sauce [canola oil])') === '');
check('egg substitute', flags('tofu, egg substitute, onion', 'SOY') === '');
check('"egg" / "milk" substitute in quotes',
      flags('tofu, "egg" substitute, "milk" substitute, flour', 'SOY, TREENUTS, WHEAT') === '');
check('vegetarian oyster sauce', flags('eggplant, tofu, vegetarian oyster sauce, tamari', 'SOY, WHEAT') === '');
check('king oyster mushroom', flags('jackfruit, shredded king oyster mushroom') === '');
check('mustard flour / soy flour / rice flour / corn starch flour',
      flags('mustard flour, white rice flour, soy flour, corn starch flour', 'SOY') === '');
check('GF hamburger bun', flags('jackfruit, GF hamburger bun') === '');
check('Daiya sliced cheddar cheese + non allergen plant based butter',
      flags("gluten-free bread, Daiya sliced cheddar cheese, non allergen plant based butter", 'COCONUT') === '');
check('Prime Roots "tofu" is koji, not soy', flags('prime roots tofu (mycoprotein, koji), ginger', 'COCONUT') === '');
check('eggplant, butternut, peanut butter is not MILK',
      flags('eggplant, butternut squash, peanut butter', 'PEANUTS') === '');
check('"free from the top food allergens" opts the whole item out',
      flags('sliced bread, alternative milk) Free from the top food allergens.') === '');
check('soybean oil is a refined oil, not SOY', flags('vinegar, vegetable oil [soybean oil, canola oil]') === '');

console.log('\n4. no data at all, and the warning for an active exclusion');
const bar = { n: 'Nacho Bar', i: '', a: '', x: '' };
check('Nacho Bar has no data', A.noData(bar));
check('a dish with tags is not no-data', !A.noData({ i: '', a: 'MILK', x: '' }));
check('no exclusion -> no warning', !A.warnFor(bar, new Set()).noData);
check('exclusion -> no-data warning', A.warnFor(bar, new Set(['MILK'])).noData);
const carn = { i: 'jackfruit, soy sauce', a: '', x: '' };
check('warning only for excluded allergens',
      A.warnFor(carn, new Set(['SOY'])).hits.map(x => x.allergen).join() === 'SOY');
check('excluding something unrelated -> no hits', A.warnFor(carn, new Set(['FISH'])).hits.length === 0);

console.log('\n5. diet tags contradicted by the dish\'s own allergen tags (projects/diet-tag-check)');
const why = (d) => A.dietConflicts(d).map(c => `${c.tag}:${c.why}`).sort().join(',');
check('Picadillo Burrito: tagged vegan, allergen EGG -> vg:egg',
      why({ n: 'Plant-Forward Picadillo Burrito', i: 'plant-forward "beef" crumbles (pea protein, contains egg), flour tortilla',
            a: 'EGG, WHEAT', x: 'SOY', t: ['vg'] }) === 'vg:egg');
check('Korean tempeh: vegan with honey in the glaze -> vg:honey',
      why({ i: 'tempeh, glaze (gochujang, tamari, sugar, sesame oil, honey, water)', a: 'SESAME, SOY, WHEAT', t: ['vg'] }) === 'vg:honey');
check('vegetarian with EGG and MILK is fine', why({ i: 'meatless cutlet', a: 'EGG, MILK, WHEAT', t: ['v'] }) === '');
check('vegan with oat milk / plant-forward "beef" (no allergen tag) is fine',
      why({ i: 'potatoes, oat milk, vegan butter, plant-forward "beef" crumbles', a: '', t: ['gf', 'vg'] }) === '');
check('vegetarian with SHELLFISH -> v:shellfish', why({ i: 'noodles', a: 'SHELLFISH, WHEAT', t: ['v'] }) === 'v:shellfish');
check('gluten-free with WHEAT -> gf:wheat', why({ i: 'pasta', a: 'WHEAT', t: ['gf'] }) === 'gf:wheat');
check('honeydew, honeycrisp, vegan honey, agar are not honey/gelatin',
      why({ i: 'honeydew melon, honeycrisp apple, vegan honey, agar', a: '', t: ['vg', 'v'] }) === '');
check('shared-equipment field (x) is not a contradiction', why({ i: 'rice', a: '', x: 'EGG, MILK', t: ['vg'] }) === '');
check('untagged dish -> nothing', why({ i: 'honey, eggs', a: 'EGG', t: [] }) === '');
check('gelatin contradicts vegetarian too', why({ i: 'gelatin, sugar', a: '', t: ['v'] }) === 'v:gelatin');

console.log('\n6. pork, and R&DE\'s "non-halal" note (projects/pork-marker)');
const pk = (d) => { const r = A.porkNote(d); return r ? `${r.kind}:${r.phrase}` : null; };
check('pork named in ingredients', pk({ n: 'Carolina Pulled Pork', i: 'pork, apple cider vinegar', t: ['gf'] }) === 'pork:pork');
check('pork named only in the dish name', pk({ n: 'Ham Scramble', i: '', t: [] }) === 'pork:ham');
check('R&DE annotation on pork still reads as pork', pk({ n: 'Carnitas', i: '(non-halal) pork, onions', t: [] }) === 'pork:carnitas');
check('a vegan tag alone rules out pork words  [negative control]', pk({ n: 'Hongos Carnitas', i: 'mushrooms, achiote', t: ['vg'] }) === null);
check('lard in refried beans', pk({ n: 'Crispy Corn Tostada', i: '(non-halal) lard (in refried beans), corn', t: [] }) === 'pork:lard');
check('not halal without pork: chicken sausage, sheep casing',
  pk({ n: 'Chicken Apple Sausage', i: 'chicken, apples, (non-halal) sheep casing', t: [] }) === 'not-halal:non-halal');
check('"not halal" spelled out', pk({ n: 'Scramble', i: 'eggs, chicken apple sausage (not halal)', t: [] }) === 'not-halal:not halal');
check('a vegetarian dish keeps R&DE\'s note (wine)', pk({ n: 'Lemon Beurre Blanc', i: '(non-halal) dry white wine, butter', t: ['gf', 'v'] }) === 'not-halal:non-halal');
check('vegan "carnitas" is not pork  [negative control]', pk({ n: 'Jackfruit Carnitas', i: 'jackfruit, cumin', t: ['vg'] }) === null);
check('turkey bacon is not pork  [negative control]', pk({ n: 'Turkey Bacon', i: 'turkey thigh meat, sea salt', t: ['gf'] }) === null);
check('hamburger is not ham  [negative control]', pk({ n: 'Hamburger', i: 'beef patty, bun', t: [] }) === null);
check('graham crackers are not ham  [negative control]', pk({ n: 'Pie', i: 'graham cracker crust', t: [] }) === null);
check('gelatin claims nothing (no animal named)  [negative control]', pk({ n: 'Minestrone', i: 'pasta, gelatin, beef stock', t: [] }) === null);
check('plain "sausage" claims nothing  [negative control]', pk({ n: 'Sausage & Mushroom Pizza', i: 'pizza dough, sausage', t: [] }) === null);
check('R&DE\'s "(HALAL)" note is not "non-halal"  [negative control]', pk({ n: 'Steak', i: 'beef (HALAL), mushroom', t: [] }) === null);
check('empty dish', pk({}) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
