/* Tests for the avoid-list matcher. Run: node avoid-logic.test.mjs
 *
 * Pins three things: a term hides dishes that name it only in their ingredients; it
 * hides on whole words, never inside another word (egg/eggplant, ham/graham); and the
 * stored list survives junk in localStorage. Section 4 runs against the live payload.
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const A = require(path.join(HERE, 'avoid-logic.js'));

let pass = 0, fail = 0;
const check = (n, c, d = '') => c ? (pass++, console.log(`  ok   ${n}`))
                                  : (fail++, console.log(`  FAIL ${n}${d ? '  — ' + d : ''}`));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('1. parse');
check('commas, semicolons, newlines, case, plurals', eq(A.parse('Mushrooms, cilantro;\nBell Peppers'), ['mushroom', 'cilantro', 'bell pepper']));
check('duplicates and blanks dropped', eq(A.parse(' onion ,, Onions , '), ['onion']));
check('accents folded', eq(A.parse('Jalapeño'), ['jalapeno']));
check('empty -> []', eq(A.parse(''), []) && eq(A.parse(null), []));
check('capped at 30 terms', A.parse(Array.from({ length: 50 }, (_, i) => 'w' + i).join(',')).length === 30);

console.log('2. hits: ingredients count, whole words only');
const T = A.parse('mushroom, egg, ham, cilantro, bell pepper, corn');
const hit = (n, i) => A.hits(T, n, i);
check('named only in ingredients', eq(hit('Beef Stroganoff', 'beef, mushrooms, sour cream'), ['mushroom']));
check('named in the dish name', eq(hit('Mushroom Risotto', 'arborio rice'), ['mushroom']));
check('egg does not hide Eggplant Parmesan', eq(hit('Eggplant Parmesan', 'eggplant, marinara'), []));
check('egg hides scrambled eggs', eq(hit('Scrambled Eggs', 'eggs, salt'), ['egg']));
check('ham does not hide graham / hamburger / shallot', eq(hit('Hamburger', 'graham crumbs, shallots'), []));
check('corn does not hide cornstarch', eq(hit('Stir Fry', 'cornstarch, soy sauce'), []));
check('corn hides corn oil (the user said corn)', eq(hit('Fries', 'potatoes, corn oil'), ['corn']));
check('phrase: bell pepper, plural in data', eq(hit('Fajitas', 'onions, red bell peppers'), ['bell pepper']));
check('phrase does not match across a missing word', eq(hit('Steak', 'bell, black pepper'), []));
check('punctuation is a boundary: (cilantro)', eq(hit('Salsa', 'tomato,(cilantro)lime'), ['cilantro']));
check('several terms, list order', eq(hit('Omelette', 'eggs, mushrooms'), ['mushroom', 'egg']));
check('no terms -> nothing hidden', eq(A.hits([], 'Mushroom Soup', 'mushrooms'), []));
check('missing ingredients field is fine', eq(A.hits(['mushroom'], 'Mushroom Soup', undefined), ['mushroom']));

console.log('3. load / save');
const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
const st = mem();
A.save(st, ['mushroom', 'cilantro']);
check('round trip', eq(A.load(st), ['mushroom', 'cilantro']));
A.save(st, []);
check('empty list removes the key', !st.m.has(A.KEY));
st.setItem(A.KEY, '{not json');
check('corrupt JSON -> []', eq(A.load(st), []));
st.setItem(A.KEY, '"mushroom"');
check('non-array JSON -> []', eq(A.load(st), []));
st.setItem(A.KEY, JSON.stringify(['Mushrooms', '', 'mushroom']));
check('stored values re-parsed', eq(A.load(st), ['mushroom']));
const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
check('blocked storage: load -> []', eq(A.load(throwing), []));
let threw = false; try { A.save(throwing, ['x']); } catch { threw = true; }
check('blocked storage: save does not throw', !threw);

console.log('4. live payload');
const site = JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'site.json'), 'utf8'));
const D = site.dishes;
const t = A.tally(A.parse('mushroom'), D);
// The probe's regex (/mushroom/i over name+ingredients) found 41; whole-word with plurals must find them all.
const rx = D.filter(d => /mushroom/i.test(d.n + ' ' + d.i)).length;
check(`mushroom: whole-word count (${t.hidden}) equals the substring count (${rx})`, t.hidden === rx && rx > 0);
const onlyIngr = D.filter(d => A.hits(['mushroom'], '', d.i).length && !A.hits(['mushroom'], d.n, '').length).length;
check(`mushroom: most hits come from ingredients only (${onlyIngr} of ${t.hidden})`, onlyIngr * 2 > t.hidden);
const egg = A.tally(['egg'], D).hidden, eggSub = D.filter(d => /egg/i.test(d.n + ' ' + d.i)).length;
// Substring "egg" also sits inside eggplant and veggie(s); on 10/23 that was 6 + 4 dishes a
// substring test would have hidden from someone who only skips eggs.
const falseEgg = D.filter(d => /egg/i.test(d.n + ' ' + d.i) && !/\beggs?\b/i.test(d.n + ' ' + d.i)).length;
check(`egg: eggplant/veggie-only dishes (${falseEgg}) are not hidden (${egg} = ${eggSub} - ${falseEgg})`, egg === eggSub - falseEgg && falseEgg > 0);
const two = A.tally(A.parse('mushroom, cilantro'), D);
check('tally: hidden counts dishes once even when two terms hit', two.hidden <= two.counts.mushroom + two.counts.cilantro && two.hidden >= Math.max(two.counts.mushroom, two.counts.cilantro));

// bin/mutate 2026-10-26: counts started at 1 survived, so a term that hides nothing would say "hides 1".
const fx = [{ n: 'Mushroom Soup', i: 'mushrooms, onion' }, { n: 'Rice', i: '' }, { n: 'Onion Rings', i: 'onion' }];
const tz = A.tally(['mushroom', 'onion', 'cilantro'], fx);
check('tally: exact per-term counts, and a term that hides nothing reads 0',
  tz.hidden === 2 && tz.counts.mushroom === 1 && tz.counts.onion === 2 && tz.counts.cilantro === 0, JSON.stringify(tz));
check('hits: no list at all is nothing, not a crash', eq(A.hits(null, 'Mushroom Soup', 'mushrooms'), []));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
