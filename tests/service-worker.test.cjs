const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
function harness(failedURL) {
  const handlers = new Map(), caches = new Map(), deleted = [], fetched = [];
  let activated = 0;
  const key = request => typeof request === 'string' ? request : request.url;
  function cache(name) {
    if (!caches.has(name)) caches.set(name, new Map());
    const entries = caches.get(name);
    return {
      async add(url) { if (url === failedURL) throw new Error('Download failed'); entries.set(url, new Response('cached')); },
      async match(request) { const value = entries.get(key(request)); return value?.clone(); },
      async put(request, response) { entries.set(key(request), response.clone()); },
      async keys() { return Array.from(entries.keys()); },
      async delete(request) { return entries.delete(key(request)); }
    };
  }
  const context = vm.createContext({ Response, AbortController, setTimeout, clearTimeout,
    console: { warn() {}, info() {} },
    caches: { open: async name => cache(name), keys: async () => Array.from(caches.keys()),
      delete: async name => { deleted.push(name); return caches.delete(name); },
      match: async request => { for (const name of caches.keys()) { const hit = await cache(name).match(request); if (hit) return hit; } } },
    fetch: async request => { fetched.push(key(request)); return new Response('network'); },
    self: { addEventListener: (name,callback) => handlers.set(name,callback),
      skipWaiting: async () => { activated++; }, clients: { claim: async () => {}, matchAll: async () => [] } }
  });
  vm.runInContext(source, context);
  async function event(name, request) {
    const work = []; let response;
    handlers.get(name)({ request, waitUntil: promise => work.push(promise), respondWith: promise => { response = promise; } });
    const result = response ? await response : undefined;
    await Promise.all(work); return result;
  }
  return { context, caches, cache, deleted, fetched, event, activated: () => activated };
}
test('the app shell and offline module are cached with the same version', async () => {
  const h = harness(); await h.event('install');
  assert.ok(await h.cache('lignum-app-v13.40').match('/offline.js')); assert.equal(h.activated(), 1);
  assert.match(fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'), /app-version" content="13\.40"/);
});
test('a failed required offline-module download keeps the previous worker active', async () => {
  const h = harness('/offline.js'); await assert.rejects(h.event('install'), /Download failed/);
  assert.equal(h.activated(), 0);
});
test('optional export-library failure does not block an otherwise complete offline app', async () => {
  const h = harness('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
  await h.event('install'); assert.equal(h.activated(), 1);
});
test('activation preserves protected offline maps and unrelated application caches', async () => {
  const h = harness(); for (const name of ['lignum-app-v13.39','lignum-app-v13.40','lignum-sat-offline-v1','lignum-osm-offline-v1','other-app']) h.cache(name);
  await h.event('activate'); assert.deepEqual(h.deleted, ['lignum-app-v13.39']);
});
test('manually saved map tiles are returned without a network request', async () => {
  const h = harness(), url = 'https://server.arcgisonline.com/tiles/18/1/2';
  await h.cache('lignum-sat-offline-v1').put(url, new Response('protected'));
  const response = await h.event('fetch', new Request(url)); assert.equal(await response.text(), 'protected'); assert.equal(h.fetched.length, 0);
});
test('Supabase responses are never stored in the app cache', async () => {
  const h = harness(); await h.event('fetch', new Request('https://test.supabase.co/rest/v1/markers'));
  assert.equal(h.caches.size, 0);
});
test('cached tiles stay available and background updates finish within the event lifetime', async () => {
  const h = harness(), url = 'https://a.tile.openstreetmap.org/10/1/2.png';
  await h.cache('lignum-tiles-v5').put(url, new Response('old tile'));
  const response = await h.event('fetch', new Request(url)); assert.equal(await response.text(), 'old tile');
  assert.equal(await (await h.cache('lignum-tiles-v5').match(url)).text(), 'network');
});
