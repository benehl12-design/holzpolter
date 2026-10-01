// DOM integration checks using real Leaflet 1.9.4 and the application's unchanged handlers.
// Requires jsdom@26.1.0; set LIGNUM_TEST_JSDOM to its package path when installed outside the repo.
// LIGNUM_TEST_LEAFLET can point to a local Leaflet 1.9.4 script for a fully offline test run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(process.env.LIGNUM_TEST_JSDOM || 'jsdom');
const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const area = { id: 'area-a', name: 'Test', area_hectares: 9.81,
  boundary: [[67,22],[67,22.005],[67.002,22.005],[67.002,22]] };
const inside = { lat: 67.001, lng: 22.0025 }, edgePoint = { lat: 67, lng: 22.0025 };
let leaflet, leafletCSS;
test.before(async () => {
  if (process.env.LIGNUM_TEST_LEAFLET) {
    leaflet = fs.readFileSync(process.env.LIGNUM_TEST_LEAFLET, 'utf8');
    leafletCSS = fs.readFileSync(process.env.LIGNUM_TEST_LEAFLET.replace(/\.js$/, '.css'), 'utf8');
  }
  else {
    [leaflet, leafletCSS] = await Promise.all(['js','css'].map(async ext => {
      const response = await fetch('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.' + ext, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Leaflet download failed: ' + response.status);
      return response.text();
    }));
  }
});
function block(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'application block exists: ' + start);
  return source.slice(from, to);
}
function fixture(t, mode = 'ruecke') {
  const dom = new JSDOM(`<!doctype html><style>${leafletCSS}
    .hidden { display:none }
    ${block('body.trail-drawing .leaflet-overlay-pane svg path,', '.tspc-chip,')}
  </style><div id="map"></div><div id="topbar"></div><button id="btn-add"></button>
    <div id="panel" class="hidden"><input id="f-menge"><textarea id="f-notiz"></textarea>
    <input id="f-art"><div id="typ-row"></div><div id="typ-fixed"></div>
    <select id="f-typ"><option value="ruecke">Polterplatz</option><option value="harvester">Holz abgelegt</option></select>
    <span id="auto-chip" class="hidden"></span></div><div id="area-draw-bar" class="hidden"></div>`,
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://lignum.test/' });
  const w = dom.window, container = w.document.getElementById('map');
  w.SVGSVGElement.prototype.createSVGRect = () => ({});
  for (const [key,value] of Object.entries({clientWidth:480,clientHeight:760,offsetWidth:480,offsetHeight:760})) {
    Object.defineProperty(container, key, { value });
  }
  container.getBoundingClientRect = () => ({ x:0,y:0,left:0,top:0,right:480,bottom:760,width:480,height:760 });
  w.eval(leaflet);
  w.eval(`
    const map = L.map('map', { zoomControl:false, attributionControl:false, zoomAnimation:false, fadeAnimation:false }).setView([67.001,22.0025],17);
    let currentMode = ${JSON.stringify(mode)}, pendingLL = null, selArt = '';
    let isAreaDrawing = false, isAreaCapturing = false, areaBoundary = [], areaPoly = null, areaForId = null;
    let currentAreaId = 'area-a';
    const currentUser = { id:'driver-a' }, areaBoundaryLayers = {};
    let deletedArea = null, reloads = 0;
    function setTxt() {} function showToast() {} function polygonHectares() { return 9.81; }
    function polygonSelfIntersects() { return false; } function buildEudrGeoJSON() { return {}; }
    function deleteArea(id) { deletedArea = id; }
    function loadAreas() { reloads++; }
    async function dbFetch(url, options) { return [{ id:areaForId, name:'Neue Fläche', ...options.body }]; }
    ${block('function ensureMapNavigation(){', 'window.ensureMapNavigation=')}
    ${block('function escapeHtml(str)', '\n}\n') + '\n}'}
    ${block('function openPanel(ll,auto=false)', '// ── MARKER SPEICHERN')}
    ${block('function startAreaDrawing(forAreaId)', '// ── GEOJSON DOWNLOAD')}
    window.fixture = { map, getLayer:id=>areaBoundaryLayers[id], render:renderAreaBoundaries,
      pending:()=>pendingLL, deleted:()=>deletedArea, reloads:()=>reloads,
      start:startAreaDrawing, cancel:cancelAreaDrawing, finish:finishAreaDrawing,
      points:()=>areaBoundary.slice(), layers:()=>Object.keys(areaBoundaryLayers) };
  `);
  const api = w.fixture;
  t.after(() => { api.map.remove(); dom.window.close(); });
  function click(target, ll) {
    const p = api.map.latLngToContainerPoint(ll);
    // jsdom has no native SVG hit testing. Respect the actual CSS before dispatching the DOM event.
    if (w.getComputedStyle(target).pointerEvents === 'none') target = container;
    target.dispatchEvent(new w.MouseEvent('click', { bubbles:true, cancelable:true, clientX:p.x, clientY:p.y }));
  }
  return { w, api, container, click, panel:w.document.getElementById('panel'),
    fill:id=>api.getLayer(id || area.id).getLayers()[0], edge:id=>api.getLayer(id || area.id).getLayers()[1] };
}
test('a filled polygon with a popup reproduces the reported obstruction in real Leaflet', t => {
  const h = fixture(t);
  const oldLayer = h.w.L.polygon(area.boundary).bindPopup('Erntefläche').addTo(h.api.map);
  h.click(oldLayer.getElement(), inside);
  assert.equal(oldLayer.isPopupOpen(), true);
  assert.equal(h.api.pending(), null);
});
test('tapping inside the saved harvest area opens the Polter form at the tapped position', t => {
  const h = fixture(t); h.api.render([area]);
  h.click(h.fill().getElement(), inside);
  assert.equal(h.panel.classList.contains('hidden'), false);
  assert.equal(h.w.document.getElementById('f-typ').value, 'ruecke');
  assert.ok(Math.abs(h.api.pending().lat - inside.lat) < 0.00001);
  assert.ok(Math.abs(h.api.pending().lng - inside.lng) < 0.00001);
  assert.equal(h.api.getLayer(area.id).isPopupOpen(), false);
});
test('the area edge keeps its data popup and can create a Polter at the boundary point', t => {
  const h = fixture(t); h.api.render([area]); h.click(h.edge().getElement(), edgePoint);
  const layer = h.api.getLayer(area.id);
  assert.equal(layer.isPopupOpen(), true); assert.equal(h.api.pending(), null);
  const content = layer.getPopup().getElement();
  assert.match(content.textContent, /Erntefläche.*Test.*9\.81 ha/s);
  const button = [...content.querySelectorAll('button')].find(b=>b.textContent.includes('Polter hier'));
  assert.ok(button); button.click();
  assert.equal(layer.isPopupOpen(), false); assert.equal(h.panel.classList.contains('hidden'), false);
  assert.ok(Math.abs(h.api.pending().lat - edgePoint.lat) < 0.00001);
});
test('choosing an edge location retains data already entered in the Polter form', t => {
  const h = fixture(t); h.api.render([area]); h.click(h.fill().getElement(), inside);
  h.w.document.getElementById('f-notiz').value = 'Am Abfuhrweg';
  h.w.document.getElementById('f-menge').value = '12';
  h.click(h.edge().getElement(), edgePoint);
  const button = [...h.api.getLayer(area.id).getPopup().getElement().querySelectorAll('button')].find(b=>b.textContent.includes('Polter hier'));
  button.click();
  assert.equal(h.w.document.getElementById('f-notiz').value, 'Am Abfuhrweg');
  assert.equal(h.w.document.getElementById('f-menge').value, '12');
  assert.ok(Math.abs(h.api.pending().lat - edgePoint.lat) < 0.00001);
});
test('area popup names are escaped and deleting uses the correct area even with overlapping areas', t => {
  const h = fixture(t); h.api.render([{...area,name:'<img src=x onerror=alert(1)>'}, {...area,id:'area-b'}]);
  h.click(h.edge().getElement(), edgePoint);
  const content = h.api.getLayer(area.id).getPopup().getElement();
  assert.equal(content.querySelector('img'), null); assert.match(content.textContent, /<img src=x/);
  [...content.querySelectorAll('button')].find(b=>b.textContent.includes('Fläche löschen')).click();
  assert.equal(h.api.deleted(), area.id);
});
test('existing Polter markers still open their own popup without creating another Polter', t => {
  const h = fixture(t); h.api.render([area]);
  const marker = h.w.L.marker(inside,{icon:h.w.L.divIcon({html:'🪵'})}).bindPopup('Bestehender Polter').addTo(h.api.map);
  h.click(marker.getElement(), inside);
  assert.equal(marker.isPopupOpen(), true); assert.equal(h.api.pending(), null);
});
test('redrawing an area allows interior points and immediately renders the saved area without waiting for reload', async t => {
  const h = fixture(t); h.api.render([area]); h.api.start('area-a');
  assert.equal(h.w.getComputedStyle(h.edge().getElement()).pointerEvents, 'none');
  for (const ll of [inside, {lat:67.0012,lng:22.003}, {lat:67.0014,lng:22.002}]) h.click(h.container,ll);
  assert.equal(h.api.points().length, 3); assert.equal(h.api.pending(), null);
  await h.api.finish(); assert.equal(h.w.document.body.classList.contains('area-drawing'), false);
  assert.equal(h.api.reloads(), 1);
  h.click(h.fill().getElement(), inside);
  assert.equal(h.panel.classList.contains('hidden'), false);
});
test('reloading areas removes both old render layers and preserves the admin data popup', t => {
  const h = fixture(t, 'admin'); h.api.render([area]); const old = h.api.getLayer(area.id);
  h.api.render([area]); assert.equal(h.api.map.hasLayer(old), false);
  assert.equal(h.w.document.querySelectorAll('.leaflet-overlay-pane svg path').length, 2);
  h.click(h.edge().getElement(), edgePoint);
  const content = h.api.getLayer(area.id).getPopup().getElement();
  assert.match(content.textContent, /Test/); assert.doesNotMatch(content.textContent, /Polter hier/);
  assert.equal(h.api.pending(), null);
});
