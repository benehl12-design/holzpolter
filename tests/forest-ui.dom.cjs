const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{webcrypto}=require('node:crypto');
const {JSDOM,VirtualConsole}=require(process.env.LIGNUM_TEST_JSDOM||'jsdom');
const dir=path.join(__dirname,'..');let leaflet;
test.before(async()=>{leaflet=process.env.LIGNUM_TEST_LEAFLET?fs.readFileSync(process.env.LIGNUM_TEST_LEAFLET,'utf8'):await(await fetch('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js')).text();});
const tick=()=>new Promise(r=>setTimeout(r,5));
async function until(check){for(let i=0;i<100;i++){if(check())return;await tick();}assert.ok(check(),'expected UI transition completed');}
function fixture(t,{role='admin',props=[],stands=[],areas=[],geojson=[],mapSize=[500,400]}={}){
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
  const dom=new JSDOM(fs.readFileSync(path.join(dir,'index.html'),'utf8'),{runScripts:'outside-only',pretendToBeVisual:true,url:'https://lignum.test/',virtualConsole:vc});
  const w=dom.window,d=w.document;
  const css=d.createElement('style');css.textContent=fs.readFileSync(path.join(dir,'forest-planning.css'),'utf8');d.head.append(css);
  w.SVGSVGElement.prototype.createSVGRect=()=>({});
  for(const key of ['clientWidth','offsetWidth'])Object.defineProperty(w.HTMLElement.prototype,key,{get(){return this.id==='fp-map'?mapSize[0]:400;}});
  for(const key of ['clientHeight','offsetHeight'])Object.defineProperty(w.HTMLElement.prototype,key,{get(){return this.id==='fp-map'?mapSize[1]:300;}});
  const observers=[];w.ResizeObserver=class {constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){}};
  const resizeMap=(width,height)=>{mapSize=[width,height];observers.forEach(o=>o.callback());};
  w.HTMLElement.prototype.getBoundingClientRect=function(){return {left:0,top:0,right:500,bottom:400,width:500,height:400,x:0,y:0};};
  Object.defineProperty(w.navigator,'onLine',{value:false,configurable:true});
  w.eval(leaflet);const maps=[];w.L.Map.addInitHook(function(){maps.push(this);});
  const tables={forest_properties:structuredClone(props),forest_stands:structuredClone(stands),areas:structuredClone(areas),geojson_layers:structuredClone(geojson)},writes=[];
  w.newRecordId=()=>webcrypto.randomUUID();w.confirm=()=>true;
  w.currentUser={id:'admin-a'};w.currentProfile={id:'admin-a',company_id:'company-a',role,is_admin:role==='admin'};
  w.isAdminUser=()=>w.currentProfile.is_admin;w.OfflineQueue={size:()=>0};
  w.hideAllScreens=()=>w.ForestPlanning?.hide();w.showModeScreen=()=>{};
  w.openAuftragForm=async()=>{d.getElementById('auftrag-form-overlay').style.display='flex';};w.aplFormSetLoc=()=>{};
  w.dbFetch=async(url,options={})=>{
    const [table,query='']=url.split('?'),p=new URLSearchParams(query),data=tables[table]||[],method=options.method||'GET';
    const match=row=>['id','company_id'].every(k=>!p.has(k)||row[k]===p.get(k).slice(3));
    if(method==='GET')return structuredClone(data.filter(match));
    writes.push({url,options:structuredClone(options)});
    if(method==='POST'){const row={...structuredClone(options.body),updated_at:'2026-10-16T00:00:00Z',_offline_pending:true};data.push(row);return [structuredClone(row)];}
    if(method==='PATCH'){const row=data.find(match);Object.assign(row,structuredClone(options.body));return [structuredClone(row)];}
    if(method==='DELETE'){tables[table]=data.filter(x=>!match(x));return data.filter(match);}
  };
  for(const file of ['vendor/proj4-2.11.0.js','vendor/polygon-clipping-0.15.7.js','forest-harvest-rules.js','forest-model.js','forest-raster-data.js','forest-planning.js'])w.eval(fs.readFileSync(path.join(dir,file),'utf8'));
  t.after(()=>{for(const m of maps)m.remove();dom.window.close();});
  const click=sel=>{const b=d.querySelector(sel);assert.ok(b,'button exists: '+sel);b.click();};
  const set=(name,value)=>{const input=d.querySelector(`[name="${name}"]`);assert.ok(input,'input exists '+name);input.value=value;};
  const submit=()=>{d.getElementById('fp-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));};
  return {w,d,tables,writes,errors,maps,click,set,submit,resizeMap};
}
const prop={id:'property-a',company_id:'company-a',name:'Sarvisvaara Test',area_ha:114,cadastral_ref:'Test',geometry:null};
const stand={id:'stand-a',company_id:'company-a',property_id:'property-a',number:'1',name:'Nordfläche',area_ha:3,land_type:'forest',hk_class:'G2',action:'thinning',removal_pct:25,inventory:{volume_m3sk_ha:200,scan_year:2022,species_pct:{pine:60,spruce:30,birch:10,other:0}},notes:'Testnotiz'};
test('create property and stand through the actual forms, then show their summary',async t=>{
  const h=fixture(t);await h.w.ForestPlanning.open();h.click('[data-act="new-property"]');h.set('name','Wald');h.set('area_ha','10');h.submit();await until(()=>h.tables.forest_properties.length===1&&!h.d.getElementById('fp-form'));
  h.click('[data-act="new-stand"]');h.set('name','Kiefer');h.set('area_ha','3');h.set('volume_m3sk_ha','200');h.set('scan_year','2022');h.submit();await until(()=>h.tables.forest_stands.length===1&&!h.d.getElementById('fp-form'));
  assert.match(h.d.getElementById('fp-content').textContent,/600/);assert.match(h.d.getElementById('fp-content').textContent,/2022/);assert.doesNotMatch(h.d.getElementById('fp-content').textContent,/2\.022/);
  h.click('[data-act="overview"]');assert.match(h.d.getElementById('fp-content').textContent,/Bekannter Holzvorrat/);assert.match(h.d.getElementById('fp-content').textContent,/600/);assert.deepEqual(h.errors,[]);
});
test('a second property can be smaller than the stands in the first property',async t=>{
  const h=fixture(t,{props:[prop],stands:[stand]});await h.w.ForestPlanning.open();h.click('[data-act="new-property"]');h.set('name','Klein');h.set('area_ha','0,5');h.submit();await until(()=>h.tables.forest_properties.length===2);assert.equal(h.tables.forest_properties[1].area_ha,.5);
});
test('invalid inventory keeps the form open and creates no record',async t=>{
  const h=fixture(t,{props:[prop]});await h.w.ForestPlanning.open();h.click('[data-act="new-stand"]');h.set('name','Invalid');h.set('area_ha','2');h.set('volume_m3sk_ha','-1');h.submit();await until(()=>h.d.getElementById('fp-form-error').textContent.length>0);assert.equal(h.writes.length,0);assert.ok(h.d.getElementById('fp-form'));
});
test('draw a stand on the Leaflet map, save it and cancel another drawing safely',async t=>{
  const h=fixture(t,{props:[prop]});await h.w.ForestPlanning.open();h.click('[data-act="draw-stand"]');
  for(const [lat,lng] of [[67,22],[67,22.001],[67.001,22.001],[67.001,22]])h.maps[0].fire('click',{latlng:h.w.L.latLng(lat,lng)});
  h.click('[data-act="finish-draw"]');h.set('name','Gezeichnet');h.submit();await until(()=>h.tables.forest_stands.length===1&&!h.d.getElementById('fp-form'));assert.equal(h.tables.forest_stands[0].geometry.type,'Polygon');
  h.click('[data-act="overview"]');h.click('[data-act="draw-stand"]');h.click('[data-act="cancel-draw"]');assert.ok(h.d.getElementById('fp-draw-tools').hidden);assert.equal(h.tables.forest_stands.length,1);
});
test('drivers can read a plan but admin actions remain blocked',async t=>{
  const h=fixture(t,{role:'harvester',props:[prop],stands:[stand]});await h.w.ForestPlanning.open();assert.ok(h.d.querySelector('[data-act="new-property"]').hidden);assert.equal(h.d.querySelector('[data-act="new-stand"]'),null);
  h.click('[data-act="select"]');assert.match(h.d.getElementById('fp-content').textContent,/Nordfläche/);assert.equal(h.d.querySelector('[data-act="edit-stand"]'),null);h.click('[data-act="new-property"]');await tick();assert.equal(h.writes.length,0);assert.equal(h.d.getElementById('fp-form'),null);
});
test('untrusted names and notes are rendered as text and search filters stand rows',async t=>{
  const h=fixture(t,{props:[{...prop,name:'<img src=x onerror=alert(1)>'}],stands:[{...stand,name:'<script>unsafe</script>',notes:'<svg onload=alert(1)>'}]});await h.w.ForestPlanning.open();assert.equal(h.d.querySelector('#fp-content img'),null);assert.match(h.d.getElementById('fp-content').textContent,/<img/);
  const search=h.d.getElementById('fp-search');search.value='nicht vorhanden';search.dispatchEvent(new h.w.Event('input',{bubbles:true}));assert.equal(h.d.querySelectorAll('#fp-stand-list .fp-row').length,0);
  search.value='unsafe';search.dispatchEvent(new h.w.Event('input',{bubbles:true}));h.click('[data-act="select"]');assert.equal(h.d.querySelector('#fp-content script,#fp-content svg'),null);
});
test('the existing order form receives stand planning and returns to the forest screen',async t=>{
  const h=fixture(t,{props:[prop],stands:[stand]});await h.w.ForestPlanning.open();h.click('[data-act="select"]');h.click('[data-act="order"]');await until(()=>h.d.getElementById('apl-f-titel').value.length>0);
  assert.match(h.d.getElementById('apl-f-titel').value,/Durchforstung.*Nordfläche/);assert.match(h.d.getElementById('apl-f-beschreibung').value,/25 %/);assert.equal(h.d.getElementById('forest-screen').style.display,'flex');
});
test('editing notes preserves a total-only imported stock value',async t=>{
  const h=fixture(t,{props:[prop],stands:[{...stand,inventory:{volume_m3sk:600}}]});await h.w.ForestPlanning.open();h.click('[data-act="select"]');h.click('[data-act="edit-stand"]');h.set('notes','Ergänzte Notiz');h.submit();await until(()=>!h.d.getElementById('fp-form'));
  assert.equal(h.tables.forest_stands[0].inventory.volume_m3sk,600);assert.match(h.d.getElementById('fp-content').textContent,/600/);
});
test('changing stock density recalculates the old derived total',async t=>{
  const h=fixture(t,{props:[prop],stands:[{...stand,inventory:{volume_m3sk:600,volume_m3sk_ha:200}}]});await h.w.ForestPlanning.open();h.click('[data-act="select"]');h.click('[data-act="edit-stand"]');h.set('volume_m3sk_ha','220');h.submit();await until(()=>!h.d.getElementById('fp-form'));
  assert.equal(h.w.ForestModel.stock(h.tables.forest_stands[0]),660);
});
async function importText(h,name,text){
  Object.defineProperty(h.d.getElementById('fp-file'),'files',{value:[{name,size:text.length,text:async()=>text}],configurable:true});
  h.d.getElementById('fp-file').dispatchEvent(new h.w.Event('change',{bubbles:true}));await tick();
}
test('import preview creates new stands and explicitly updates existing inventory without duplicates',async t=>{
  const h=fixture(t,{props:[prop],stands:[stand]});await h.w.ForestPlanning.open();
  await importText(h,'daten.csv','number;name;area_ha;volume_m3sk_ha\n1;Quelle;3;240\n2;Neuer Bestand;2;100');
  assert.match(h.d.querySelector('.fp-dialog').textContent,/1 neue Bestände · 1 bestehende/);h.click('[data-act="confirm-import"]');await tick();assert.equal(h.writes.length,0);
  h.d.getElementById('fp-replace-confirm').checked=true;h.click('[data-act="confirm-import"]');h.click('[data-act="confirm-import"]');await until(()=>!h.d.querySelector('.fp-dialog'));
  assert.equal(h.tables.forest_stands.length,2);assert.equal(h.tables.forest_stands[0].inventory.volume_m3sk_ha,240);assert.equal(h.tables.forest_stands[0].name,stand.name);assert.equal(h.tables.forest_stands[0].action,'thinning');assert.equal(h.tables.forest_stands[0].notes,stand.notes);
  assert.deepEqual(h.writes.map(x=>x.options.method),['PATCH','POST']);
});
test('inventory import refuses a mismatched stand area',async t=>{
  const h=fixture(t,{props:[prop],stands:[stand]});await h.w.ForestPlanning.open();await importText(h,'daten.csv','number;name;area_ha;volume_m3sk_ha\n1;Andere Fläche;5;240');
  assert.match(h.d.getElementById('fp-message').textContent,/weicht/);assert.equal(h.d.querySelector('.fp-dialog'),null);assert.equal(h.writes.length,0);
});
test('file mode opens online without contacting the Skogsstyrelsen API',async t=>{
  const h=fixture(t,{props:[prop],stands:[stand]});Object.defineProperty(h.w.navigator,'onLine',{value:true,configurable:true});let requests=0;
  h.w.fetch=async()=>{requests++;throw Error('Unexpected source API call');};await h.w.ForestPlanning.open();h.click('[data-act="select"]');await tick();
  assert.equal(requests,0);assert.match(h.d.querySelector('[data-act="fetch-data"]').textContent,/ZIP-Daten/);
  assert.match(h.d.getElementById('fp-content').textContent,/kein Skogsstyrelsen-API-Zugang benötigt/);
});
test('ZIP inventory is calculated offline from native cells, reviewed and saved without a source API',async t=>{
  const h=fixture(t,{props:[prop],stands:[{...stand,geometry:null}]});
  const b=[780000,7410000,780020,7410010],geometry=h.w.ForestModel.geometry({type:'Polygon',coordinates:[[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]],[b[0],b[1]]]]},'EPSG:3006');
  Object.assign(h.tables.forest_stands[0],{geometry,area_ha:h.w.ForestModel.area(geometry),inventory:{volume_m3sk_ha:700,reference_year:2026,age_years:80}});
  const layers={},sources={};for(const [id,values] of Object.entries({volume_2:[100,300],height_2:[170,190],age_pine:[40,60],site_pine:[18,20]})){
    layers[id]={x:b[0],y:b[3],step:10,width:2,height:1,runs:values.map(v=>[v,1])};sources[id]={name:id,year:id==='age_pine'?2025:null,scale:id==='height_2'?.1:1};
  }
  const index={schema:'lignum-raster-index-v1',sources,tiles:[{file:'test.json',bounds:b}]},tile={schema:'lignum-raster-tile-v1',bounds:b,layers},requests=[];
  h.w.fetch=async url=>{requests.push(url);assert.match(url,/\/data\/forest-rasters\//);const value=url.endsWith('index.json')?index:tile;return {ok:true,json:async()=>value,clone(){return this;}};};
  h.w.AbortSignal={timeout:()=>undefined};
  await h.w.ForestPlanning.open();h.click('[data-act="select"]');h.click('[data-act="fetch-data"]');
  h.d.getElementById('fp-age-type').value='pine';h.d.getElementById('fp-site-species').value='T';h.click('[data-act="calculate-zip"]');
  await until(()=>h.d.querySelector('[data-act="apply-zip"]'));assert.equal(h.writes.length,0);h.click('[data-act="apply-zip"]');await until(()=>!h.d.querySelector('.fp-dialog'));
  const i=h.tables.forest_stands[0].inventory;assert.ok(Math.abs(i.volume_m3sk_ha-200)<.001);assert.ok(Math.abs(i.mean_height_m-18)<.001);assert.equal(i.age_years,50);assert.equal(i.site_index,'T19');assert.equal(i.reference_year,undefined);assert.equal(requests.length,2);
  assert.doesNotMatch(h.d.getElementById('fp-content').textContent,/Zugang noch einzurichten/);assert.deepEqual(h.errors,[]);
});
test('a map first opened with zero size recovers when its layout becomes visible',async t=>{
  const h=fixture(t,{props:[prop],mapSize:[0,0]});await h.w.ForestPlanning.open();
  await new Promise(r=>setTimeout(r,80));h.resizeMap(700,450);
  await until(()=>h.maps[0].getSize().x===700&&h.maps[0].getSize().y===450);
  h.w.ForestPlanning.hide();h.resizeMap(850,350);await h.w.ForestPlanning.open();
  await until(()=>h.maps[0].getSize().x===850&&h.maps[0].getSize().y===350);
  assert.equal(h.maps.length,1);assert.deepEqual(h.errors,[]);
});
test('tile failures expose retry and street-map controls, and successful tiles clear the error',async t=>{
  const h=fixture(t,{props:[prop]});await h.w.ForestPlanning.open();
  const layer=()=>{let found;h.maps[0].eachLayer(l=>{if(l instanceof h.w.L.TileLayer)found=l;});return found;};
  const first=layer();assert.equal(first.options.crossOrigin,'anonymous');first.fire('loading');first.fire('tileerror');first.fire('load');
  assert.equal(h.d.getElementById('fp-map-status').hidden,false);assert.match(h.d.getElementById('fp-map-status').textContent,/Offline/);
  h.click('[data-act="retry-map"]');assert.notEqual(layer(),first);
  layer().fire('tileload');layer().fire('load');assert.equal(h.d.getElementById('fp-map-status').hidden,true);
  layer().fire('tileerror');layer().fire('load');h.click('[data-act="street-map"]');
  assert.equal(layer().options.crossOrigin,'anonymous');assert.equal(h.d.getElementById('fp-basemap').value,'streets');assert.match(layer().getTileUrl({x:1,y:1}),/tile\.openstreetmap\.org/);
  assert.equal(h.writes.length,0);assert.deepEqual(h.errors,[]);
});
test('ZIP coverage and download errors are visible inside the open dialog',async t=>{
  const h=fixture(t,{props:[prop],stands:[stand]});
  h.tables.forest_stands[0].geometry=h.w.ForestModel.geometry({type:'Polygon',coordinates:[[[780000,7410000],[780020,7410000],[780020,7410020],[780000,7410020],[780000,7410000]]]},'EPSG:3006');
  h.w.fetch=async()=>({ok:true,json:async()=>({schema:'lignum-raster-index-v1',name:'Testgebiet',tiles:[]}),clone(){return this;}});
  await h.w.ForestPlanning.open();h.click('[data-act="select"]');h.click('[data-act="fetch-data"]');
  await until(()=>h.d.getElementById('fp-zip-coverage').textContent.includes('Testgebiet'));
  h.click('[data-act="calculate-zip"]');await until(()=>!h.d.querySelector('[data-act="calculate-zip"]').disabled);
  assert.match(h.d.getElementById('fp-zip-error').textContent,/außerhalb.*Testgebiet/);
  assert.ok(h.d.querySelector('.fp-dialog'));assert.equal(h.writes.length,0);assert.deepEqual(h.errors,[]);
});
test('a partly loaded map retries automatically once and keeps manual recovery available',async t=>{
  const h=fixture(t,{props:[prop]});Object.defineProperty(h.w.navigator,'onLine',{value:true,configurable:true});await h.w.ForestPlanning.open();
  let layer;h.maps[0].eachLayer(l=>{if(l instanceof h.w.L.TileLayer)layer=l;});
  let retries=0;layer.redraw=()=>{retries++;return layer;};
  layer.fire('loading');layer.fire('tileload');layer.fire('tileerror');layer.fire('load');
  await new Promise(r=>setTimeout(r,1300));assert.equal(retries,1);
  layer.fire('loading');layer.fire('tileload');layer.fire('tileerror');layer.fire('load');
  await new Promise(r=>setTimeout(r,1300));assert.equal(retries,1);
  assert.ok(h.d.querySelector('#fp-map-status [data-act="retry-map"]'));
});

function directRaster(h){
  const b=[780000,7410000,780020,7410010],geometry=h.w.ForestModel.geometry({type:'Polygon',coordinates:[[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]]]},'EPSG:3006');
  const index={schema:'lignum-raster-index-v1',sources:{volume_2:{name:'Test raster',year:2024,scale:1}},tiles:[{file:'direct.json',bounds:b}]};
  const tile={schema:'lignum-raster-tile-v1',bounds:b,layers:{volume_2:{x:b[0],y:b[3],step:10,width:2,height:1,runs:[[100,1],[300,1]]}}};
  h.w.fetch=async url=>{const value=url.endsWith('index.json')?index:tile;return {ok:true,json:async()=>value,clone(){return this;}};};
  return geometry;
}
async function drawDirect(h){
  const geometry=directRaster(h);await h.w.ForestPlanning.open();h.click('[data-act="draw-quick"]');
  for(const [lng,lat] of geometry.coordinates[0].slice(0,-1))h.maps[0].fire('click',{latlng:h.w.L.latLng(lat,lng)});
  h.click('[data-act="finish-draw"]');h.click('[data-act="calculate-zip"]');
  await until(()=>h.d.getElementById('fp-content').textContent.includes('200'));
  return geometry;
}
test('draw and inspect real raster values without any property or database writes',async t=>{
  const h=fixture(t);await drawDirect(h);
  assert.equal(h.tables.forest_properties.length,0);assert.equal(h.tables.forest_stands.length,0);assert.equal(h.writes.length,0);
  assert.match(h.d.getElementById('fp-content').textContent,/Freie Fläche/);assert.ok(h.d.querySelector('[data-act="save-quick"]'));assert.deepEqual(h.errors,[]);
});
test('main-map boundaries are visible, clickable and refresh without duplicate records',async t=>{
  const h=fixture(t);const geometry=directRaster(h),boundary=geometry.coordinates[0].slice(0,-1).map(([lng,lat])=>[lat,lng]);
  h.tables.areas.push({id:'shared-a',company_id:'company-a',name:'Gemeinsame Fläche',boundary});
  await h.w.ForestPlanning.open();let polygon;h.maps[0].eachLayer(l=>{if(l instanceof h.w.L.Polygon&&l.options.dashArray)polygon=l;});assert.ok(polygon,'shared boundary rendered');
  polygon.fire('click',{originalEvent:{stopPropagation(){}}});assert.match(h.d.getElementById('fp-content').textContent,/Gemeinsame Fläche/);
  h.click('[data-act="quick-data"]');h.click('[data-act="calculate-zip"]');await until(()=>h.d.getElementById('fp-content').textContent.includes('200'));
  h.tables.areas[0].boundary=boundary.map(([lat,lng])=>[lat+.001,lng]);await h.w.ForestPlanning.refresh();
  assert.doesNotMatch(h.d.getElementById('fp-content').textContent,/Diese Auswertung ist noch nicht/);
  let count=0;h.maps[0].eachLayer(l=>{if(l instanceof h.w.L.Polygon&&l.options.dashArray)count++;});assert.equal(count,1);assert.equal(h.writes.length,0);
});
test('optional save can create a property after evaluation and retain inventory in its stand',async t=>{
  const h=fixture(t);await drawDirect(h);h.click('[data-act="save-quick"]');assert.equal(h.writes.length,0);
  h.click('[data-act="quick-new-property"]');h.set('name','Mein Wald');h.submit();await until(()=>h.tables.forest_properties.length===1&&h.d.querySelector('[name="number"]'));
  assert.equal(h.tables.forest_stands.length,0);h.set('name','Ausgewertete Fläche');h.submit();await until(()=>h.tables.forest_stands.length===1&&!h.d.getElementById('fp-form'));
  assert.ok(Math.abs(h.tables.forest_stands[0].inventory.volume_m3sk_ha-200)<.001);
  assert.equal(h.tables.forest_stands[0].property_id,h.tables.forest_properties[0].id);assert.deepEqual(h.writes.map(x=>x.options.method),['POST','POST']);assert.deepEqual(h.errors,[]);
});
test('optional save to an existing property retains its area link and allows cancellation',async t=>{
  const h=fixture(t,{props:[prop]});const geometry=directRaster(h);h.tables.areas.push({id:'area-a',company_id:'company-a',name:'Arbeitsfläche',boundary:geometry.coordinates[0].slice(0,-1).map(([lng,lat])=>[lat,lng])});
  await h.w.ForestPlanning.open();h.click('[data-act="shared-areas"]');h.click('[data-act="select-area"]');h.click('[data-act="quick-data"]');h.click('[data-act="calculate-zip"]');await until(()=>h.d.querySelector('[data-act="save-quick"]'));
  h.click('[data-act="save-quick"]');h.click('[data-act="cancel"]');assert.equal(h.writes.length,0);
  h.click('[data-act="save-quick"]');h.click('[data-act="quick-save-property"]');h.submit();await until(()=>h.tables.forest_stands.length===1);
  assert.equal(h.tables.forest_properties.length,1);assert.equal(h.tables.forest_stands[0].area_id,'area-a');assert.equal(h.tables.forest_stands[0].property_id,prop.id);
});
test('drivers can inspect a free area but cannot save it',async t=>{
  const h=fixture(t,{role:'forwarder'});await drawDirect(h);assert.equal(h.d.querySelector('[data-act="save-quick"]'),null);assert.equal(h.writes.length,0);
});
test('a company switch clears shared boundaries and unsaved analysis',async t=>{
  const h=fixture(t);await drawDirect(h);h.tables.areas.push({id:'private-a',company_id:'company-a',name:'Private A',boundary:[[67,22],[67,22.001],[67.001,22]]});await h.w.ForestPlanning.refresh();
  h.w.currentUser={id:'user-b'};h.w.currentProfile={id:'user-b',company_id:'company-b',role:'admin',is_admin:true};await h.w.ForestPlanning.open();
  assert.doesNotMatch(h.d.getElementById('fp-content').textContent,/Private A|Freie Fläche|Optional speichern/);assert.equal(h.writes.length,0);
});
test('invalid shared geometry and area loading errors do not prevent free analysis',async t=>{
  const h=fixture(t,{areas:[{id:'bad',company_id:'company-a',name:'Bad',boundary:[[1,1],[1,1],[1,1]]}]});await h.w.ForestPlanning.open();assert.match(h.d.getElementById('fp-message').textContent,/ungültig/);
  const db=h.w.dbFetch;h.w.dbFetch=async(...args)=>{if(args[0].startsWith('areas?'))throw Error('Unavailable');return db(...args);};
  await drawDirect(h);assert.equal(h.writes.length,0);assert.deepEqual(h.errors,[]);
});

