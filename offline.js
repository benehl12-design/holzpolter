/* LIGNUM — © 2026 Benedikt Holz. All rights reserved. */
'use strict';

function newRecordId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function offlineActor() {
  try { return { id: currentUser?.id || null, company: currentProfile?.company_id || null }; }
  catch { return { id: null, company: null }; }
}
function offlineQuery(path) {
  const [table, search = ''] = path.split('?');
  return { table, params: new URLSearchParams(search) };
}
function offlineMatches(row, params, allowMissing = true) {
  for (const [key, expression] of params) {
    if (['select','order','limit','offset','on_conflict'].includes(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(row, key) && allowMissing) continue;
    const dot = expression.indexOf('.');
    const op = expression.slice(0, dot), expected = expression.slice(dot + 1);
    const value = row[key], text = String(value);
    if (op === 'eq' && text !== expected) return false;
    if (op === 'neq' && text === expected) return false;
    if (op === 'is' && (expected === 'null' ? value != null : text !== expected)) return false;
    if (['gt','gte','lt','lte'].includes(op)) {
      const a = typeof value === 'number' ? value : text;
      const b = typeof value === 'number' ? Number(expected) : expected;
      if (value == null || (op === 'gt' && !(a > b)) || (op === 'gte' && !(a >= b)) ||
          (op === 'lt' && !(a < b)) || (op === 'lte' && !(a <= b))) return false;
    }
    if (op === 'in' && !expected.replace(/^\(|\)$/g, '').split(',').includes(text)) return false;
  }
  return true;
}
function offlineResult(rows, params) {
  rows = rows.filter(row => offlineMatches(row, params));
  const order = params.get('order');
  if (order) rows.sort((a, b) => {
    for (const part of order.split(',')) {
      const [key, direction, nulls] = part.split('.'), av = a[key], bv = b[key];
      if (av === bv) continue;
      if (av == null || bv == null) return (av == null ? -1 : 1) * (nulls === 'nullsfirst' ? 1 : -1);
      return (av < bv ? -1 : 1) * (direction === 'desc' ? -1 : 1);
    }
    return 0;
  });
  const offset = Number(params.get('offset') || 0);
  const limit = params.has('limit') ? Number(params.get('limit')) : undefined;
  return rows.slice(offset, limit === undefined ? undefined : offset + limit);
}
async function offlineRequest(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
function offlineWritePrefer(path, method, prefer) {
  const { table, params } = offlineQuery(path);
  if (['markers','tracks'].includes(table) && params.has('id') && ['PATCH','DELETE'].includes(method)) {
    return [prefer.replace(/return=(minimal|representation)/g, '').replace(/^,|,$/g, ''), 'return=representation'].filter(Boolean).join(',');
  }
  return prefer;
}
async function offlineVerifyWrite(path, method, data, actor) {
  const { table, params } = offlineQuery(path), id = params.get('id');
  if (!['markers','tracks'].includes(table) || !id || !Array.isArray(data) || data.length) return;
  const fail = () => { const error = new Error('Eintrag wurde nicht geändert — Berechtigung oder Datenstand prüfen.'); error.syncPermanent = true; throw error; };
  if (method === 'PATCH') fail();
  if (method === 'DELETE') {
    const response = await offlineRequest(SUPABASE_URL + '/rest/v1/' + table + '?id=' + encodeURIComponent(id) + '&select=id', {
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + accessToken }
    });
    if (!response.ok || offlineActor().id !== actor) fail();
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length) fail();
  }
}
function openOfflineDB(name, store, upgrade) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, name === 'lignum-offline' ? 2 : 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(store)) upgrade(request.result);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function offlineTransaction(name, storeName, mode, operation, upgrade) {
  const db = await openOfflineDB(name, storeName, upgrade);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      let request;
      try { request = operation(tx.objectStore(storeName)); }
      catch (error) { tx.abort(); reject(error); return; }
      // A successful request is not a durable write until the transaction commits.
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Lokales Speichern fehlgeschlagen'));
    });
  } finally { db.close(); }
}

