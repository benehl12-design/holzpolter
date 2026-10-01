// Run with: node --test tests/offline.test.cjs
// The browser APIs are modeled at their transaction boundary; the application code is unmodified.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../offline.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const copy = value => value === undefined ? undefined : structuredClone(value);

class IndexedDBModel {
  constructor() { this.databases = new Map(); this.failCommit = null; }
  open(name) {
    const request = {};
    setImmediate(() => {
      let state = this.databases.get(name), fresh = !state;
      if (!state) { state = { stores: new Map(), tail: Promise.resolve() }; this.databases.set(name, state); }
      const db = {
        objectStoreNames: { contains: key => state.stores.has(key) }, close() {},
        createObjectStore: (key, options = {}) => {
          state.stores.set(key, { rows: new Map(), next: 1, options });
          return { createIndex() {} };
        },
        transaction: (store, mode) => this.transaction(name, state, store, mode)
      };
      request.result = db;
      if (fresh) request.onupgradeneeded?.({ target: request });
      request.onsuccess?.({ target: request });
    });
    return request;
  }
  transaction(name, state, storeName, mode) {
    let pending = 0, started = false, completed = false, rows, next;
    const waiting = [], original = state.stores.get(storeName), model = this;
    let finish;
    const done = new Promise(resolve => { finish = resolve; });
    const tx = { error: null, abort: () => end(new Error('Aborted')) };
    function end(error) {
      if (completed) return;
      completed = true;
      if (error) { tx.error = error; tx.onabort?.(); }
      else {
        if (mode === 'readwrite') { original.rows = rows; original.next = next; }
        tx.oncomplete?.();
      }
      finish();
    }
    function check() {
      setImmediate(() => {
        if (!completed && !pending) {
          if (mode === 'readwrite' && model.failCommit === name) {
            model.failCommit = null; end(new Error('Simulated transaction abort after request success'));
          } else end();
        }
      });
    }
    function request(operation, existing) {
      const req = existing || {};
      pending++;
      const run = () => setImmediate(() => {
        try { req.result = operation(); req.onsuccess?.({ target: req }); }
        catch (error) { req.error = error; req.onerror?.({ target: req }); end(error); }
        pending--; check();
      });
      if (started) run(); else waiting.push(run);
      return req;
    }
    const store = {
      get: key => request(() => copy(rows.get(key))),
      getAll: () => request(() => Array.from(rows.values(), copy)),
      count: () => request(() => rows.size),
      delete: key => request(() => { rows.delete(key); }),
      clear: () => request(() => { rows.clear(); }),
      add: value => request(() => {
        const row = copy(value), keyPath = original.options.keyPath;
        let key = row[keyPath];
        if (key === undefined && original.options.autoIncrement) { key = next++; row[keyPath] = key; }
        if (rows.has(key)) throw new Error('ConstraintError');
        rows.set(key, row); return key;
      }),
      put: (value, explicit) => request(() => {
        const row = copy(value), key = explicit === undefined ? row[original.options.keyPath] : explicit;
        rows.set(key, row); return key;
      }),
      openCursor: () => {
        const req = {}, keys = Array.from((rows || original.rows).keys());
        let i = 0;
        const advance = () => request(() => {
          if (i >= keys.length) return null;
          const key = keys[i++];
          return { key, value: copy(rows.get(key)), update: value => store.put(value, key), continue: advance };
        }, req);
        advance(); return req;
      },
      index: () => ({ getAll: store.getAll })
    };
    tx.objectStore = () => store;
    const previous = state.tail;
    state.tail = previous.then(() => done);
    previous.then(() => {
      rows = new Map(Array.from(original.rows, ([key,value]) => [key,copy(value)])); next = original.next;
      started = true; waiting.forEach(run => run()); check();
    });
    return tx;
  }
}

