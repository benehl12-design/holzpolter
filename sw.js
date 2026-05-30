const TILE_CACHE = 'lignum-tiles-v5';
const SAT_CACHE  = 'lignum-sat-v5';
const APP_VERSION = '6.8';
const MAX_OSM = 600; const MAX_SAT = 1200;

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== TILE_CACHE && k !== SAT_CACHE)
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

async function limitCache(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map(k => c.delete(k)));
}

async function tileRespond(req, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) { fetch(req,{mode:'cors'}).then(r=>{if(r&&r.ok)cache.put(req,r);}).catch(()=>{}); return hit; }
  try {
    const r = await fetch(req,{mode:'cors'});
    if (r && r.ok) cache.put(req, r.clone()).then(()=>limitCache(cacheName,max));
    return r;
  } catch { return new Response('',{status:503}); }
}

self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (!url.startsWith('http')) return;

  // CDN-Scripts direkt durchreichen
  if (url.includes('jsdelivr.net') || url.includes('cdnjs.cloudflare.com') || url.includes('unpkg.com')) return;

  // Karten-Tiles: cachen
  if (url.includes('arcgisonline.com') || url.includes('virtualearth.net')) {
    e.respondWith(tileRespond(e.request, SAT_CACHE, MAX_SAT)); return;
  }
  if (url.includes('tile.openstreetmap.org')) {
    e.respondWith(tileRespond(e.request, TILE_CACHE, MAX_OSM)); return;
  }

  // Supabase API: niemals cachen
  if (url.includes('supabase.co')) {
    e.respondWith(fetch(e.request)); return;
  }

  // App-Shell: Cache first, dann Network
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});

// ── MESSAGES ──────────────────────────────────────────────────────────
// WICHTIG: e.waitUntil() haelt den SW am Leben. Ohne das wird er von
// iOS Safari aggressiv schlafengelegt und der Cache-Vorgang bricht ab.
self.addEventListener('message', e => {
  if (!e.data) return;
  if (e.data.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (e.data.type === 'CACHE_TILES') {
    e.waitUntil(handleCacheTiles(e));
  }
});

async function handleCacheTiles(e) {
  const {urls, layer} = e.data;
  const cacheName = layer === 'sat' ? SAT_CACHE : TILE_CACHE;
  const max = layer === 'sat' ? MAX_SAT : MAX_OSM;
  const client = e.source;
  function send(msg) {
    if (!client) return;
    try { client.postMessage(msg); } catch {}
  }
  try {
    const cache = await caches.open(cacheName);
    let done = 0;
    let errors = 0;
    const total = urls.length;
    for (let i = 0; i < urls.length; i += 6) {
      const batch = urls.slice(i, i + 6);
      await Promise.all(batch.map(async url => {
        try {
          const existing = await cache.match(url);
          if (!existing) {
            const r = await fetch(url, { mode: 'cors' });
            if (r && r.ok) await cache.put(url, r);
            else errors++;
          }
        } catch { errors++; }
        done++;
        send({ type: 'CACHE_PROGRESS', done, total });
      }));
    }
    await limitCache(cacheName, max);
    send({ type: 'CACHE_DONE', total: done, errors });
  } catch (err) {
    send({ type: 'CACHE_ERROR', error: String(err && err.message || err) });
  }
}