test('imported parcels display automatically with names, colors and no database writes; deletion refreshes',async t=>{
  const h=fixture(t),geometry=directRaster(h);
  h.tables.geojson_layers.push({id:'cadastre',company_id:'company-a',name:'Datei',color:'#c0392b',geojson:{type:'FeatureCollection',features:[{type:'Feature',properties:{fastighetsbeteckning:'Sarvisvaara 2:6'},geometry},{type:'Feature',properties:{name:'Zweites Flurstück'},geometry:{type:'MultiPolygon',coordinates:[geometry.coordinates]}}]}});
  h.tables.geojson_layers.push({id:'private',company_id:'company-b',geojson:{type:'Feature',properties:{name:'Fremd'},geometry}});
  await h.w.ForestPlanning.open();assert.match(h.d.getElementById('fp-content').textContent,/Sarvisvaara 2:6/);assert.match(h.d.getElementById('fp-content').textContent,/Zweites Flurstück/);assert.doesNotMatch(h.d.getElementById('fp-content').textContent,/Fremd/);
  let count=0;h.maps[0].eachLayer(l=>{if(l instanceof h.w.L.Polygon&&l.options.color==='#c0392b')count++;});assert.equal(count,2);
  h.click('[data-act="select-area"]');h.click('[data-act="quick-data"]');h.click('[data-act="calculate-zip"]');await until(()=>h.d.querySelector('[data-act="save-quick"]'));
  h.click('[data-act="save-quick"]');h.click('[data-act="quick-new-property"]');h.submit();await until(()=>h.d.querySelector('[name="number"]'));h.submit();await until(()=>h.tables.forest_stands.length===1&&!h.d.getElementById('fp-form'));
  assert.ok(!h.tables.forest_stands[0].area_id,'cadastral feature must never become an areas foreign key');
  h.click('[data-act="shared-areas"]');h.click('[data-act="select-area"]');h.tables.geojson_layers=[];await h.w.ForestPlanning.refresh();assert.equal(h.d.querySelector('[data-act="quick-data"]'),null);
});
test('local-only cadastral imports are included and detailed polygons with holes remain visible',async t=>{
  const h=fixture(t),ring=[];for(let i=0;i<=2600;i++){const a=i/2600*2*Math.PI;ring.push([22+Math.cos(a)*.01,67+Math.sin(a)*.01]);}ring[2600]=ring[0];
  const geometry={type:'Polygon',coordinates:[ring,[[21.999,66.999],[22.001,66.999],[22.001,67.001],[21.999,67.001],[21.999,66.999]]]};
  h.w.getLocalPlanningBoundaries=()=>[{id:'local-test',company_id:'company-a',name:'Lokale Grenze',color:'#ffff00',geojson:geometry},{id:'other',company_id:'company-b',name:'Fremd',geojson:geometry}];
  await h.w.ForestPlanning.open();assert.match(h.d.getElementById('fp-content').textContent,/Lokale Grenze/);assert.doesNotMatch(h.d.getElementById('fp-content').textContent,/Fremd/);
  let polygon;h.maps[0].eachLayer(l=>{if(l instanceof h.w.L.Polygon)polygon=l;});assert.equal(polygon.getLatLngs().length,2);assert.ok(polygon.getLatLngs()[0].length>2500);assert.equal(h.writes.length,0);
});