function harness(idb = new IndexedDBModel()) {
  const elements = new Map(), calls = [];
  function element(id) {
    if (!elements.has(id)) elements.set(id, { value: '', disabled: false, style: {},
      classList: { contains: name => name === 'hidden', add() {}, remove() {} },
      addEventListener(event, callback) { this[event] = callback; } });
    return elements.get(id);
  }
  const context = vm.createContext({
    crypto: webcrypto, Uint8Array, URLSearchParams, AbortController, Response, indexedDB: idb,
    atob: str => Buffer.from(str, 'base64').toString(), navigator: { onLine: false },
    document: { readyState: 'loading', visibilityState: 'visible', getElementById: element, addEventListener() {} },
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; }, clearTimeout,
    console: { warn() {}, info() {} },
    fetch: async (url, options) => { calls.push({ url, ...options }); return context.reply(url, options); }
  });
  context.window = context; context.addEventListener = () => {};
  context.reply = () => { throw new Error('No internet'); };
  vm.runInContext(`
    const SUPABASE_URL = 'https://test.supabase.co', SUPABASE_KEY = 'publishable';
    let currentUser = { id: 'user-a' }, currentProfile = { company_id: 'company-a', role: 'ruecke' };
    let accessToken = 'session-a';
    let refreshed = 0, refreshWorks = false;
    async function refreshAccessToken() { refreshed++; return refreshWorks; }
    function showToast() {} function showAuthErr() {} function hideAllScreens() {}
    async function loadWorktimeEntries() {} async function loadAreas() {}
  `, context);
  vm.runInContext(source, context, { filename: 'offline.js' });
  return { context, idb, calls, element, run: code => vm.runInContext(code, context),
    async count() { await context.OfflineQueue.init(); return context.OfflineQueue.size(); } };
}
const marker = { id: '411ed011-4c38-4b67-8283-a47234c79ef6', company_id: 'company-a', created_by: 'user-a', lat: 67, lng: 22, typ: 'harvester', done: false };
const markersQuery = 'markers?company_id=eq.company-a&order=created_at&select=*';
async function create(h, body = marker) { return h.context.dbFetch('markers?select=*', { method: 'POST', body, prefer: 'return=representation' }); }
async function read(h, query = markersQuery) { return h.context.dbFetch(query); }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

