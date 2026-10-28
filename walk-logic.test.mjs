/* Tests for walking-time reachability. Run: node walk-logic.test.mjs */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const W = require(path.join(HERE, 'walk-logic.js'));

let pass = 0, fail = 0;
const check = (n, c, d = '') => c ? (pass++, console.log(`  ok   ${n}`))
                                  : (fail++, console.log(`  FAIL ${n}${d ? '  — ' + d : ''}`));
const open = left => ({ k: 'open', txt: '', left });

console.log('\n1. minutes and labels');
check('571 m is 10 min (571*1.40/80)', W.minutes(571) === 10, String(W.minutes(571)));
check('572 m rounds up to 11', W.minutes(572) === 11);
check('the detour is the measured 1.40, not 1.25', W.DETOUR === 1.40 && W.SPEED === 80, `${W.DETOUR}/${W.SPEED}`);
check('standing at the door is 1 min, not 0', W.minutes(0) === 1);
check('label in minutes', W.label(400) === '7 min walk', W.label(400));
check('label at the walkable limit stays minutes', W.label(2000).endsWith('min walk'));
check('label past it switches to km', W.label(2400) === '2.4 km', W.label(2400));

console.log('\n2. reach');
check('no location -> no verdict', W.reach(open(30), null) === null);
check('shut hall -> no verdict', W.reach({ k: 'shut', txt: '' }, 300) === null);
check('open without left -> no verdict', W.reach({ k: 'open', txt: '' }, 300) === null);
check('closes in 5, 10 min away -> late', W.reach(open(5), 571).k === 'late');
check('closes in 10, 10 min away -> tight, 0 left', W.reach(open(10), 571).txt === '~0 min left when you arrive',
      W.reach(open(10), 571).txt);
check('closes in 19, 10 min away -> tight', W.reach(open(19), 571).k === 'tight');
check('closes in 20, 10 min away -> ok', W.reach(open(20), 571).k === 'ok');
check('carries the walk', W.reach(open(60), 571).walk === 10);

console.log('\n3. rank');
const late = W.reach(open(5), 571), ok = W.reach(open(60), 571);
check('reachable open first', W.rank(open(60), ok) === 0);
check('open with no location still first', W.rank(open(60), null) === 0);
check('tight is still reachable', W.rank(open(15), W.reach(open(15), 571)) === 0);
check('late sorts after soon', W.rank(open(5), late) > W.rank({ k: 'soon' }, null));
check('late sorts before shut', W.rank(open(5), late) < W.rank({ k: 'shut' }, null));

console.log('\n4. wiring');
const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(HERE, 'sw.js'), 'utf8');
// publish.sh lives only in the sandbox; the public repo (and the CI backstop's checkout
// of it) runs this file without it, so the wiring check is the sandbox's alone.
const pubPath = path.join(HERE, '..', 'publish.sh');
const pub = fs.existsSync(pubPath) ? fs.readFileSync(pubPath, 'utf8') : null;
check('index.html loads walk-logic.js', html.includes('<script src="walk-logic.js"></script>'));
check('statusFor reports minutes left when open', /k:'open',[^}]*left[,}]/.test(html));
check('hall sort uses WalkLogic.rank', html.includes('WalkLogic.rank('));
check('service worker precaches it', sw.includes("'./walk-logic.js'"));
if (pub !== null) check('publish.sh copies it', /cp [^\n]*(\\\n[^\n]*)*walk-logic\.js/.test(pub));

// bin/mutate 2026-10-26: WALKABLE could be 2001 and no check noticed; and reach's contract
// is that only an OPEN status gets a verdict, whatever else a status carries.
check('2001 m is already km', W.label(2001) === '2.0 km', W.label(2001));
check('a status that is not open gets no verdict even if it carries left', W.reach({ k: 'soon', txt: '', left: 30 }, 300) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