test('a spatial harvest-review candidate appears both on map and in the legend',async t=>{
 const h=fixture(t),geometry=directRaster(h);
 h.w.ForestRasterData.coverage=async()=>({name:'Testgebiet',coverage_ha:6,area_ha:6});
 h.w.ForestRasterData.inventory=async()=>({
   inventory:{age_years:115,basal_area_m2_ha:26,mean_height_m:18,mean_diameter_cm:24,
     volume_m3sk_ha:190,sources:{}},coverage_ha:6,area_ha:6,note:'Testdaten',
   subareas:{parts:[{action:'regeneration',area_ha:3,geometry,
     structure:{age_years:115,height_m:18,basal_area_m2_ha:26}}],
     analyzed_ha:6,unshown_ha:3,method:'Räumliche Testanalyse'}
 });
 await h.w.ForestPlanning.open();h.click('[data-act="draw-quick"]');
 for(const [lng,lat] of geometry.coordinates[0].slice(0,-1))
   h.maps[0].fire('click',{latlng:h.w.L.latLng(lat,lng)});
 h.click('[data-act="finish-draw"]');h.click('[data-act="calculate-zip"]');
 await until(()=>h.d.getElementById('fp-legend').textContent.includes('Ernte / Verjüngung'));
 assert.match(h.d.getElementById('fp-content').textContent,/Räumlich geprüfter Maßnahmenhinweis/);
 assert.match(h.d.getElementById('fp-content').textContent,/KEINE Fällfreigabe/);
 let colored=false;
 h.maps[0].eachLayer(l=>{if(l instanceof h.w.L.Polygon&&l.options.color==='#ba7064')colored=true;});
 assert.ok(colored,'harvest-review polygon must have the matching map color');
 assert.equal(h.writes.length,0);assert.deepEqual(h.errors,[]);
});
