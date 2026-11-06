const test=require('node:test');
const assert=require('node:assert/strict');
const T=require('../forest-thinning.js');
const M=require('../forest-model.js');
const stand=(inv,options={})=>({land_type:'forest',hk_class:'G1',area_ha:2,
  inventory:{age_years:45,...inv},...options});

test('documented Skogforsk G26 INGVAR upper and lower basal-area limits',()=>{
  const a=T.evaluate(stand({site_index:'G26',dominant_height_m:12,basal_area_m2_ha:35}));
  const expected=-19.007+18.706*Math.log(12);
  assert.equal(a.status,'recommended');
  assert.ok(Math.abs(a.upper_basal_m2_ha-expected)<.06);
  assert.ok(Math.abs(a.lower_basal_m2_ha-.6*expected)<.06);
  assert.ok(a.removal_pct>0&&a.removal_pct<=35);
  assert.ok(a.basal_after_m2_ha>0);
  assert.equal(a.height_kind,'measured');
});

test('documented T19 coefficients are applied, not a fixed 25 percent',()=>{
  const i={site_index:'T19',dominant_height_m:15};
  const low=T.evaluate(stand({...i,basal_area_m2_ha:25}));
  const high=T.evaluate(stand({...i,basal_area_m2_ha:40}));
  assert.equal(low.status,'none');
  assert.equal(high.status,'recommended');
  assert.notEqual(high.removal_pct,25);
  assert.ok(high.removal_pct<=35);
});

test('later thinning is limited by explicit cautious app cap, not the INGVAR formula',()=>{
  const r=T.evaluate(stand({site_index:'G26',dominant_height_m:14,basal_area_m2_ha:45},{hk_class:'G2'}));
  assert.equal(r.removal_pct,30);
  assert.ok(r.warnings.some(x=>/Etappen/.test(x)));
});

test('without upper height only a sensitivity interval is reported',()=>{
  const r=T.evaluate(stand({site_index:'T19',mean_height_m:12,basal_area_m2_ha:38}));
  assert.equal(r.status,'provisional');
  assert.equal(r.removal_pct,null);
  assert.equal(r.height_kind,'sensitivity-mean-height');
  assert.ok(r.removal_range_pct[0]<=r.removal_range_pct[1]);
  assert.ok(r.warnings.join(' ').includes('Sensitivitätsbereich'));
});

test('ambiguous stand requires measuring upper height before quantitative advice',()=>{
  const r=T.evaluate(stand({site_index:'T19',mean_height_m:12,basal_area_m2_ha:25}));
  assert.equal(r.status,'uncertain');
  assert.equal(r.removal_pct,null);
});

test('no Si or height does not invent a percent',()=>{
  assert.equal(T.evaluate(stand({basal_area_m2_ha:28,mean_height_m:14})).status,'needs-data');
  const x=T.evaluate(stand({basal_area_m2_ha:28,site_index:'T22'}));
  assert.ok(x.missing.includes('dominant_height_m'));
  assert.equal(x.removal_pct,null);
});

test('site index outside published chart is not extrapolated',()=>{
  const r=T.evaluate(stand({basal_area_m2_ha:37,dominant_height_m:14,site_index:'T12'}));
  assert.equal(r.status,'needs-data');
});

test('protected and uneven aged stands do not get normal thinning suggestions',()=>{
  for(const hk of ['NO','NS','E','R']){
    assert.equal(T.evaluate(stand({basal_area_m2_ha:35,dominant_height_m:14,site_index:'G26'},{hk_class:hk})).status,'not-applicable');
  }
  assert.equal(T.evaluate(stand({basal_area_m2_ha:35,dominant_height_m:14,site_index:'G26'},{land_type:'wetland'})).status,'not-applicable');
});

test('incomplete raster coverage blocks whole-area calculation',()=>{
  const r=T.evaluate(stand({basal_area_m2_ha:40,dominant_height_m:15,site_index:'T19',
    sources:{site_index:{area_ha:.6}}}));
  assert.equal(r.status,'needs-data');
});

test('forest model preserves measured upper height and uses new advice',()=>{
  const i=M.inventory({basal_area_m2_ha:36,dominant_height_m:13,mean_height_m:11,
    site_index:'G26',age_years:40});
  assert.equal(i.dominant_height_m,13);
  const r=M.recommend(stand(i,{hk_class:'G1'}));
  assert.equal(r.action,'thinning');
  assert.equal(r.thinning.status,'recommended');
  assert.ok(r.thinning.removal_pct>0);
});

test('existing heuristic must not override contrary INGVAR limit when all inputs available',()=>{
  const r=M.recommend(stand({basal_area_m2_ha:23,dominant_height_m:15,mean_height_m:13,site_index:'G26',age_years:45},{hk_class:'G1'}));
  assert.equal(r.action,'none');
  assert.equal(r.thinning.status,'none');
});