test('offline create is durable and visible without an existing read cache', async () => {
  const h = harness(); await create(h);
  const rows = await read(h); assert.equal(rows[0].id, marker.id); assert.equal(rows[0]._offline_pending, true);
  const reload = harness(h.idb); assert.equal((await read(reload))[0].id, marker.id); assert.equal(await reload.count(), 1);
});
test('fallback IDs are valid UUIDs accepted by the database', async () => {
  const h = harness(); h.context.crypto = { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) };
  const [row] = await create(h, { ...marker, id: undefined });
  assert.match(row.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
test('create, mark collected, reload and delete retain the latest offline state', async () => {
  const h = harness(); await create(h);
  await h.context.dbFetch('markers?id=eq.' + marker.id, { method: 'PATCH', body: { done: true } });
  assert.equal((await read(harness(h.idb)))[0].done, true);
  await h.context.dbFetch('markers?id=eq.' + marker.id, { method: 'DELETE' });
  assert.equal((await read(harness(h.idb))).length, 0); assert.equal(await h.count(), 3);
});
test('updates and deletes of cached server markers survive reload', async () => {
  const h = harness(); await h.run(`OfflineReadCache.put(${JSON.stringify(markersQuery)}, ${JSON.stringify([marker])})`);
  await h.context.dbFetch('markers?id=eq.' + marker.id, { method: 'PATCH', body: { done: true } });
  assert.equal((await read(harness(h.idb)))[0].done, true);
  await h.context.dbFetch('markers?id=eq.' + marker.id, { method: 'DELETE' });
  assert.equal((await read(harness(h.idb))).length, 0);
});
test('summary selections include identity so offline collected counts remain correct', async () => {
  const h = harness(), query = 'markers?company_id=eq.company-a&select=done,typ';
  h.context.navigator.onLine = true; h.context.reply = url => {
    assert.equal(new URL(url).searchParams.get('select'), 'id,done,typ');
    return json([{ id: marker.id, done: false, typ: 'harvester' }]);
  };
  await h.context.dbFetch(query); h.context.navigator.onLine = false;
  await h.context.dbFetch('markers?id=eq.' + marker.id, { method: 'PATCH', body: { done: true } });
  assert.equal((await h.context.dbFetch(query))[0].done, true);
});
test('stopped offline time entries do not reopen as running after reload', async () => {
  const h = harness(), body = { company_id: 'company-a', profile_id: 'user-a', started_at: '2026-10-01T00:00:00Z' };
  const [row] = await h.context.dbFetch('time_entries?select=*', { method: 'POST', body });
  await h.context.dbFetch('time_entries?id=eq.' + row.id, { method: 'PATCH', body: { pause_started_at: null, pause_seconds: 30, stopped_at: '2026-10-01T01:00:00Z', duration_seconds: 3570 } });
  const reload = harness(h.idb);
  assert.equal((await read(reload, 'time_entries?company_id=eq.company-a&profile_id=eq.user-a&stopped_at=is.null')).length, 0);
  assert.equal((await read(reload, 'time_entries?company_id=eq.company-a'))[0].duration_seconds, 3570);
});
test('new offline areas are returned by load queries after reload', async () => {
  const h = harness(); const [area] = await h.context.dbFetch('areas?select=*', { method: 'POST', body: { company_id: 'company-a', created_by: 'user-a', name: 'Wald' } });
  assert.equal((await read(harness(h.idb), 'areas?company_id=eq.company-a&order=name'))[0].id, area.id);
});
test('a failed transaction after request success never reports a durable save', async () => {
  const h = harness(); h.idb.failCommit = 'lignum-offline';
  await assert.rejects(create(h), /transaction abort/); assert.equal(await h.count(), 0);
});
test('expired sessions retain queued work and block dependent writes', async () => {
  const h = harness(); await create(h); await h.context.dbFetch('markers?id=eq.' + marker.id, { method: 'PATCH', body: { done: true } });
  h.context.navigator.onLine = true; h.context.reply = () => json({}, 401);
  await h.context.OfflineQueue.sync(); assert.equal(await h.count(), 2);
  assert.equal(h.calls.length, 1); assert.equal((await h.context.OfflineQueue.read(markersQuery, null))[0].done, true);
});
test('401 refresh retries the same operation immediately and safely', async () => {
  const h = harness(); await create(h); h.run('refreshWorks = true'); h.context.navigator.onLine = true;
  h.context.reply = () => h.calls.length === 1 ? json({}, 401) : json([marker]);
  await h.context.OfflineQueue.sync(); assert.equal(h.calls.length, 2); assert.equal(await h.count(), 0);
});
test('a 409 conflict is not a success when the record is absent', async () => {
  const h = harness(); await create(h); await h.context.dbFetch('markers?id=eq.' + marker.id, { method: 'DELETE' });
  h.context.navigator.onLine = true; h.context.reply = (url, options) => options.method === 'POST' ? json({ code: '23505' }, 409) : json([]);
  await h.context.OfflineQueue.sync(); assert.equal(await h.count(), 2);
  assert.deepEqual(h.calls.map(c => c.method || 'GET'), ['POST','GET']);
});
test('a 409 with the same ID but different contents is retained for review', async () => {
  const h = harness(); await create(h); h.context.navigator.onLine = true;
  h.context.reply = (url, options) => options.method === 'POST' ? json({ code: '23505' }, 409) : json([{ ...marker, lat: 68 }]);
  await h.context.OfflineQueue.sync(); assert.equal(await h.count(), 1);
});
test('verified duplicate POSTs replay the following PATCH in order', async () => {
  const h = harness(); await create(h); await h.context.dbFetch('markers?id=eq.' + marker.id, { method: 'PATCH', body: { done: true } });
  h.context.navigator.onLine = true;
  h.context.reply = (url, options) => options.method === 'POST' ? json({ code: '23505' }, 409) : options.method === 'PATCH' ? new Response(null, { status: 204 }) : json([marker]);
  await h.context.OfflineQueue.sync(); assert.equal(await h.count(), 0);
  assert.deepEqual(h.calls.map(c => c.method || 'GET'), ['POST','GET','PATCH']);
});
test('concurrent sync events send each write once', async () => {
  const h = harness(); await create(h); h.context.navigator.onLine = true; h.context.reply = () => json([marker]);
  await Promise.all([h.context.OfflineQueue.sync(), h.context.OfflineQueue.sync()]);
  assert.equal(h.calls.length, 1); assert.equal(await h.count(), 0);
});
test('another account never replays or sees this account’s pending work', async () => {
  const h = harness(); await create(h); h.run("currentUser = { id: 'user-b' }; accessToken = 'session-b'");
  h.context.navigator.onLine = true; h.context.reply = () => json([marker]);
  await h.context.OfflineQueue.sync(); assert.equal(h.calls.length, 0); assert.equal(await h.count(), 0);
  h.context.navigator.onLine = false; await assert.rejects(read(h), /noch nicht gespeichert/);
  h.run("currentUser = { id: 'user-a' }; accessToken = 'session-a'"); assert.equal(await h.count(), 1);
});
test('legacy JWT-owned queues migrate without replaying under a different account', async () => {
  const h = harness(); await h.count();
  const token = 'e30.' + Buffer.from(JSON.stringify({ sub: 'user-a' })).toString('base64url') + '.signature';
  await h.run(`offlineTransaction('lignum-offline','queue','readwrite',s=>s.add({path:'markers',method:'POST',body:${JSON.stringify(marker)},token:${JSON.stringify(token)},retries:20,created_at:1}),()=>{})`);
  h.context.navigator.onLine = true; h.context.reply = () => json([marker]);
  await h.context.OfflineQueue.sync(); assert.equal(h.calls.length, 1); assert.equal(await h.count(), 0);
});
test('invalid UUIDs from old offline versions migrate together with dependent updates', async () => {
  const h = harness(); await create(h, { ...marker, id: 'offline-123-old' });
  await h.context.dbFetch('markers?id=eq.offline-123-old', { method: 'PATCH', body: { done: true } });
  await h.count(); const [row] = await read(h);
  assert.match(row.id, /^[0-9a-f-]{36}$/); assert.equal(row.done, true); assert.equal((await read(h)).length, 1);
  h.context.navigator.onLine = true;
  h.context.reply = (url,options) => options.method === 'POST' ? json([{ ...marker, id: row.id }]) : json([{ ...marker, id: row.id, done: true }]);
  await h.context.OfflineQueue.sync(); assert.equal(await h.count(), 0);
  assert.ok(h.calls[1].url.includes(row.id));
});
test('simultaneous app starts migrate legacy IDs only once', async () => {
  const h = harness(); await create(h, { ...marker, id: 'local-123-old' });
  await Promise.all([h.context.OfflineQueue.init(), h.context.OfflineQueue.init()]);
  const rows = await read(h); assert.equal(rows.length, 1); assert.match(rows[0].id, /^[0-9a-f-]{36}$/);
});
test('an ambiguous network failure reuses the UUID from the first online POST', async () => {
  const h = harness(); h.context.navigator.onLine = true;
  const [row] = await create(h, { ...marker, id: undefined });
  assert.equal(row.id, JSON.parse(h.calls[0].body).id); assert.equal(await h.count(), 1);
});
test('successful sync retains an offline snapshot before the first read cache exists', async () => {
  const h = harness(); await create(h); h.context.navigator.onLine = true; h.context.reply = () => json([marker]);
  await h.context.OfflineQueue.sync(); h.context.navigator.onLine = false;
  const [row] = await read(harness(h.idb)); assert.equal(row.id, marker.id); assert.equal(row._offline_pending, false);
});
test('queued rows respect company filters, order and limits', async () => {
  const h = harness(); await create(h, { ...marker, created_at: '2026-10-01T00:00:00Z' });
  await create(h, { ...marker, id: 'a6b1951f-ea79-40c2-8da8-68e9637604dd', created_at: '2026-10-01T01:00:00Z' });
  assert.equal((await read(h, 'markers?company_id=eq.other-company')).length, 0);
  assert.equal((await read(h, 'markers?company_id=eq.company-a&order=created_at.desc&limit=1'))[0].id, 'a6b1951f-ea79-40c2-8da8-68e9637604dd');
});
test('online expired-session writes fail explicitly instead of returning a success-shaped empty array', async () => {
  const h = harness(); h.context.navigator.onLine = true; h.context.reply = () => json({}, 401);
  await assert.rejects(create(h), /Sitzung abgelaufen/);
});

function mapHarness() {
  const h = harness(), layers = new Set();
  function layer() { return { addTo() { layers.add(this); return this; }, bindPopup(html) { this.popup = html; return this; },
    setLatLng() { return this; }, setIcon() { return this; }, setZIndexOffset() { return this; } }; }
  h.context.map = { hasLayer: item => layers.has(item), removeLayer: item => layers.delete(item) };
  h.context.L = { marker: layer, polyline: layer };
  h.run(`let markers = [], tracks = [], areas = [], pendingLL = {lat:67,lng:22}, currentAreaId = null;
    function mkIconDone() {} function getMarkerIcon() {} function applyMarkerFilter() {}
    function renderLog() {} function renderSidebar() {} function renderLkwSidebar() {} function setOnline() {}
    function getArt() { return 'Fichte'; }`);
  h.run(html.slice(html.indexOf('function escapeHtml(str)'), html.indexOf('// ── RENDER', html.indexOf('function escapeHtml(str)'))));
  const section = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
  h.run(section('function upsertMarkerOnMap(data)', '// ── DATEN LADEN'));
  h.run(section('let loadDataGeneration = 0;', '// ── ECHTZEIT-SYNC'));
  h.run(section("document.getElementById('btn-save').addEventListener('click', async () => {", "document.getElementById('btn-cancel')"));
  h.element('f-typ').value = 'harvester'; h.element('f-menge').value = '10'; h.element('f-notiz').value = 'Offline';
  return { ...h, layers };
}
test('the actual save button draws a marker immediately while offline and loadData preserves it', async () => {
  const h = mapHarness(); await h.element('btn-save').click();
  assert.equal(h.run('markers.length'), 1); assert.equal(h.layers.size, 1); assert.equal(h.calls.length, 0);
  await h.context.loadData(); assert.equal(h.run('markers.length'), 1); assert.equal(h.layers.size, 1);
});
test('failed reads preserve the existing map', async () => {
  const h = mapHarness(); h.run(`upsertMarkerOnMap(${JSON.stringify(marker)})`); h.context.navigator.onLine = true;
  await h.context.loadData(); assert.equal(h.run('markers.length'), 1); assert.equal(h.layers.size, 1);
});
test('a local storage failure leaves the actual save form open for retry', async () => {
  const h = mapHarness(); h.idb.failCommit = 'lignum-offline'; await h.element('btn-save').click();
  assert.equal(h.run('markers.length'), 0); assert.notEqual(h.run('pendingLL'), null); assert.equal(h.element('btn-save').disabled, false);
});
test('realtime acknowledgement cannot erase a newer queued offline update', async () => {
  const h = mapHarness(); await create(h); h.run(`upsertMarkerOnMap(${JSON.stringify(marker)})`);
  await h.context.dbFetch('markers?id=eq.' + marker.id, { method: 'PATCH', body: { done: true } });
  await h.context.receiveMarkerUpdate(marker); await h.context.loadData();
  assert.equal(h.run('markers[0].done'), true); assert.equal(await h.count(), 2);
});
test('RLS-denied updates returning zero rows are not reported as saved', async () => {
  const h = harness(); h.context.navigator.onLine = true; h.context.reply = () => json([]);
  await assert.rejects(h.context.dbFetch('markers?id=eq.' + marker.id, { method: 'PATCH', body: { done: true } }), /Berechtigung/);
});
test('RLS-denied deletes returning zero rows retain queued work when the marker still exists', async () => {
  const h = harness(); await h.context.dbFetch('markers?id=eq.' + marker.id, { method: 'DELETE' });
  h.context.navigator.onLine = true; h.context.reply = (url, options) => options.method === 'DELETE' ? json([]) : json([{ id: marker.id }]);
  await h.context.OfflineQueue.sync(); assert.equal(await h.count(), 1);
});
test('marker notes are escaped in the actual map popup and refreshed after updates', async () => {
  const h = mapHarness();
  h.run(`upsertMarkerOnMap(${JSON.stringify({ ...marker, notiz: '<img src=x onerror=alert(1)>' })})`);
  assert.match(h.run('markers[0].layer.popup'), /&lt;img/);
  assert.doesNotMatch(h.run('markers[0].layer.popup'), /<img/);
  h.run(`upsertMarkerOnMap(${JSON.stringify({ ...marker, notiz: 'Neu' })})`);
  assert.match(h.run('markers[0].layer.popup'), /Neu/);
  assert.equal(h.run('markers[0].notiz'), 'Neu');
});
test('a realtime delete arriving before the REST response does not delete the next marker', async () => {
  const h = mapHarness(), other = { ...marker, id: 'ee6bd04e-4c42-4e4e-a6a4-967e589f13e8' };
  h.context.isAdminUser = () => false;
  h.run(html.slice(html.indexOf('async function delMarker(id)'), html.indexOf('function canDeleteTrack')));
  h.run(`upsertMarkerOnMap(${JSON.stringify(marker)}); upsertMarkerOnMap(${JSON.stringify(other)})`);
  h.context.navigator.onLine = true; h.context.reply = () => {
    h.run('map.removeLayer(markers[0].layer); markers.splice(0,1)'); return json([marker]);
  };
  await h.context.delMarker(marker.id); assert.equal(h.run('markers.length'), 1); assert.equal(h.run('markers[0].id'), other.id);
});
test('account deletion waits for pending company data to synchronize', async () => {
  const h = harness(); await create(h); h.element('delete-account-confirm-input').value = 'LOESCHEN';
  const start = html.indexOf('async function executeAccountDeletion()');
  h.run(html.slice(start, html.indexOf('\n}\n', start) + 3));
  await h.context.executeAccountDeletion(); assert.equal(h.calls.length, 0);
  assert.match(h.element('delete-account-error').textContent, /zuerst online synchronisieren/);
});
test('manual token renewal also updates the SDK session and its Realtime credentials', async () => {
  const h = harness(); let sdkSession;
  h.context.sb = { auth: { setSession: async session => { sdkSession = session; } } };
  h.run("let refreshToken = 'old-refresh'");
  const start = html.indexOf('async function refreshAccessToken()');
  h.run(html.slice(start, html.indexOf('// ── AUTH TABS', start)));
  h.context.reply = () => json({ access_token: 'new-access', refresh_token: 'new-refresh' });
  assert.equal(await h.context.refreshAccessToken(), true);
  assert.equal(sdkSession.access_token, 'new-access'); assert.equal(sdkSession.refresh_token, 'new-refresh');
});
