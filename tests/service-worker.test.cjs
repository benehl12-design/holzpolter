const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
function harness(failedURL, scope = 'https://lignum.test/') {
  const handlers = new Map(), caches = new Map(), deleted = [], fetched = [];
  let activated = 0, offline = false;
  const key = request => new URL(typeof request === 'string' ? request : request.url, scope).href;
  function cache(name) {
    if (!caches.has(name)) caches.set(name, new Map());
    const entries = caches.get(name);
    return {
      async add(url) { if (failedURL && key(url) === key(failedURL)) throw new Error('Download failed'); entries.set(key(url), new Response('cached')); },
      async match(request) { const value = entries.get(key(request)); return value?.clone(); },
      async put(request, response) { entries.set(key(request), response.clone()); },
      async keys() { return Array.from(entries.keys()); },
      async delete(request) { return entries.delete(key(request)); }
    };
  }
  const context = vm.createContext({ Response, AbortController, URL, setTimeout, clearTimeout,
    console: { warn() {}, info() {} },
    caches: { open: async name => cache(name), keys: async () => Array.from(caches.keys()),
      delete: async name => { deleted.push(name); return caches.delete(name); },
      match: async request => { for (const name of caches.keys()) { const hit = await cache(name).match(request); if (hit) return hit; } } },
    fetch: async request => { fetched.push(key(request)); if (offline) throw new Error('Offline'); return new Response('network'); },
    self: { addEventListener: (name,callback) => handlers.set(name,callback),
      registration: { scope },
      skipWaiting: async () => { activated++; }, clients: { claim: async () => {}, matchAll: async () => [] } }
  });
  vm.runInContext(source, context);
  async function event(name, request) {
    const work = []; let response;
    handlers.get(name)({ request, waitUntil: promise => work.push(promise), respondWith: promise => { response = promise; } });
    const result = response ? await response : undefined;
    await Promise.all(work); return result;
  }
  return { context, caches, cache, deleted, fetched, event, activated: () => activated, goOffline: () => { offline = true; } };
}
test('the app shell and offline module are cached with the same version', async () => {
  const h = harness(); await h.event('install');
  assert.ok(await h.cache('lignum-app-v13.58').match('/offline.js')); assert.equal(h.activated(), 1);
  assert.ok(await h.cache('lignum-app-v13.58').match('/forwarder-icon.png'));
  for(const url of ['/forest-harvest-rules.js','/forest-model.js','/forest-raster-data.js', '/forest-raster-worker.js','/forest-planning.js','/forest-planning.css','/vendor/proj4-2.11.0.js','/vendor/polygon-clipping-0.15.7.js'])assert.ok(await h.cache('lignum-app-v13.58').match(url));
  assert.match(fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'), /app-version" content="13\.58"/);
});
test('a failed required module or machine-icon download keeps the previous worker active', async () => {
  for (const url of ['/offline.js','/forwarder-icon.png','/forest-model.js','/forest-raster-data.js', '/forest-raster-worker.js','/forest-planning.js','/forest-planning.css','/vendor/proj4-2.11.0.js','/vendor/polygon-clipping-0.15.7.js']) {
    const h = harness(url); await assert.rejects(h.event('install'), /Download failed/);
    assert.equal(h.activated(), 0);
  }
});
test('GitHub Pages installs and launches the app within its repository directory', async () => {
  const scope = 'https://lignum.test/holzpolter/', h = harness(undefined, scope);
  await h.event('install');
  const cache = h.cache('lignum-app-v13.58'), urls = await cache.keys();
  assert.ok(urls.some(url => url === scope + 'forest-raster-worker.js'));
  assert.ok(urls.filter(url => new URL(url).origin === new URL(scope).origin).every(url => url.startsWith(scope)));
  assert.ok(urls.includes('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'));
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
  assert.equal(new URL(manifest.start_url, scope + 'manifest.json').href, scope);
  assert.equal(new URL(manifest.scope, scope + 'manifest.json').href, scope);
});
test('a missing required module under the GitHub Pages directory blocks installation', async () => {
  const scope = 'https://lignum.test/holzpolter/', h = harness(scope + 'forest-raster-worker.js', scope);
  await assert.rejects(h.event('install'), /Download failed/);
  assert.equal(h.activated(), 0);
});
test('offline navigation under GitHub Pages returns the cached app shell', async () => {
  const scope = 'https://lignum.test/holzpolter/', h = harness(undefined, scope);
  await h.event('install'); h.goOffline();
  const response = await h.event('fetch', new Request(scope + '?stand=123', { headers: { accept: 'text/html' } }));
  assert.equal(await response.text(), 'cached');
});
test('optional export-library failure does not block an otherwise complete offline app', async () => {
  const h = harness('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
  await h.event('install'); assert.equal(h.activated(), 1);
});
test('activation preserves protected offline maps and unrelated application caches', async () => {
  const h = harness(); for (const name of ['lignum-app-v13.45','lignum-app-v13.49','lignum-app-v13.50','lignum-app-v13.51','lignum-app-v13.52','lignum-app-v13.53','lignum-app-v13.54','lignum-app-v13.55','lignum-app-v13.56','lignum-app-v13.57','lignum-forest-rasters-v1','lignum-sat-offline-v1','lignum-osm-offline-v1','other-app']) h.cache(name);
  await h.event('activate'); assert.deepEqual(h.deleted, ['lignum-app-v13.45','lignum-app-v13.49','lignum-app-v13.50','lignum-app-v13.51','lignum-app-v13.52','lignum-app-v13.53','lignum-app-v13.54','lignum-app-v13.55','lignum-app-v13.56','lignum-app-v13.57']);
});
test('an expanded raster index is fetched from the network even when the old index is cached', async () => {
  const scope = 'https://lignum.test/holzpolter/', h = harness(undefined, scope), url = scope + 'data/forest-rasters/index.json';
  await h.cache('lignum-forest-rasters-v1').put(url, new Response('old region'));
  await h.cache('lignum-app-v13.45').put(url, new Response('old region'));
  const response = await h.event('fetch', new Request(url, { cache: 'no-cache' }));
  assert.equal(await response.text(), 'network');
  assert.deepEqual(h.fetched, [url]);
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

test('image requests with included credentials load public wildcard-CORS tiles', async () => {
  const h = harness();
  h.context.fetch = async (request, options) => {
    const outgoing = new Request(request, options);
    // Match the browser rule for Esri/OSM Access-Control-Allow-Origin: *.
    if (outgoing.mode === 'cors' && outgoing.credentials === 'include') throw new TypeError('CORS blocked');
    return new Response('tile-image');
  };
  const request = new Request('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/16/16276/36676', { mode:'no-cors', credentials:'include' });
  const response = await h.event('fetch', request);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'tile-image');
});
