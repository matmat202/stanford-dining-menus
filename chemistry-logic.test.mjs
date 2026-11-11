/* Tests for the in-the-pan chemistry notes. Run: node chemistry-logic.test.mjs [--plant NAME]
 * Plants (each must turn a check red): nobound (drops \b, so chard reads as charred),
 * noorder (general rules before specific), nomax (no cap on notes). */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const C = require(path.join(HERE, 'chemistry-logic.js'));

const plant = process.argv.includes('--plant') ? process.argv[process.argv.indexOf('--plant') + 1] : null;
if (plant === 'nobound') {
  let n = 0;
  C.RULES.forEach(r => { const s = r.re.source.replace(/\\b/g, ''); if (s !== r.re.source) n++; r.re = new RegExp(s); });
  if (!n) throw new Error('plant nobound matched nothing');
} else if (plant === 'noorder') {
  const before = C.RULES.map(r => r.id).join();
  C.RULES.reverse();
  if (C.RULES.map(r => r.id).join() === before) throw new Error('plant noorder matched nothing');
} else if (plant === 'nomax') {
  C.MAX = 99;
  const src = fs.readFileSync(path.join(HERE, 'chemistry-logic.js'), 'utf8');
  if (!/out\.length >= MAX/.test(src)) throw new Error('plant nomax matched nothing');
} else if (plant) throw new Error('unknown plant ' + plant);
// nomax has to reach the closure's MAX; re-evaluate the module with the cap lifted.
const notesFor = plant === 'nomax'
  ? (() => { const m = { exports: {} };
      new Function('module', fs.readFileSync(path.join(HERE, 'chemistry-logic.js'), 'utf8')
        .replace('const MAX = 2;', 'const MAX = 99;'))(m); return m.exports.notesFor; })()
  : C.notesFor;

let pass = 0, fail = 0;
const check = (n, c, d = '') => c ? (pass++, console.log(`  ok   ${n}`))
                                  : (fail++, console.log(`  FAIL ${n}${d ? '  — ' + d : ''}`));
const ids = s => notesFor(s).map(x => x.id).join(',');

console.log('\n1. the cooking word picks the chemistry');
check('seared salmon -> maillard', ids('Pan-Seared Salmon') === 'maillard', ids('Pan-Seared Salmon'));
check('Sautéed (accent) -> maillard', ids('Sautéed Chorizo Sausage') === 'maillard,cure', ids('Sautéed Chorizo Sausage'));
check('Sauteed (no accent) -> maillard', ids('Sauteed Greens') === 'maillard', ids('Sauteed Greens'));
check('braised short ribs -> braise', ids('Braised Short Ribs') === 'braise', ids('Braised Short Ribs'));
check('pickled onions -> pickle', ids('Pickled Red Onions') === 'pickle');
check('kimchi fried rice -> fried then ferment', ids('Kimchi Fried Rice') === 'fried,ferment', ids('Kimchi Fried Rice'));
check('crème brûlée -> caramel then custard', ids('Crème Brûlée') === 'caramel,custard', ids('Crème Brûlée'));
check('steamed dumplings -> steam once', ids('Steamed Pork Dumplings') === 'steam', ids('Steamed Pork Dumplings'));
check('tater tots -> fried', ids('Tater Tots') === 'fried');

console.log('\n2. whole words only');
check('chard is not charred', ids('Garlic Swiss Chard') === '', ids('Garlic Swiss Chard'));
check('charcuterie is not charred', ids('Charcuterie Board') === '', ids('Charcuterie Board'));
check('hamburger is not ham', ids('Classic Hamburger') === '', ids('Classic Hamburger'));
check('cream is not crème', ids('Cream of Mushroom Soup') === '', ids('Cream of Mushroom Soup'));
check('roasted still hits inside a longer name', ids('Roasted Red Pepper Hummus') === 'maillard');
check('a plain name says nothing', ids('Seasonal Fruit') === '' && notesFor('').length === 0 && notesFor(null).length === 0);

console.log('\n3. specific before general');
check('hard boiled eggs get the iron-sulfide note, not the generic egg one',
      ids('Hard Boiled Eggs') === 'hardboil', ids('Hard Boiled Eggs'));
check('buttermilk pancakes: the acid-base note leads, generic leavening second',
      ids('Buttermilk Pancakes') === 'buttermilk,leaven', ids('Buttermilk Pancakes'));
check('caramelized onions: caramel, and no repeated browning note',
      ids('Caramelized Onions') === 'caramel', ids('Caramelized Onions'));
// "Caramelized Onions" matches caramel alone, so it never reaches the de-duplication at all
// and pins nothing about it. A name that fires BOTH browning rules is what tests the rule
// (mutation-audit 2026-11-11: without this, `out.length === 2` and `out[0]` both survive).
check('caramelized AND roasted: the second browning note is dropped',
      ids('Caramelized Roasted Onions') === 'caramel', ids('Caramelized Roasted Onions'));
check('blackened catfish: char before the general maillard',
      ids('Blackened Grilled Catfish') === 'char,maillard', ids('Blackened Grilled Catfish'));

console.log('\n4. at most two notes, in rule order');
const busy = 'Smoked Glazed Braised Grilled Pickled Pork';
check('five words, two notes', notesFor(busy).length === 2, String(notesFor(busy).length));
check('the two are the first two rules that match', ids(busy) === 'maillard,braise', ids(busy));

