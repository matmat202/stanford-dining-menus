/* Tests for the break-schedule overlay. Run: node holidays-logic.test.mjs
 * Against data/holidays.json, R&DE's 2026 Thanksgiving PDF transcribed from the rendered image.
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const L = require(path.join(HERE, 'holidays-logic.js'));
const CL = require(path.join(HERE, 'cafes-logic.js'));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  — ' + detail : ''}`); }
};
const read = f => { const p = path.join(HERE, 'data', f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
const H = read('holidays.json');
if (!H) { console.log('SKIP holidays-logic.test.mjs: data/holidays.json not here'); process.exit(0); }
const at = (y, mo, d, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi);
const shut = (key, t) => L.closure(H, key, t);

// --- the transcription joins to names the page actually has. A key that matches nothing
// would leave that venue saying "open" all break, silently.
let hallsPath = path.join(HERE, '..', 'halls.json');
if (!fs.existsSync(hallsPath)) hallsPath = path.join(HERE, 'halls.json');
const halls = JSON.parse(fs.readFileSync(hallsPath, 'utf8')).halls;
const cafes = read('cafes.json'), pay = read('pay.json');
const venues = new Set([...(cafes ? cafes.venues : []), ...(pay ? pay.venues.concat(pay.accepts) : [])].map(v => 'venue:' + CL.payKey(v.name)));
const known = k => {
  const [kind, name] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
  if (kind === 'hall') return !!halls[name];
  if (kind === 'late') return !!(halls[name] && halls[name].latenight);
  if (kind === 'venue') return venues.has('venue:' + CL.payKey(name));
  return false;
};
const allKeys = H.closed.flatMap(c => c.keys).concat(Object.keys(H.days));
const unknown = allKeys.filter(k => !known(k));
check(`every one of ${allKeys.length} keys names a hall, late-night service or venue we have`, unknown.length === 0, unknown.join(', '));
check('each closure starts before it ends', H.closed.every(c => c.from < c.until), JSON.stringify(H.closed.filter(c => c.from >= c.until)));
const hallIds = H.hall_hours.flatMap(r => r.ids);
check('hall_hours ids are halls.json ids', hallIds.every(id => halls[id]), hallIds.join(','));
const badDay = Object.values(H.days).flatMap(d => Object.entries(d)).filter(([k, v]) => !/^\d{4}-\d\d-\d\d$/.test(k) || (v !== null && !(v[0] < v[1])));
check('day tables: YYYY-MM-DD keys, open before close or null', badDay.length === 0, JSON.stringify(badDay));

// --- late night: closes after Thursday Nov 19's service, which runs into Friday 02:00
check('Arrillaga Nights still on at 01:00 Fri 11-20 (Thursday\'s service)', !shut('late:Arrillaga', at(2026, 11, 20, 1, 0)));
check('Arrillaga Nights closed at 22:00 Fri 11-20', !!shut('late:Arrillaga', at(2026, 11, 20, 22, 0)));
check('Arrillaga Nights closed Mon 11-30 22:00', !!shut('late:Arrillaga', at(2026, 11, 30, 22, 0)));
check('Arrillaga Nights back Tue 12-01 22:00', !shut('late:Arrillaga', at(2026, 12, 1, 22, 0)));
check('Lakeside Late Night closed Sat 11-28 22:00', !!shut('late:Lakeside', at(2026, 11, 28, 22, 0)));
check('Lakeside Late Night back Sun 11-29 22:00', !shut('late:Lakeside', at(2026, 11, 29, 22, 0)));
check('the café list\'s "Arrillaga Nights @ AFDC" row closes with it', !!shut('venue:Arrillaga Nights @ AFDC', at(2026, 11, 24, 22, 0)));

// --- halls
check('Stern serves Friday 11-20 dinner', !shut('hall:Stern', at(2026, 11, 20, 17, 0)));
const st = shut('hall:Stern', at(2026, 11, 21, 10, 30));
check('Stern closed Sat 11-21 brunch, reopens brunch Nov 28', st && st.reopens === 'brunch Nov 28' && st.label === 'Thanksgiving', JSON.stringify(st));
check('until is exclusive: Stern not closed at 00:00 Sat 11-28, its first minute back', !shut('hall:Stern', at(2026, 11, 28, 0, 0)));
check('from is inclusive: Stern closed at 00:00 Sat 11-21', !!shut('hall:Stern', at(2026, 11, 21, 0, 0)));
check('Stern open again Sat 11-28 brunch', !shut('hall:Stern', at(2026, 11, 28, 10, 30)));
check('Branner still closed Sun 11-29', !!shut('hall:Branner', at(2026, 11, 29, 12, 0)));
check('Branner open Mon 11-30 lunch', !shut('hall:Branner', at(2026, 11, 30, 11, 0)));
check('Arrillaga (AFDC) is never closed by the break', [21, 23, 26, 27].every(d => !shut('hall:Arrillaga', at(2026, 11, d, 12, 0))));
check('Lakeside is never closed by the break', [21, 23, 26, 27].every(d => !shut('hall:Lakeside', at(2026, 11, d, 18, 0))));
const hh = L.hallHours(H, 'Arrillaga', at(2026, 11, 23));
check('AFDC Mon 11-23: lunch ends 14:00 and dinner 20:00, not the regular 15:00 / 20:30', hh && hh.Lunch[1] === '14:00' && hh.Dinner[1] === '20:00', JSON.stringify(hh));
check('Lakeside Fri 11-27 has break hours too', !!L.hallHours(H, 'Lakeside', at(2026, 11, 27)));
check('AFDC Sat 11-21 and Sat 11-28 keep regular hours', !L.hallHours(H, 'Arrillaga', at(2026, 11, 21)) && !L.hallHours(H, 'Arrillaga', at(2026, 11, 28)));
check('Stern has no break hours row', !L.hallHours(H, 'Stern', at(2026, 11, 23)));

// --- cafés
const win = name => (pay.venues.find(v => v.name === name) || cafes.venues.find(v => v.name === name) || {}).windows || [];
const sajj = L.venueStatus(H, 'SAJJ Mediterranean', win('SAJJ Mediterranean'), at(2026, 11, 23, 12, 0));
check('SAJJ Mon 11-23 noon: closed for the day', !sajj.open && /Closed today/.test(sajj.holiday || ''), JSON.stringify(sajj));
const sb6 = L.venueStatus(H, 'Starbucks', win('Starbucks'), at(2026, 11, 26, 6, 0));
check('Starbucks Thanksgiving 06:00: shut, opens 7:30', !sb6.open && /7:30/.test(sb6.opensAt || ''), JSON.stringify(sb6));
const sb8 = L.venueStatus(H, 'Starbucks', win('Starbucks'), at(2026, 11, 26, 16, 30));
check('Starbucks Thanksgiving 16:30: open until 5', sb8.open && /^5/.test(sb8.until || ''), JSON.stringify(sb8));
const sbSat = L.venueStatus(H, 'Starbucks', win('Starbucks'), at(2026, 11, 21, 12, 0));
check('Starbucks Sat 11-21 (no row in the PDF): regular hours decide', JSON.stringify(sbSat) === JSON.stringify(CL.venueStatus(win('Starbucks'), at(2026, 11, 21, 12, 0))), JSON.stringify(sbSat));
const dec = L.venueStatus(H, 'Decadence', win('Decadence'), at(2026, 11, 26, 12, 0));
check('Decadence Thanksgiving: closed, reopens Nov 30', !dec.open && /reopens Nov 30/.test(dec.holiday || ''), JSON.stringify(dec));
check('Decadence Wed 11-25: regular hours', !L.venueStatus(H, 'Decadence', win('Decadence'), at(2026, 11, 25, 12, 0)).holiday);
check('R&DE\'s other spelling "Olives @ Bldg. 160" joins the closure', !!shut('venue:Olives @ Bldg. 160', at(2026, 11, 24, 12, 0)));
check('EVGR closed Sat 11-22 evening via its café-page name', !!L.venueStatus(H, 'EVGR Pub & Brewery', win('EVGR Pub & Brewery'), at(2026, 11, 22, 18, 0)).holiday);

// --- outside the break, and with no payload, nothing changes
const reg = win('The Med Café');
check('Med Café 11-12: same as CafeLogic', JSON.stringify(L.venueStatus(H, 'The Med Café', reg, at(2026, 11, 12, 12, 0))) === JSON.stringify(CL.venueStatus(reg, at(2026, 11, 12, 12, 0))));
check('no holidays.json: venueStatus is CafeLogic\'s', JSON.stringify(L.venueStatus(null, 'Decadence', win('Decadence'), at(2026, 11, 26, 12, 0))) === JSON.stringify(CL.venueStatus(win('Decadence'), at(2026, 11, 26, 12, 0))));
check('no holidays.json: no closure, no hall hours', L.closure(null, 'hall:Stern', at(2026, 11, 23)) === null && L.hallHours(undefined, 'Arrillaga', at(2026, 11, 23)) === null);
check('stamp uses local fields: 23:30 stays the same day', L.stamp(at(2026, 11, 20, 23, 30)) === '2026-11-20T23:30');

// --- two breaks in one file. holidays.json holds Thanksgiving alone today and runs out
// 2026-12-01; winter break is the next PDF R&DE posts. With one top-level label every
// winter closure read "Closed for Thanksgiving", so the label is resolved by DATE. These
// run against a synthetic two-break payload, because the shipped file has one break.
const TWO = {
  label: 'Thanksgiving',
  labels: [
    { from: '2026-11-20T00:00', until: '2026-12-01T00:00', label: 'Thanksgiving' },
    { from: '2026-12-12T00:00', until: '2027-01-04T00:00', label: 'winter break' },
  ],
  closed: [
    { keys: ['hall:Stern'], from: '2026-11-21T00:00', until: '2026-11-28T00:00', reopens: 'brunch Nov 28' },
    { keys: ['hall:Stern'], from: '2026-12-12T00:00', until: '2027-01-04T00:00', reopens: 'Jan 4' },
  ],
  days: { 'venue:Decadence': { '2026-12-14': null } },
};
const tg = L.closure(TWO, 'hall:Stern', at(2026, 11, 23));
check('two breaks: a November closure is still labelled Thanksgiving', tg && tg.label === 'Thanksgiving', JSON.stringify(tg));
const wb = L.closure(TWO, 'hall:Stern', at(2026, 12, 20));
check('two breaks: a December closure is labelled winter break, NOT Thanksgiving', wb && wb.label === 'winter break', JSON.stringify(wb));
check('two breaks: the December closure reopens Jan 4', wb && wb.reopens === 'Jan 4', JSON.stringify(wb));
const wd = L.venueStatus(TWO, 'Decadence', win('Decadence'), at(2026, 12, 14, 12, 0));
check('two breaks: a closed DAY is labelled winter break too (days, not just closed)', !wd.open && /winter break/.test(wd.holiday || ''), JSON.stringify(wd));
check('labelAt outside every range falls back to the single label', L.labelAt(TWO, at(2026, 6, 1)) === 'Thanksgiving');

// --- backward compatibility: a one-break file with no `labels` is unchanged
check('no labels: labelAt answers with the single label', L.labelAt(H, at(2026, 11, 23)) === 'Thanksgiving');
check('no labels at all: labelAt is null, so callers keep their own default', L.labelAt({}, at(2026, 11, 23)) === null);
check('no payload: labelAt is null', L.labelAt(null, at(2026, 11, 23)) === null);
const noLabel = { closed: [{ keys: ['hall:Stern'], from: '2026-11-21T00:00', until: '2026-11-28T00:00', reopens: 'x' }] };
check("a file with no label still says 'break', not 'undefined'", L.closure(noLabel, 'hall:Stern', at(2026, 11, 23)).label === 'break');
const noLabelDay = { days: { 'venue:Decadence': { '2026-11-23': null } } };
check("a labelless closed day still says 'the break', not 'undefined'",
  /Closed today for the break/.test(L.venueStatus(noLabelDay, 'Decadence', win('Decadence'), at(2026, 11, 23, 12, 0)).holiday || ''));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
