/* Tests for hall pinning. Run: node pin-logic.test.mjs */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const P = require(path.join(HERE, 'pin-logic.js'));

let pass = 0, fail = 0;
const check = (n, c, d = '') => c ? (pass++, console.log(`  ok   ${n}`))
                                  : (fail++, console.log(`  FAIL ${n}${d ? '  — ' + d : ''}`));

const mem = () => { const m = new Map(); return {
  getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)),
  removeItem: k => m.delete(k), _m: m }; };

// storage round trip, and the empty set leaves no key behind
{
  const s = mem();
  P.save(s, new Set(['Wilbur', 'Stern']));
  const back = P.load(s);
  check('round trip keeps both halls', back.size === 2 && back.has('Wilbur') && back.has('Stern'));
  P.save(s, new Set());
  check('unpinning the last hall removes the key', !s._m.has(P.KEY));
}
// hostile or broken storage degrades to "nothing pinned", never a throw
{
  const s = mem(); s.setItem(P.KEY, '{not json');
  check('corrupt JSON -> empty', P.load(s).size === 0);
  s.setItem(P.KEY, '{"Wilbur":1}');
  check('non-array -> empty', P.load(s).size === 0);
  s.setItem(P.KEY, '["Wilbur", 3, null, ""]');
  const v = P.load(s);
  check('non-strings dropped', v.size === 1 && v.has('Wilbur'));
  const boom = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); },
                 removeItem() { throw new Error('x'); } };
  let ok = true;
  try { P.load(boom); P.save(boom, new Set(['a'])); P.save(boom, new Set()); } catch { ok = false; }
  check('blocked storage never throws', ok && P.load(boom).size === 0);
}
// toggle is pure
{
  const a = new Set(['Wilbur']);
  const b = P.toggle(a, 'Stern'), c = P.toggle(b, 'Wilbur');
  check('toggle adds', b.has('Stern') && b.has('Wilbur'));
  check('toggle removes', !c.has('Wilbur') && c.has('Stern'));
  check('toggle leaves the input alone', a.size === 1 && a.has('Wilbur'));
}
// the comparator, used the way index.html uses it: rank tier first, then pin, then name
{
  const pinned = new Set(['Wilbur']);
  const rows = [
    { n: 'Arrillaga', rank: 0 }, { n: 'Branner', rank: 0 }, { n: 'Wilbur', rank: 0 }, { n: 'Stern', rank: 0 },
  ];
  const sorted = rows.slice().sort((a, b) => (a.rank - b.rank) || P.cmp(pinned, a.n, b.n) || a.n.localeCompare(b.n));
  check('pinned hall first among equals', sorted[0].n === 'Wilbur', sorted.map(r => r.n).join(','));
  check('the rest stay alphabetical', sorted.slice(1).map(r => r.n).join(',') === 'Arrillaga,Branner,Stern');
  const tiered = [{ n: 'Wilbur', rank: 2 }, { n: 'Stern', rank: 0 }, { n: 'Arrillaga', rank: 0 }]
    .sort((a, b) => (a.rank - b.rank) || P.cmp(pinned, a.n, b.n) || a.n.localeCompare(b.n));
  check('a pin does not lift a hall above a better status tier', tiered[2].n === 'Wilbur', tiered.map(r => r.n).join(','));
  check('two pinned halls tie, so the name decides',
    P.cmp(new Set(['A', 'B']), 'A', 'B') === 0 && P.cmp(new Set(), 'A', 'B') === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
