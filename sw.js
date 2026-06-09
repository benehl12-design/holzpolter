/*
 * LIGNUM — © 2026 Benedikt Holz. Alle Rechte vorbehalten / All rights reserved.
 * Vertraulich. Nutzung/Weitergabe nur mit schriftlicher Genehmigung.
 * Confidential. Use/distribution only with written permission.
 */

// ── CACHE-NAMEN ──────────────────────────────────────────────────────
// Version muss mit index.html (meta app-version) übereinstimmen
const APP_VERSION  = '11.7';
const APP_CACHE    = 'lignum-app-v'  + APP_VERSION;
const TILE_CACHE   = 'lignum-tiles-v5';
const SAT_CACHE    = 'lignum-sat-v5';
const MAX_OSM      = 600;
const MAX_SAT      = 1200;

// ── APP-SHELL ────────────────────────────────────────────────────────
// FEHLER 2 BEHOBEN: icon-192.png und icon-512.png brauchen führenden Slash
// FEHLER 3 BEHOBEN: unpkg.com Leaflet durch cdnjs ersetzt (unpkg hat CORS-Probleme im SW)
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  // Leaflet — cdnjs statt unpkg (zuverlässiger CORS-Header im SW-Context)
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  // Supabase
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
  // PDF-Export
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
];

// ── INSTALL: App-Shell sofort cachen ────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(APP_CACHE)
      .then(cache =>
        Promise.allSettled(
          APP_SHELL.map(url =>
            cache.add(url).catch(err =>
              console.warn('[SW] App-Shell konnte nicht gecacht werden:', url, err)
            )
          )
        )
      )
      .then(() => {
        console.info('[SW] App-Shell gecacht, Version', APP_VERSION);
        return self.skipWaiting();
      })
  );
});

// ── ACTIVATE: alte Caches aufräumen ─────────────────────────────────
self.addEventListener('activate', e => {
  const KEEP = new Set([APP_CACHE, TILE_CACHE, SAT_CACHE]);
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !KEEP.has(k)).map(k => {
          console.info('[SW] Alter Cache gelöscht:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())
  );
});

// ── TILE HELPER ──────────────────────────────────────────────────────
async function limitCache(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  if (keys.length > max) {
    await Promise.all(keys.slice(0, keys.length - max).map(k => c.delete(k)));
  }
}

async function tileRespond(req, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) {
    fetch(req, { mode: 'cors' })
      .then(r => { if (r && r.ok) cache.put(req, r); })
      .catch(() => {});
    return hit;
  }
  try {
    const r = await fetch(req, { mode: 'cors' });
    if (r && r.ok) cache.put(req, r.clone()).then(() => limitCache(cacheName, max));
    return r;
  } catch {
    return new Response('', { status: 503 });
  }
}

// ── FETCH HANDLER ────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (!url.startsWith('http')) return;

  // ① Supabase: NIEMALS cachen
  if (url.includes('supabase.co')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // ② Satellit-Tiles (Esri + Bing)
  if (url.includes('arcgisonline.com') || url.includes('virtualearth.net')) {
    e.respondWith(tileRespond(e.request, SAT_CACHE, MAX_SAT));
    return;
  }

  // ③ OSM-Tiles
  if (url.includes('tile.openstreetmap.org')) {
    e.respondWith(tileRespond(e.request, TILE_CACHE, MAX_OSM));
    return;
  }

  // ④ App-Shell + CDN: Cache First → dann Network → dann Fallback
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;

      return fetch(e.request)
        .then(response => {
          if (response && response.ok && e.request.method === 'GET') {
            const clone = response.clone();
            caches.open(APP_CACHE).then(c => c.put(e.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline + nicht im Cache
          if (e.request.headers.get('accept')?.includes('text/html')) {
            return caches.match('/index.html');
          }
          return new Response('', { status: 503 });
        });
    })
  );
});

// ── MESSAGES ─────────────────────────────────────────────────────────
self.addEventListener('message', e => {
  if (!e.data) return;
  if (e.data.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (e.data.type === 'CACHE_TILES')  { e.waitUntil(handleCacheTiles(e)); return; }
});

// ── TILE-CACHING (Karten voraufladen) ────────────────────────────────
async function handleCacheTiles(e) {
  const { urls, layer } = e.data;
  const cacheName = layer === 'sat' ? SAT_CACHE : TILE_CACHE;
  const max       = layer === 'sat' ? MAX_SAT   : MAX_OSM;
  const client    = e.source;
  function send(msg) { if (!client) return; try { client.postMessage(msg); } catch {} }
  try {
    const cache = await caches.open(cacheName);
    let done = 0, errors = 0;
    const total = urls.length;
    for (let i = 0; i < urls.length; i += 6) {
      const batch = urls.slice(i, i + 6);
      await Promise.all(batch.map(async url => {
        try {
          const existing = await cache.match(url);
          if (!existing) {
            const r = await fetch(url, { mode: 'cors' });
            if (r && r.ok) await cache.put(url, r); else errors++;
          }
        } catch { errors++; }
        done++;
        send({ type: 'CACHE_PROGRESS', done, total });
      }));
    }
    await limitCache(cacheName, max);
    send({ type: 'CACHE_DONE', total: done, errors });
  } catch (err) {
    send({ type: 'CACHE_ERROR', error: String(err?.message ?? err) });
  }
}

// ── BACKGROUND SYNC ───────────────────────────────────────────────────
self.addEventListener('sync', e => {
  if (e.tag === 'lignum-sync-queue') e.waitUntil(notifyClientsToSync());
});

async function notifyClientsToSync() {
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) {
    try { client.postMessage({ type: 'SYNC_QUEUE' }); } catch {}
  }
}
