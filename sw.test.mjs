/* Tests for the service worker's fetch routing. Run: node sw.test.mjs
 *
 * The defect this pins: index.html was network-first but the logic scripts were
 * cache-first, so on the first visit after a deploy the NEW page ran against the PREVIOUS
 * deploy's url-state.js / cafes-logic.js. For the Rec deploy that meant a shared #v=rec
 * link opened the default view (old VIEWS has no 'rec'); a changed function signature
 * would have thrown. Anything that must agree with the page has to be as fresh as it.
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const check = (n, c, d = '') => c ? (pass++, console.log(`  ok   ${n}`))
                                  : (fail++, console.log(`  FAIL ${n}${d ? '  — ' + d : ''}`));

const ORIGIN = 'https://example.github.io/site/';

// A fresh worker per case: a cache holding the previous deploy, a network serving the next.
function worker({ online = true, keys = [] } = {}) {
  const store = new Map(), net = [], deleted = [];
  const key = r => (typeof r === 'string' ? new URL(r, ORIGIN).href : r.url);
  const cache = {
    put: async (r, res) => { store.set(key(r), res); },
    add: async () => {},
  };
  const listeners = {};
  const ctx = {
    self: { location: new URL(ORIGIN), addEventListener: (t, f) => { listeners[t] = f; },
            skipWaiting: () => {}, clients: { claim: () => {} } },
    caches: { open: async () => cache, keys: async () => keys, delete: async (k) => { deleted.push(k); return true; },
              match: async r => store.get(key(r)) },
    fetch: async r => {
      net.push(key(r));
      if (!online) throw new TypeError('offline');
      return { body: 'network', clone() { return this; } };
    },
    URL,
  };
  vm.runInNewContext(fs.readFileSync(path.join(HERE, 'sw.js'), 'utf8'), ctx);
  const get = async (p, mode = 'cors') => {
    let out = null;
    const req = { method: 'GET', url: new URL(p, ORIGIN).href, mode };
    listeners.fetch({ request: req, respondWith: x => { out = x; } });
    return out ? (await out)?.body : 'passthrough';
  };
  const activate = async () => { let p; listeners.activate({ waitUntil: (x) => { p = x; } }); await p; };
  return { store, net, get, deleted, activate };
}
const stale = (w, p) => w.store.set(new URL(p, ORIGIN).href, { body: 'cache', clone() { return this; } });

for (const js of ['url-state.js', 'cafes-logic.js', 'libraries-logic.js', 'saved-logic.js', 'walk-logic.js', 'allergen-check.js', 'avoid-logic.js', 'widget.js']) {
  const w = worker(); stale(w, js);
  check(`${js} online: the network copy, not the previous deploy's`, (await w.get(js)) === 'network');
}
{
  const w = worker({ online: false }); stale(w, 'url-state.js');
  check('url-state.js offline: falls back to the cached copy', (await w.get('url-state.js')) === 'cache');
}
for (const d of ['data/site.json', 'data/cafes.json', 'data/libraries.json', 'data/rec.json']) {
  const w = worker(); stale(w, d);
  check(`${d} online: network-first`, (await w.get(d)) === 'network');
}
{
  const w = worker(); stale(w, './');
  check('navigation online: network-first', (await w.get('./', 'navigate')) === 'network');
}
{
  const w = worker(); stale(w, 'icons/icon-192.png');
  check('icon: cache-first, no network round-trip',
        (await w.get('icons/icon-192.png')) === 'cache' && w.net.length === 0);
}
{
  const w = worker();
  check('cross-origin (CDN, tiles): not intercepted',
        (await w.get('https://cdnjs.cloudflare.com/x.js')) === 'passthrough');
}
{
  // Activation clears every cache but this deploy's. The mock used to list no caches at all,
  // so nothing could tell "delete the old ones" from "delete the current one".
  const VERSION = /const VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(HERE, 'sw.js'), 'utf8'))[1];
  const w = worker({ keys: ['dining-old-1', VERSION, 'dining-old-2'] });
  await w.activate();
  check('activate deletes the previous deploys\' caches, and keeps this one', JSON.stringify(w.deleted) === JSON.stringify(['dining-old-1', 'dining-old-2']), JSON.stringify(w.deleted));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
