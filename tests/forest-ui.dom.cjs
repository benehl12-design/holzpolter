const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{webcrypto}=require('node:crypto');
const {JSDOM,VirtualConsole}=require(process.env.LIGNUM_TEST_JSDOM||'jsdom');
const dir=path.join(__dirname,'..');let leaflet;
test.before(async()=>{leaflet=process.env.LIGNUM_TEST_LEAFLET?fs.readFileSync(process.env.LIGNUM_TEST_LEAFLET,'utf8'):await(await fetch('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js')).text();});
const tick=()=>new Promise(r=>setTimeout(r,5));
async function until(check){for(let i=0;i<100;i++){if(check())return;await tick();}assert.ok(check(),'expected UI transition completed');}
function fixture(t,{role='admin',props=[],stands=[]}={}){
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
  const dom=new JSDOM(fs.readFileSync(path.join(dir,'index.html'),'utf8'),{runScripts:'outside-only',pretendToBeVisual:true,url:'https://lignum.test/',virtualConsole:vc});
  const w=dom.window,d=w.document;
  const css=d.createElement('style');css.textContent=fs.readFileSync(path.join(dir,'forest-planning.css'),'utf8');d.head.append(css);
  w.SVGSVGElement.prototype.createSVGRect=()=>({});
  for(const key of ['clientWidth','offsetWidth'])Object.defineProperty(w.HTMLElement.prototype,key,{get(){return this.id==='fp-map'?500:400;}});
  for(const key of ['clientHeight','offsetHeight'])Object.defineProperty(w.HTMLElement.prototype,key,{get(){return this.id==='fp-map'?400:300;}});
  w.HTMLElement.prototype.getBoundingClientRect=function(){return {left:0,top:0,right:500,bottom:400,width:500,height:400,x:0,y:0};};
  Object.defineProperty(w.navigator,'onLine',{value:false,configurable:true});
  w.eval(leaflet);const maps=[];w.L.Map.addInitHook(function(){maps.push(this);});
  const tables={forest_properties:structuredClone(props),forest_stands:structuredClone(stands),areas:[]},writes=[];
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
  for(const file of ['vendor/proj4-2.11.0.js','vendor/polygon-clipping-0.15.7.js','forest-model.js','forest-raster-data.js','forest-planning.js'])w.eval(fs.readFileSync(path.join(dir,file),'utf8'));
  t.after(()=>{for(const m of maps)m.remove();dom.window.close();});
  const click=sel=>{const b=d.querySelector(sel);assert.ok(b,'button exists: '+sel);b.click();};
  const set=(name,value)=>{const input=d.querySelector(`[name="${name}"]`);assert.ok(input,'input exists '+name);input.value=value;};
  const submit=()=>{d.getElementById('fp-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));};
  return {w,d,tables,writes,errors,maps,click,set,submit};
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