const LocalDataStore = (() => {
  const name = 'lignum-local-data', store = 'entities';
  const upgrade = db => db.createObjectStore(store, { keyPath: 'key' });
  const key = (table, id, actor = offlineActor().id) => actor + ':' + table + ':' + id;
  async function put(table, row, pending = true, actor = offlineActor().id) {
    if (!row?.id || !actor) return;
    await offlineTransaction(name, store, 'readwrite', s => s.put({
      key: key(table, row.id, actor), table, owner_id: actor,
      row: { ...row, _offline_pending: pending }, ts: Date.now()
    }), upgrade);
  }
  async function remove(table, id, actor = offlineActor().id) {
    if (!id || !actor) return;
    await offlineTransaction(name, store, 'readwrite', s => {
      s.delete(table + ':' + id); // Legacy snapshot of the same globally unique record.
      return s.delete(key(table, id, actor));
    }, upgrade);
  }
  async function list(table, actor = offlineActor().id) {
    if (!actor) return [];
    try {
      const rows = await offlineTransaction(name, store, 'readonly', s => s.getAll(), upgrade);
      return rows.filter(r => r.table === table &&
        (r.owner_id || r.row.created_by || r.row.profile_id) === actor).map(r => ({ ...r.row, _local_saved_at: r.ts }));
    } catch (error) { console.warn('[Offline] Lokale Daten nicht lesbar:', error.message); return []; }
  }
  async function clear() { await offlineTransaction(name, store, 'readwrite', s => s.clear(), upgrade); }
  return { put, remove, list, clear };
})();
window.LocalDataStore = LocalDataStore;

const OfflineReadCache = (() => {
  const name = 'lignum-read-cache', store = 'responses';
  const upgrade = db => db.createObjectStore(store);
  const key = (path, actor) => 'user:' + actor + ':' + path;
  async function put(path, data, actor = offlineActor().id) {
    if (!actor) return;
    try { await offlineTransaction(name, store, 'readwrite', s => s.put({ data, ts: Date.now() }, key(path, actor)), upgrade); }
    catch (error) { console.warn('[Offline] Lesecache nicht gespeichert:', error.message); }
  }
  async function get(path, actor = offlineActor().id) {
    if (!actor) return null;
    try {
      let value = await offlineTransaction(name, store, 'readonly', s => s.get(key(path, actor)), upgrade);
      if (!value) {
        const { table, params } = offlineQuery(path), company = offlineActor().company;
        // Preserve already downloaded data when upgrading an installed v13.36 app.
        const own = params.get('company_id') === 'eq.' + company ||
          (table === 'profiles' && params.get('id') === 'eq.' + actor) ||
          (table === 'companies' && params.get('id') === 'eq.' + company);
        if (own) value = await offlineTransaction(name, store, 'readonly', s => s.get(path), upgrade);
      }
      return value ? value.data : null;
    } catch { return null; }
  }
  async function mutate(path, method, body, actor = offlineActor().id) {
    if (!actor) return;
    const operation = offlineQuery(path), prefix = 'user:' + actor + ':';
    try {
      await offlineTransaction(name, store, 'readwrite', s => {
        const request = s.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          const storedKey = String(cursor.key);
          if (storedKey.startsWith(prefix)) {
            const query = offlineQuery(storedKey.slice(prefix.length)), record = cursor.value;
            if (query.table === operation.table && Array.isArray(record.data)) {
              let rows = record.data;
              if (method === 'POST') {
                for (const row of (Array.isArray(body) ? body : [body])) {
                  if (!row?.id || !offlineMatches(row, query.params, false)) continue;
                  const i = rows.findIndex(r => r.id === row.id);
                  if (i >= 0) rows[i] = { ...rows[i], ...row }; else rows.push(row);
                }
              } else if (method === 'DELETE') {
                rows = rows.filter(r => !offlineMatches(r, operation.params, false));
              } else if (method === 'PATCH') {
                rows = rows.map(r => offlineMatches(r, operation.params, false) ? { ...r, ...body } : r);
              }
              record.data = offlineResult(rows, query.params);
              cursor.update(record);
            }
          }
          cursor.continue();
        };
        return request;
      }, upgrade);
    } catch (error) { console.warn('[Offline] Lesecache nicht aktualisiert:', error.message); }
  }
  async function clear() { await offlineTransaction(name, store, 'readwrite', s => s.clear(), upgrade); }
  return { put, get, mutate, clear };
})();
window.OfflineReadCache = OfflineReadCache;

