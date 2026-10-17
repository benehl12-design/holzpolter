const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../forest-raster-data.js'),proj=require('../vendor/proj4-2.11.0.js');
const sweref='+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs';
const geo=(x1=780000,y1=7410000,x2=780020,y2=7410010)=>({type:'Polygon',coordinates:[[[x1,y1],[x2,y1],[x2,y2],[x1,y2],[x1,y1]].map(p=>proj(sweref,'EPSG:4326',p))]});
function fixture(values={volume_2:[100,300]},options={}){
  const b=[780000,7410000,780020,7410010],sources={},layers={};
  for(const [id,v] of Object.entries(values)){
    sources[id]={name:id,year:id.startsWith('age_')?2025:null,scale:id.startsWith('height_')?.1:1};
    layers[id]={x:b[0],y:b[3],step:10,width:2,height:1,runs:v.map(n=>[n,1])};
  }
  const index={schema:'lignum-raster-index-v1',sources,tiles:[{file:'tile.json',bounds:b}]};
  const tiles=[{file:'tile.json',data:{schema:'lignum-raster-tile-v1',bounds:b,layers}}];
  return {index,tiles,result:(g=geo())=>R.evaluate(g,index,tiles,options)};
}
test('native fractional cells give weighted means and true covered stock',()=>{
  const i=fixture().result(geo(780000,7410000,780015,7410010)).inventory;
  assert.ok(Math.abs(i.volume_m3sk_ha-500/3)<1e-4);assert.ok(Math.abs(i.volume_m3sk-2.5)<1e-5);assert.ok(Math.abs(i.stock_area_ha-.015)<1e-6);
});
test('new cycle wins; NoData falls back; a newer zero never resurrects old forest',()=>{
  const i=fixture({volume_3:[0,-1],volume_2:[100,300]}).result().inventory;
  assert.ok(Math.abs(i.volume_m3sk_ha-300)<1e-6);assert.ok(Math.abs(i.stock_area_ha-.01)<1e-6);
  assert.deepEqual(i.sources.volume_m3sk_ha.datasets.map(s=>s.name),['volume_2']);
  const j=fixture({volume_3:[200,-1],volume_2:[100,300]}).result().inventory;
  assert.ok(Math.abs(j.volume_m3sk_ha-250)<1e-5);assert.equal(j.sources.volume_m3sk_ha.datasets.length,2);
});
test('height uses decimetres and the ZIP date is never an acquisition year',()=>{
  const i=fixture({volume_2:[100,300],height_2:[170,190]}).result().inventory;
  assert.ok(Math.abs(i.mean_height_m-18)<1e-5);assert.equal(i.reference_year,undefined);assert.equal(i.scan_year,undefined);assert.equal(i.sources.volume_m3sk_ha.year,null);
});
test('age and SIS require the explicit forest and site types',()=>{
  const f=fixture({age_pine:[80,100],age_mixed:[30,50],site_pine:[18,20]});
  assert.equal(f.result().inventory.age_years,undefined);
  const out=R.evaluate(geo(),f.index,f.tiles,{ageType:'mixed',siteSpecies:'T'}).inventory;
  assert.equal(out.age_years,40);assert.equal(out.sources.age_years.year,2025);assert.equal(out.site_index,'T19');assert.equal(out.reference_year,undefined);
});
test('species include contorta, oak, beech and broadleaf and share the same valid cells',()=>{
  const i=fixture({species_pine:[50,50],species_spruce:[0,-1],species_birch:[10,10],species_broadleaf:[10,10],species_contorta:[20,20],species_oak:[5,5],species_beech:[5,5]}).result().inventory;
  assert.ok(Math.abs(i.sources.species_pct.area_ha-.01)<1e-6);
  assert.deepEqual(i.species_pct,{pine:50,spruce:0,birch:10,other:40});
});
test('2018 percentage maps use exact 12.5m/10m intersections and volume weighting',()=>{
  const values={volume_2:[100,300]};
  for(const key of ['pine','spruce','birch','broadleaf','contorta','oak','beech'])values['species2018_'+key]=key==='pine'?[100,0]:key==='spruce'?[0,100]:[0,0];
  const f=fixture(values);for(const [id,layer] of Object.entries(f.tiles[0].data.layers))if(id.startsWith('species2018_'))Object.assign(layer,{step:12.5,y:7410012.5});
  const r=f.result().inventory;assert.ok(Math.abs(r.species_pct.pine-43.75)<1e-5);assert.ok(Math.abs(r.species_pct.spruce-56.25)<1e-5);assert.equal(r.sources.species_pct.product_year,2018);assert.ok(Math.abs(r.sources.species_pct.area_ha-.02)<1e-6);
});
test('2018 species exclude missing current volume and normalize rounded cell percentages',()=>{
  const values={volume_2:[100,-1]};
  for(const key of ['pine','spruce','birch','broadleaf','contorta','oak','beech'])values['species2018_'+key]=key==='pine'?[67,0]:key==='spruce'?[34,100]:[0,0];
  const i=fixture(values).result().inventory;assert.ok(Math.abs(i.species_pct.pine-67/101*100)<1e-5);assert.ok(Math.abs(i.sources.species_pct.area_ha-.01)<1e-6);
});
test('partial regional coverage is reported and never extrapolated',()=>{
  const r=fixture({volume_2:[100,100]}).result(geo(780000,7410000,780040,7410010));
  assert.ok(Math.abs(r.coverage_ha-.02)<1e-6);assert.ok(Math.abs(r.area_ha-.04)<1e-6);assert.ok(Math.abs(r.inventory.volume_m3sk-2)<1e-5);
});
test('holes are excluded and a MultiPolygon is evaluated without the space between it',()=>{
  const g=geo();g.coordinates.push(geo(780005,7410002,780015,7410008).coordinates[0].reverse());
  const r=fixture({volume_2:[100,100]}).result(g);assert.ok(Math.abs(r.inventory.stock_area_ha-.014)<1e-6);
  const m={type:'MultiPolygon',coordinates:[geo(780000,7410000,780005,7410010).coordinates,geo(780015,7410000,780020,7410010).coordinates]};
  assert.ok(Math.abs(fixture({volume_2:[100,100]}).result(m).inventory.stock_area_ha-.01)<1e-6);
});
test('a missing tile or damaged RLE aborts instead of returning a misleading partial result',()=>{
  const f=fixture();assert.throws(()=>R.evaluate(geo(),f.index,[]),/fehlt/);
  f.tiles[0].data.layers.volume_2.runs=[[100,1]];assert.throws(()=>f.result(),/Unvollständige/);
  assert.throws(()=>R.decode({width:2,height:1,step:10,runs:[[100,3]]}),/Beschädigte/);
});
test('inventory refresh clears stale stock and years but preserves unrequested age and user assumptions',()=>{
  const r=fixture({volume_2:[-1,0]}).result();
  const i=R.merge({volume_m3sk:800,volume_m3sk_ha:300,stock_area_ha:3,reference_year:2025,projected_to_year:2026,age_years:80,annual_growth_m3sk_ha:2,sources:{volume_m3sk_ha:{name:'old'},age_years:{year:2025}}},r);
  assert.equal(i.volume_m3sk,undefined);assert.equal(i.reference_year,undefined);assert.equal(i.projected_to_year,undefined);assert.equal(i.sources.volume_m3sk_ha,undefined);assert.equal(i.age_years,80);assert.equal(i.annual_growth_m3sk_ha,2);
});
test('the real worker imports offline modules and produces the same native-cell result',()=>{
  const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),f=fixture();let result;
  const sandbox={postMessage:value=>{result=value;}};sandbox.self=sandbox;
  const context=vm.createContext(sandbox);
  sandbox.importScripts=(...files)=>{for(const file of files)vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);};
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../forest-raster-worker.js'),'utf8'),context);
  sandbox.onmessage({data:{geometry:geo(),index:f.index,tiles:f.tiles,options:{}}});
  assert.equal(result.error,undefined);assert.ok(Math.abs(result.result.inventory.volume_m3sk_ha-200)<1e-5);
});
test('cached public grids survive a page restart offline and honour the GitHub Pages subpath',async()=>{
  const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),f=fixture(),saved=new Map(),requests=[];
  const cache={match:async key=>saved.get(key)?.clone(),put:async(key,response)=>saved.set(key,response.clone())};
  function load(online){
    const context=vm.createContext({URL,Response,AbortSignal,setTimeout,clearTimeout,document:{baseURI:'https://example.test/holzpolter/'},caches:{open:async()=>cache},fetch:async url=>{
      requests.push({url,online});assert.match(url,/\/holzpolter\/data\/forest-rasters\//);
      if(!online)throw Error('Network unavailable');return Response.json(url.endsWith('index.json')?f.index:f.tiles[0].data);
    }});
    for(const file of ['vendor/proj4-2.11.0.js','vendor/polygon-clipping-0.15.7.js','forest-raster-data.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
    return context.ForestRasterData;
  }
  const first=await load(true).inventory(geo());const reopened=await load(false).inventory(geo());
  assert.ok(Math.abs(reopened.inventory.volume_m3sk-first.inventory.volume_m3sk)<1e-7);
  assert.equal(saved.size,2);assert.equal(requests.filter(r=>!r.online).length,1);
});