console.log('\n5. every note is a real sentence pair');
check('every rule has a note ending in a full stop', C.RULES.every(r => /\.$/.test(r.note)));
check('rule ids are unique', new Set(C.RULES.map(r => r.id)).size === C.RULES.length);

console.log('\n6. coverage on a pinned day: every dish name served 2026-11-04, inline so the public repo can run it');
const names = ["7 Cheesy Mac", "All Beef Hot Dog", "Allergen Friendly Pizza Station", "Allergen-Friendly Pasta Station", "Allergy Friendly Burger Bar", "Assorted Allergy-Friendly Items", "Assorted Dinner Rolls", "Balsamic Roasted Peppers & Onions", "Belgian Waffles", "Beyond Italian Sausage & Peppers", "Bok Choy & Shiitake Stir-Fry", "Breaded Onion Rings", "Breakfast Taco Bar", "Bulgogi Tofu", "Burger Bar", "Buttermilk Pancakes", "Caesar Salad", "Cantonese-Style Char Siu Pork", "Cheesy Mushroom & Herb Polenta", "Chef's Choice Overnight Oats", "Chef's Choice Smoothie", "Chicken Bulgogi", "Chicken Tikka Masala", "Composed Salad", "Craveable Grains", "Creamed Corn", "Creamy Pesto", "Crispy Fried \"Chick'n\" Tenders", "Crunchy Miso Sesame Ginger Salad", "Egg Roll", "Eggplant Parmesan", "Fettuccini Alfredo", "Five Spice Chicken", "Flavor Forward Legumes", "Fried Chicken Wings", "Garlic & Herb Roasted Potatoes", "Garlic Bread", "Garlic Green Peas", "Garlic Mashed Potatoes", "Gluten-Free Waffles", "Grilled Cheese & Tomato Basil Soup", "Grilled Chicken", "Grilled Teriyaki Chicken Protein Bowl", "Grilled Tri Tip", "Grilled Vegan/Vegetarian", "Handmade Pizza", "Hard Boiled Eggs", "Huevos a la Mexicana", "Impossible Burger", "Italian Herb-Crusted Chicken Cutlets", "Italian Sausage & Peppers", "Japanese Eggplant with Miso Glaze", "Japanese Potato Salad", "Japanese Tofu with Red Beans", "Japchae Glass Noodles", "Korean Spicy Cucumber Salad", "Lemon Herbed Chicken", "Lemon Lentil Soup", "Lemon Oregano Chicken", "Marry Me Gnocchi & Sauteed Kale", "Meat Lovers' Breakfast Burrito", "Miso Black Cod", "Nacho Bar", "Panini Station", "Panini Station (Branner)", "Pasta Alfredo", "Pasta Marinara", "Penne Pasta (Gluten-Free)", "Performance Bar", "Pesto Chicken Pizza", "Plant-Forward Picadillo Burrito", "Plant-Forward Tenders", "Purple Rice", "Red Lentil & Cauliflower Curry", "Roasted Green Beans", "Roasted Zucchini & Cherry Tomatoes", "Sauteed Garlic Broccolini", "Sauteed Green Beans", "Sautéed Chorizo Sausage", "Scrambled Eggs", "Seasonal Fruit", "Seasonal Roasted Vegetables", "Seasonal Steamed Vegetables", "Seasonal Vegetable Board", "Seasoned Rice Noodles with Veggies", "Sesame-Roasted Bok Choy", "Soup of the Day", "Steamed Japanese Rice", "Steamed Jasmine Rice", "Steamed Rice", "Steel Cut Oatmeal", "Sweet & Sour Braised Chicken", "Tasty Tofu Scramble", "Tater Tots", "Tator Tots", "Teriyaki Glazed Chick'n Strips", "Tomato Soup with Grilled Cheese", "Tteokbokki", "Vietnamese Lemongrass Beef", "Vietnamese Lemongrass Tofu", "Waffles", "Wakame Salad", "Warm Garlic Naan", "Wild Rice & Mushroom Pilaf"];
const hit = names.filter(n => notesFor(n).length);
// The measurement that justified the feature was 23% over the whole archive. A day under
// 15% means the rules have rotted, not that it was a quiet day.
check(`>=15% of that day's ${names.length} dishes get a note (${hit.length})`, names.length === 104 && hit.length >= 0.15 * names.length,
      `${(100 * hit.length / names.length).toFixed(0)}%`);
check('and not every dish (a rule matching everything would pass the line above)', hit.length < names.length * 0.6,
      `${hit.length}/${names.length}`);

console.log('\n7. wired into the site');
const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(HERE, 'sw.js'), 'utf8');
const pubPath = path.join(HERE, '..', 'publish.sh');
const pub = fs.existsSync(pubPath) ? fs.readFileSync(pubPath, 'utf8') : null;
check('index.html loads chemistry-logic.js', html.includes('<script src="chemistry-logic.js"></script>'));
check('the dish detail calls ChemistryLogic.notesFor', html.includes('ChemistryLogic.notesFor('));
check('service worker precaches it', sw.includes("'./chemistry-logic.js'"));
if (pub !== null) check('publish.sh copies it', /cp [^\n]*(\\\n[^\n]*)*chemistry-logic\.js/.test(pub));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