(function () {
  const name = 'lignum-offline', store = 'queue';
  const upgrade = db => {
    const s = db.createObjectStore(store, { keyPath: 'id', autoIncrement: true });
    s.createIndex('created_at', 'created_at', { unique: false });
  };
  let syncing = false, queueSize = 0, lastError = '', syncTimer;
  function owner(entry) {
    if (entry.owner_id) return entry.owner_id;
    // Existing installations stored a JWT instead of an explicit owner.
    try {
      const payload = entry.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(payload)).sub || null;
    } catch { return null; }
  }
  async function entries(actor = offlineActor().id) {
    const all = await offlineTransaction(name, store, 'readonly', s => s.getAll(), upgrade);
    return all.filter(e => actor && owner(e) === actor).sort((a,b) => a.id - b.id);
  }
  async function count() { queueSize = (await entries()).length; return queueSize; }
  async function migrateLegacyIds() {
    const actor = offlineActor().id, candidates = await entries(actor), replacements = new Map(), tables = new Set();
    if (!candidates.some(e => e.method === 'POST' && (Array.isArray(e.body) ? e.body : [e.body]).some(r => /^(offline|local)-/.test(r?.id || '')))) return;
    const rewrite = body => {
      if (Array.isArray(body)) return body.map(rewrite);
      if (!body || typeof body !== 'object') return body;
      return Object.fromEntries(Object.entries(body).map(([key,value]) =>
        [key, (key === 'id' || key.endsWith('_id')) && replacements.has(value) ? replacements.get(value) : value]));
    };
    await offlineTransaction(name, store, 'readwrite', s => {
      const request = s.getAll();
      request.onsuccess = () => {
        const pending = request.result.filter(e => owner(e) === actor);
        // Read and rewrite in one transaction so simultaneous app starts cannot generate different IDs.
        for (const entry of pending) {
          for (const row of (Array.isArray(entry.body) ? entry.body : [entry.body])) {
            if (entry.method === 'POST' && /^(offline|local)-/.test(row?.id || '') && !replacements.has(row.id)) replacements.set(row.id, newRecordId());
          }
        }
        for (const entry of pending) {
          const query = offlineQuery(entry.path); tables.add(query.table);
          for (const [key,value] of query.params) {
            if (value.startsWith('eq.') && replacements.has(value.slice(3))) query.params.set(key, 'eq.' + replacements.get(value.slice(3)));
          }
          s.put({ ...entry, body: rewrite(entry.body), path: query.table + (query.params.toString() ? '?' + query.params.toString() : ''), owner_id: actor });
        }
      };
      return request;
    }, upgrade);
    for (const table of tables) {
      for (const row of await LocalDataStore.list(table, actor)) {
        if (!replacements.has(row.id)) continue;
        await LocalDataStore.put(table, rewrite(row), true, actor);
        await LocalDataStore.remove(table, row.id, actor);
      }
    }
  }
  function status() {
    const dot = document.getElementById('online-dot'), txt = document.getElementById('sync-txt');
    const offline = !navigator.onLine;
    const cls = offline ? 'off' : syncing || queueSize ? 'sync' : 'on';
    const label = offline ? (queueSize ? '📵 Offline · ' + queueSize + ' wartet' : '📵 Offline') :
      syncing ? '↻ Sync · ' + queueSize : queueSize ? '☁ ' + queueSize + (lastError ? ' · prüfen' : ' wartet') : '✓ synchron';
    if (dot) { dot.className = cls; dot.title = lastError || label; }
    if (txt) { txt.textContent = label; txt.style.color = offline ? '#f5a0a0' : cls === 'sync' ? '#f5c870' : '#8ab882'; }
  }
  function toast(message) { if (typeof showToast === 'function') showToast(message, 4000); }
  function schedule(delay = 1500) {
    clearTimeout(syncTimer);
    if (navigator.onLine && offlineActor().id) syncTimer = setTimeout(() => sync().catch(e => console.warn('[Offline] Sync:', e.message)), delay);
  }
  async function retry(entry, message) {
    lastError = message;
    await offlineTransaction(name, store, 'readwrite', s => {
      const request = s.get(entry.id);
      request.onsuccess = () => {
        if (request.result) s.put({ ...request.result, retries: (request.result.retries || 0) + 1, last_error: message });
      };
      return request;
    }, upgrade);
  }
  function targets(entry, table, id) {
    const query = offlineQuery(entry.path);
    return query.table === table && (entry.body?.id === id || query.params.get('id') === 'eq.' + id ||
      (entry.method !== 'POST' && !query.params.has('id')));
  }
  async function pendingFor(table, id, actor = offlineActor().id, exclude) {
    return (await entries(actor)).some(entry => entry.id !== exclude && targets(entry, table, id));
  }
  async function read(path, data, fromServer = false) {
    if (!Array.isArray(data) && data !== null) return data;
    const { table, params } = offlineQuery(path), actor = offlineActor();
    if (table.startsWith('rpc/')) return data;
    const local = await LocalDataStore.list(table), pending = (await entries()).filter(e => offlineQuery(e.path).table === table);
    const rows = new Map((data || []).map((row,i) => [row.id || 'projection:' + i, { ...row }]));
    for (const row of local) {
      if (row.company_id && row.company_id !== actor.company) continue;
      if (fromServer && row._local_saved_at <= fromServer && !pending.some(e => targets(e, table, row.id))) {
        const full = !params.get('select') || params.get('select').split(',').some(s => s === '*' || s === 'id');
        if (full && ((data || []).some(r => r.id === row.id) ||
            (!params.has('limit') && !params.has('offset') && offlineMatches(row, params, false)))) {
          await LocalDataStore.remove(table, row.id).catch(() => {});
        }
        continue;
      }
      rows.set(row.id, { ...rows.get(row.id), ...row });
    }
    for (const entry of pending) {
      const operation = offlineQuery(entry.path);
      if (entry.method === 'POST') {
        for (const row of (Array.isArray(entry.body) ? entry.body : [entry.body])) {
          if (row?.id) rows.set(row.id, { created_at: new Date(entry.created_at).toISOString(), ...rows.get(row.id), ...row, _offline_pending: true });
        }
      } else {
        for (const [id, row] of rows) {
          if (!offlineMatches(row, operation.params, false)) continue;
          if (entry.method === 'DELETE') rows.delete(id);
          else rows.set(id, { ...row, ...entry.body, _offline_pending: true });
        }
      }
    }
    if (data === null && !local.length && !pending.length) return null;
    return offlineResult(Array.from(rows.values()), params);
  }
  async function acknowledge(path, method, body, data, actor = offlineActor().id, exclude) {
    const { table, params } = offlineQuery(path);
    await OfflineReadCache.mutate(path, method, method === 'POST' && Array.isArray(data) && data[0] ? data : body, actor);
    const snapshots = await LocalDataStore.list(table, actor);
    if (method === 'POST') {
      for (const row of (Array.isArray(data) && data[0] ? data : Array.isArray(body) ? body : [body])) {
        if (row?.id) await LocalDataStore.put(table, row, await pendingFor(table, row.id, actor, exclude), actor);
      }
    } else {
      for (const row of snapshots.filter(r => offlineMatches(r, params, false))) {
        if (method === 'DELETE') await LocalDataStore.remove(table, row.id, actor);
        else await LocalDataStore.put(table, { ...row, ...body }, await pendingFor(table, row.id, actor, exclude), actor);
      }
    }
  }
  function headers(prefer) {
    return { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) };
  }
  async function duplicateApplied(entry, response, actor) {
    const error = await response.json().catch(() => ({}));
    if (error.code !== '23505' || entry.method !== 'POST' || !entry.body?.id) return false;
    const table = offlineQuery(entry.path).table;
    const check = await offlineRequest(SUPABASE_URL + '/rest/v1/' + table + '?id=eq.' + encodeURIComponent(entry.body.id) + '&select=*', { headers: headers('') });
    if (!check.ok || offlineActor().id !== actor) return false;
    const rows = await check.json();
    const equal = (a,b) => typeof a === 'object' || typeof b === 'object' ? JSON.stringify(a) === JSON.stringify(b) : a === b || (a != null && b != null && String(a) === String(b));
    return Array.isArray(rows) && rows.some(row => row.id === entry.body.id && Object.entries(entry.body).every(([key,value]) => equal(row[key],value)));
  }
  async function sync() {
    const actor = offlineActor().id;
    if (syncing || !navigator.onLine || !actor || !accessToken) return;
    syncing = true; lastError = ''; status(); // Lock before the first asynchronous read.
    let succeeded = 0, transient = false;
    const changed = new Set();
    try {
      for (const entry of await entries(actor)) {
        if (!navigator.onLine || offlineActor().id !== actor) break;
        const send = () => offlineRequest(SUPABASE_URL + '/rest/v1/' + entry.path, {
          method: entry.method, headers: headers(offlineWritePrefer(entry.path, entry.method, entry.prefer)), body: entry.body ? JSON.stringify(entry.body) : undefined
        });
        try {
          let response = await send();
          if (response.status === 401 && offlineActor().id === actor) {
            if (await refreshAccessToken() && offlineActor().id === actor) response = await send();
          }
          const duplicate = response.status === 409 && await duplicateApplied(entry, response, actor);
          if (!response.ok && !duplicate) {
            await retry(entry, response.status === 401 ? 'Sitzung abgelaufen — bitte erneut anmelden.' : 'Serverfehler ' + response.status + ' — Änderung bleibt gespeichert.');
            transient = response.status >= 500;
            break; // Dependent PATCH/DELETE operations must never overtake a failed POST.
          }
          const text = duplicate ? '' : await response.text();
          const data = text ? JSON.parse(text) : null;
          await offlineVerifyWrite(entry.path, entry.method, data, actor);
          await acknowledge(entry.path, entry.method, entry.body, data, actor, entry.id);
          await offlineTransaction(name, store, 'readwrite', s => s.delete(entry.id), upgrade);
          succeeded++; changed.add(offlineQuery(entry.path).table);
        } catch (error) {
          await retry(entry, error.syncPermanent ? error.message : 'Verbindung unterbrochen — Änderung bleibt gespeichert.');
          transient = !error.syncPermanent; break;
        }
      }
    } finally {
      syncing = false; await count(); status();
    }
    if (succeeded && offlineActor().id === actor) {
      toast('✓ ' + succeeded + ' Änderung(en) synchronisiert');
      const refresh = [];
      if ((changed.has('markers') || changed.has('tracks')) && typeof loadData === 'function') refresh.push(loadData());
      if (changed.has('areas') && typeof loadAreas === 'function') refresh.push(loadAreas());
      if (changed.has('time_entries') && typeof loadWorktimeEntries === 'function') refresh.push(loadWorktimeEntries());
      await Promise.allSettled(refresh);
    }
    if (lastError) toast('⚠️ ' + lastError);
    if (queueSize && transient) schedule(30000);
  }
  async function handle(path, options) {
    const method = String(options.method || 'GET').toUpperCase(), actor = offlineActor();
    if (!['POST','PATCH','DELETE'].includes(method) || path.startsWith('rpc/') || path.startsWith('auth/')) return null;
    if (!actor.id || !actor.company) throw new Error('Bitte erneut anmelden.');
    let body = options.body || null, local = null;
    if (method === 'POST' && body && typeof body === 'object') {
      const make = row => ({ ...row, id: row.id || newRecordId() });
      body = Array.isArray(body) ? body.map(make) : make(body);
      local = (Array.isArray(body) ? body : [body]).map(row => ({ created_at: new Date().toISOString(), ...row, _offline_pending: true }));
    }
    await offlineTransaction(name, store, 'readwrite', s => s.add({
      path, method, body, prefer: options.prefer || '', owner_id: actor.id,
      company_id: actor.company, created_at: Date.now(), retries: 0
    }), upgrade);
    if (local) for (const row of local) await LocalDataStore.put(offlineQuery(path).table, row, true, actor.id).catch(() => {});
    await count(); status(); schedule();
    return local || true;
  }
  window.OfflineQueue = {
    handle, read, acknowledge, pendingFor, sync, size: () => queueSize, refreshStatus: status,
    async init() { await migrateLegacyIds(); await count(); status(); schedule(); }
  };
  window.addEventListener('offline', () => { status(); toast('📵 Kein Netz — Änderungen werden lokal gespeichert'); });
  window.addEventListener('online', () => { status(); schedule(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(800); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.OfflineQueue.init().catch(e => toast('⚠️ Lokaler Speicher: ' + e.message)));
  else window.OfflineQueue.init().catch(e => toast('⚠️ Lokaler Speicher: ' + e.message));
})();