test('percentage of basal area is not silently written into saved logging scenario',()=>{
  const s=stand({basal_area_m2_ha:38,dominant_height_m:14,site_index:'T19',volume_m3sk_ha:200});
  s.removal_pct=0;
  const result=M.recommend(s),scenario=M.scenario(s,2026);
  assert.ok(result.thinning.removal_pct>0);
  assert.equal(scenario.removal,0,'manual logging scenario must be independent');
});

test('P95 laser estimate yields only ±20 % provisional upper-height sensitivity, never measured Hdom',()=>{
  const r=T.evaluate(stand({basal_area_m2_ha:38,site_index:'T19',p95_height_m:14,
    sources:{p95_height_m:{area_ha:2}}}));
  assert.equal(r.status,'provisional');
  assert.equal(r.height_kind,'sensitivity-p95-laser');
  assert.equal(r.removal_pct,null);
  assert.equal(r.basis_height_m,null);
  assert.deepEqual(r.height_range_m,[11.2,16.8]);
  assert.ok(r.warnings.join(' ').includes('nicht statistisch kalibriert'));
});
test('laser P95 can be used provisionally even if old mean-height raster is absent',()=>{
  const r=T.evaluate(stand({basal_area_m2_ha:38,site_index:'T19',p95_height_m:14}));
  assert.equal(r.height_kind,'sensitivity-p95-laser');
  assert.ok(r.removal_range_pct[1]>0);
});
test('sparse P95 is ignored when mean height is adequately covered',()=>{
  const r=T.evaluate(stand({basal_area_m2_ha:38,site_index:'T19',mean_height_m:12,
    p95_height_m:17,sources:{p95_height_m:{area_ha:.5},mean_height_m:{area_ha:2}}}));
  assert.equal(r.height_kind,'sensitivity-mean-height');
  assert.equal(r.removal_pct,null);
});
test('actual plot-based field Hdom overrides P95 and enables measured-input thinning',()=>{
  const measure=M.dominantHeightFromPlots(['12,5; 13,5','14; 14'].join(String.fromCharCode(10)));
  assert.deepEqual(measure.plots,[[12.5,13.5],[14,14]]);
  assert.equal(measure.height_m,13.5);
  const inv=M.inventory({basal_area_m2_ha:38,site_index:'T19',
    dominant_height_m:measure.height_m,dominant_height_plots:measure.plots,p95_height_m:11});
  assert.deepEqual(inv.dominant_height_plots,measure.plots);
  const r=T.evaluate(stand(inv));
  assert.equal(r.height_kind,'measured');
  assert.equal(r.status,'recommended');
});
test('field Hdom requires exactly two plausible measured trees per circle and matching mean',()=>{
  assert.throws(()=>M.dominantHeightFromPlots('12,4; 13,1; 13,6'),/zwei Baumhöhen/);
  assert.throws(()=>M.dominantHeightFromPlots('12,4; 0'),/zwischen 3 und 60/);
  assert.throws(()=>M.inventory({dominant_height_m:15,dominant_height_plots:[[12,13]]}),/überein/);
});
test('spatial planning keeps neighboring 29 and 35 m²/ha thinning zones separate',()=>{
  const R=require('../forest-raster-data.js');
  const proj=require('../vendor/proj4-2.11.0.js');
  const sweref='+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs';
  const pts=[[780000,7410000],[780400,7410000],[780400,7410200],[780000,7410200],[780000,7410000]];
  const geometry={type:'Polygon',coordinates:[pts.map(p=>proj(sweref,'EPSG:4326',p))]};
  const ids=['volume_2','height_2','diameter_2','basal_area_2','age_mixed','site_pine'];
  const constants={volume_2:200,height_2:120,diameter_2:20,age_mixed:45,site_pine:19};
  const sources={},layers={};
  for(const id of ids){
    sources[id]={name:id,scale:id==='height_2'?.1:1,year:2025};
    layers[id]={x:780000,y:7410200,step:10,width:40,height:20,
      runs:id==='basal_area_2'?Array.from({length:20},()=>[[29,20],[35,20]]).flat():[[constants[id],800]]};
  }
  const bounds=[780000,7410000,780400,7410200];
  const index={schema:'lignum-raster-index-v1',sources,tiles:[{file:'sample',bounds}]};
  const tiles=[{file:'sample',data:{schema:'lignum-raster-tile-v1',bounds,layers}}];
  const data=R.evaluate(geometry,index,tiles,{ageType:'mixed',siteSpecies:'T',includeSubareas:true});
  assert.equal(data.subareas.parts.length,2);
  assert.ok(data.subareas.parts.every(p=>p.action==='thinning'&&p.structure.thinningAdvice.status==='provisional'));
  const [low,high]=data.subareas.parts.map(p=>p.structure.thinningAdvice.removal_range_pct[0]).sort((a,b)=>a-b);
  assert.ok(low<high,'different basal-area intensity must remain separate polygons');
});
