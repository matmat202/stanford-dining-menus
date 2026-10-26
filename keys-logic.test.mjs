/* Tests for keyboard focus/shortcut logic. Run: node keys-logic.test.mjs
 * The rendered check (focus really survives render() in a browser) is
 * state/scratch/kbd-probe/focus.cjs; this pins the decisions.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const K = require(path.join(HERE, 'keys-logic.js'));

let pass = 0, fail = 0;
const check = (n, c, d = '') => c ? (pass++, console.log(`  ok   ${n}`))
                                  : (fail++, console.log(`  FAIL ${n}${d ? '  — ' + d : ''}`));

// A tiny fake DOM: containers by id, each holding buttons; closest('#id') walks up.
function fakeDoc(spec) {
  const doc = { activeElement: null, boxes: {} };
  for (const [id, n] of Object.entries(spec)) {
    const box = { id, kids: [] };
    box.querySelectorAll = () => box.kids;
    for (let i = 0; i < n; i++) {
      const b = { tagName: 'BUTTON', i, box };
      b.closest = sel => (sel === '#' + id ? box : null);
      b.focus = () => { doc.activeElement = b; };
      box.kids.push(b);
    }
    doc.boxes[id] = box;
  }
  doc.getElementById = id => doc.boxes[id] || null;
  return doc;
}

// focusSlot / restoreFocus
{
  const doc = fakeDoc({ days: 7, meals: 3 });
  const s = K.focusSlot(doc.boxes.days.kids[2]);
  check('slot names container and position', s && s.id === 'days' && s.index === 2, JSON.stringify(s));
  // render() replaces the buttons: a fresh set, nothing focused
  const doc2 = fakeDoc({ days: 7, meals: 3 });
  check('restore moves focus into the rebuilt slot', K.restoreFocus(s, doc2) && doc2.activeElement === doc2.boxes.days.kids[2]);
  check('restore clamps when the list shrank', K.restoreFocus({ id: 'meals', index: 5 }, fakeDoc({ meals: 2 })) === true);
  const d3 = fakeDoc({ meals: 2 }); K.restoreFocus({ id: 'meals', index: 5 }, d3);
  check('clamped focus lands on the last button', d3.activeElement === d3.boxes.meals.kids[1]);
  check('no slot -> no-op', K.restoreFocus(null, doc2) === false);
  check('missing container -> no-op', K.restoreFocus({ id: 'views', index: 0 }, doc2) === false);
  check('empty container -> no-op', K.restoreFocus({ id: 'days', index: 0 }, fakeDoc({ days: 0 })) === false);
  const outside = { tagName: 'A', closest: () => null };
  check('focus outside rebuilt containers -> null', K.focusSlot(outside) === null);
  check('no active element -> null', K.focusSlot(null) === null);
  check('every rebuilt container is covered', ['days', 'meals', 'views', 'drawer'].every(x => K.REBUILT.includes(x)));
}

// action()
{
  const body = { tagName: 'BODY', closest: () => null };
  const q = { tagName: 'INPUT', id: 'q', closest: () => null };
  const other = { tagName: 'INPUT', id: 'x', closest: () => null };
  const inMap = { tagName: 'DIV', closest: s => (s === '#map' ? {} : null) };
  const ev = (key, target, mods = {}) => ({ key, target, ...mods });
  const a = (...x) => JSON.stringify(K.action(ev(...x)));
  check('/ focuses search', a('/', body) === '{"type":"search"}');
  check('/ while typing is a slash', K.action(ev('/', q)) === null);
  check('Esc in search clears', a('Escape', q) === '{"type":"clear"}');
  check('Esc elsewhere does nothing', K.action(ev('Escape', body)) === null);
  check('Right -> next day', a('ArrowRight', body) === '{"type":"day","delta":1}');
  check('Left -> previous day', a('ArrowLeft', body) === '{"type":"day","delta":-1}');
  check('arrows in a text field move the caret', K.action(ev('ArrowLeft', other)) === null);
  check('arrows in the map pan the map', K.action(ev('ArrowRight', inMap)) === null);
  check('Ctrl/Alt/Meta+arrow belong to the browser',
    ['ctrlKey', 'altKey', 'metaKey'].every(m => K.action(ev('ArrowLeft', body, { [m]: true })) === null));
  check('Shift+arrow is left alone (text selection)', K.action(ev('ArrowRight', body, { shiftKey: true })) === null);
  check('IME composition is ignored', K.action(ev('/', body, { isComposing: true })) === null);
  check('already-handled events are ignored', K.action(ev('/', body, { defaultPrevented: true })) === null);
  check('contenteditable counts as typing', K.isEditable({ tagName: 'DIV', isContentEditable: true }));
  check('select counts as typing', K.isEditable({ tagName: 'SELECT' }));
  check('other keys do nothing', K.action(ev('a', body)) === null);
}

// stepDay()
check('step forward', K.stepDay(2, 1, 7) === 3);
check('step back', K.stepDay(2, -1, 7) === 1);
check('clamp at first day -> null', K.stepDay(0, -1, 7) === null);
check('clamp at last day -> null', K.stepDay(6, 1, 7) === null);
check('single-day payload never moves', K.stepDay(0, 1, 1) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
