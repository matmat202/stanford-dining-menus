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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
