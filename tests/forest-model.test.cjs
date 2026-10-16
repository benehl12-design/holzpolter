const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../forest-model'),proj4=require('../vendor/proj4-2.11.0');
const crs='+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs';
function square(x=780000,y=7410000,size=100){return M.geometry({type:'Polygon',coordinates:[[[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]]]},'EPSG:3006');}
const sample=(extra={})=>M.stand({name:'Test',number:'1',area_ha:2,land_type:'forest',inventory:{},...extra});
test('SWEREF99 TM geometry and WKT retain hectare area and coordinate order',()=>{
  const g=square();assert.ok(Math.abs(M.area(g)-1)<.000001);assert.match(M.wkt(g),/^POLYGON \(\(780000 7410000,/);
  const f=M.parseGeoJSON({type:'FeatureCollection',crs:{type:'name',properties:{name:'EPSG:3006'}},features:[{type:'Feature',properties:{name:'Imported'},geometry:{type:'Polygon',coordinates:[[[780000,7410000],[780100,7410000],[780100,7410100],[780000,7410100],[780000,7410000]]]}}]});
  assert.ok(Math.abs(f[0].area_ha-1)<.000001);
});
test('self-crossing boundaries, overlaps and stands outside a property are rejected',()=>{
  assert.throws(()=>M.geometry({type:'Polygon',coordinates:[[[22,67],[22.01,67.01],[22.01,67],[22,67.01],[22,67]]]}),/kreuzt/);
  const p={geometry:square(780000,7410000,200),area_ha:4};
  assert.throws(()=>M.validateLayout(p,[sample({geometry:square()}),sample({geometry:square(780050)})]),/überschneiden/);
  assert.throws(()=>M.validateLayout(p,[sample({geometry:square(781000)})]),/außerhalb/);
  M.validateLayout(p,[sample({geometry:square()}),sample({geometry:square(780100)})]);
});
test('holes and MultiPolygons retain their areas and cannot double-count components',()=>{
  const outer=square(780000,7410000,200),hole=square(780050,7410050,100);
  const g=M.geometry({type:'Polygon',coordinates:[outer.coordinates[0],hole.coordinates[0]]});
  assert.ok(Math.abs(M.area(g)-3)<.000001);
  assert.throws(()=>M.geometry({type:'Polygon',coordinates:[outer.coordinates[0],square(781000).coordinates[0]]}),/Aussparung/);
  const multi=M.geometry({type:'MultiPolygon',coordinates:[square().coordinates,square(780200).coordinates]});assert.ok(Math.abs(M.area(multi)-2)<.000001);
  assert.throws(()=>M.geometry({type:'MultiPolygon',coordinates:[square().coordinates,square(780050).coordinates]}),/überschneiden/);
});
test('unknown stock and incomplete raster coverage are not counted as zero or extrapolated',()=>{
  const a=sample({area_ha:5,inventory:{volume_m3sk_ha:200,stock_area_ha:3}}),b=sample({number:'2',area_ha:2});
  const s=M.summary([a,b],{area_ha:10});assert.equal(s.total,600);assert.equal(s.knownArea,3);assert.equal(s.unknownArea,4);assert.equal(s.density,200);assert.equal(s.propertyArea,10);
  assert.equal(M.summary([b]).total,null);assert.equal(M.summary([sample({inventory:{volume_m3sk_ha:0}})]).total,0);
});
test('species proportions, data units and inventory numbers are validated',()=>{
  assert.throws(()=>sample({inventory:{species_pct:{pine:60,spruce:30,birch:0,other:0}}}),/100/);
  assert.throws(()=>sample({inventory:{volume_m3sk_ha:-2}}),/Vorrat/);
  assert.throws(()=>sample({inventory:{mean_height_m:'not-a-number'}}),/Zahl/);
  assert.throws(()=>sample({area_ha:2,inventory:{volume_m3sk_ha:100,volume_m3sk:1000}}),/widersprechen/);
  const s=sample({inventory:{volume_m3sk_ha:'200,5',species_pct:{pine:60,spruce:35,birch:5,other:0}}});assert.equal(M.stock(s),401);
});
test('partial age and species raster coverage cannot inflate property distributions',()=>{
  const s=sample({area_ha:3,inventory:{volume_m3sk_ha:200,age_years:50,species_pct:{pine:60,spruce:30,birch:10,other:0},sources:{age_years:{area_ha:1},species_pct:{area_ha:1}}}});
  const sum=M.summary([s]);assert.equal(sum.ageKnown,1);assert.equal(sum.ageBands[40],1);assert.equal(sum.speciesKnown,0);assert.deepEqual(sum.species,{});
});
test('volume projection retains its own source year when a newer age raster is imported',()=>{
  const s=sample({inventory:{volume_m3sk_ha:100,scan_year:2025,reference_year:2025,annual_growth_m3sk_ha:2,sources:{volume_m3sk_ha:{year:2015},age_years:{year:2025}}}});
  assert.equal(M.scenario(s,2026).year,2015);assert.equal(M.scenario(s,2026).projected,244);
  assert.equal(M.referenceYear({sources:{volume_m3sk_ha:{scan_date:'2021-01-01',scan_date_end:'2022-01-01'}},scan_year:2022}),null);
});
test('planning scenarios preserve original inventory and only project when a growth assumption exists',()=>{
  const s=sample({area_ha:3,removal_pct:25,inventory:{volume_m3sk_ha:200,reference_year:2022,annual_growth_m3sk_ha:4,price_sek_m3sk:500}});
  assert.deepEqual(M.scenario(s,2026),{stock:600,removal:150,remaining:450,projected:648,year:2022,gross:75000});
  assert.equal(s.inventory.volume_m3sk_ha,200);assert.equal(M.scenario(sample({inventory:{volume_m3sk_ha:200}}),2030).projected,null);
});
test('CSV supports Swedish decimal commas, quoted names and explicit missing fields',()=>{
  const rows=M.parseCSV('number;name;area_ha;volume_m3sk_ha;pine_pct;spruce_pct;birch_pct;other_pct\n1;"Süd; Fläche";3,5;200;60;30;10;0\n2;Leer;2;;;;;');
  assert.equal(rows[0].name,'Süd; Fläche');assert.equal(M.stock(rows[0]),700);assert.equal(M.stock(rows[1]),null);
  assert.throws(()=>M.parseCSV('name;area_ha\n"bad;2'),/Anführungszeichen/);
});
test('export and reimport preserve unit-bearing inventory, planning and source metadata',()=>{
  const source=sample({geometry:square(),action:'thinning',removal_pct:23,inventory:{volume_m3sk_ha:210,scan_year:2021,source_label:'SLU',species_pct:{pine:50,spruce:40,birch:10,other:0}}});
  const [restored]=M.parseGeoJSON(M.featureCollection([source]));assert.deepEqual(restored,source);
});
test('official API v1.1 mapping uses AllSkogsmark, respects units and clamps only raster edge effects',async()=>{
  const {mapResponses,geometryParameters}=await import('../supabase/functions/forest-data/skogs-adapter.mjs');
  const metadata={minDatum:'2022-04-01',maxDatum:'2022-06-01',omdrev:2,pixelstorlek:2};
  const result=mapResponses({Volym:{data:{AllSkogsmark:{arealHa:1.001,medel:200,total:200.2}},metadata},Medelhojd:{data:{AllSkogsmark:{arealHa:1,medel:17}},metadata},Medeldiameter:{data:{AllSkogsmark:{arealHa:1,medel:22}},metadata},Grundyta:{data:{AllSkogsmark:{arealHa:1,medel:21}},metadata}},1);
  assert.equal(result.inventory.volume_m3sk,200);assert.equal(result.inventory.mean_height_m,17);assert.equal(result.inventory.mean_diameter_cm,22);assert.equal(result.inventory.scan_year,2022);
  const params=geometryParameters(square(),p=>proj4('EPSG:4326',crs,p));assert.deepEqual(params.parameters.marktyper,['AllSkogsmark']);assert.equal(params.parameters.pixelstorlek,2);
  assert.throws(()=>mapResponses({Volym:{data:{AllSkogsmark:{medel:0,arealHa:1}}}},1),/keine auswertbaren/);
  const partial=mapResponses({Medelhojd:{data:{AllSkogsmark:{arealHa:1,medel:17}},metadata}},1);
  assert.ok(!Object.hasOwn(partial.inventory,'scan_year'));assert.ok(!Object.hasOwn(partial.inventory,'reference_year'));
});