async function dbFetch(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase(), prefer = options.prefer || '';
  let body = options.body;
  if (method === 'POST' && body && !path.startsWith('rpc/')) {
    const make = row => ({ ...row, id: row.id || newRecordId() });
    body = Array.isArray(body) ? body.map(make) : make(body);
  }
  const isGet = method === 'GET', actor = offlineActor().id;
  let requestPath = path;
  if (isGet && !path.startsWith('rpc/')) {
    const query = offlineQuery(path), select = query.params.get('select');
    if (select && !select.split(',').some(field => field === 'id' || field === '*')) {
      // Selected summary columns still need record identity for later offline edits/deletes.
      query.params.set('select', 'id,' + select);
      requestPath = query.table + '?' + query.params.toString();
    }
  }
  const fallback = async () => {
    if (!isGet) {
      const result = await window.OfflineQueue.handle(path, { method, body, prefer });
      if (result !== null) return result;
    } else {
      const data = await window.OfflineQueue.read(path, await OfflineReadCache.get(path, actor));
      if (data !== null) return data;
    }
    throw new Error('Offline — diese Daten sind auf diesem Gerät noch nicht gespeichert');
  };
  if (!navigator.onLine || (!isGet && window.OfflineQueue.size() > 0)) return fallback();
  const send = () => offlineRequest(SUPABASE_URL + '/rest/v1/' + requestPath, {
    method, headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + (accessToken || SUPABASE_KEY),
      'Content-Type': 'application/json', ...(offlineWritePrefer(path, method, prefer) ? { Prefer: offlineWritePrefer(path, method, prefer) } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let response;
  const requestStarted = Date.now();
  try { response = await send(); } catch { return fallback(); }
  if (offlineActor().id !== actor) throw new Error('Benutzer wurde gewechselt. Bitte erneut versuchen.');
  if (response.status === 401) {
    if (await refreshAccessToken() && offlineActor().id === actor) {
      try { response = await send(); } catch { return fallback(); }
    } else {
      showAuthErr('Sitzung abgelaufen — bitte neu anmelden.');
      hideAllScreens(); document.getElementById('auth-screen').style.display = 'flex';
      throw new Error('Sitzung abgelaufen — Änderung wurde nicht synchronisiert.');
    }
  }
  if (!response.ok) {
    if ((isGet && response.status >= 500) || (!isGet && [502,503,504].includes(response.status))) return fallback();
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.hint || 'Serverfehler ' + response.status);
  }
  const text = await response.text(), data = text ? JSON.parse(text) : null;
  if (isGet) {
    await OfflineReadCache.put(path, data || [], actor);
    return window.OfflineQueue.read(path, data || [], requestStarted);
  }
  await offlineVerifyWrite(path, method, data, actor);
  await window.OfflineQueue.acknowledge(path, method, body, data, actor);
  return data || (method === 'POST' ? [] : true);
}
