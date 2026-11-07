const test=require('node:test');
const assert=require('node:assert/strict');
const H=require('../forest-harvest-rules.js');
const M=require('../forest-model.js');
const base={age:75,basal:25,height:18,diameter:24,volume:180,pine_pct:78,spruce_pct:12,site_index:'T24'};
test('Skogsstyrelsen northern site-index age references are conservative',()=>{
 for(const [si,years] of [['T12',100],['G16',90],['T20',80],['G24',70],['T28',65],['T25',70],['G19',90]])
  assert.equal(H.minAgeNorth(si)?.years,years,si);
 for(const si of ['',null,'T9','G35','X24','T33'])assert.equal(H.minAgeNorth(si),null,si);
});
test('site-index and known conifer dominance can flag an early mature harvest review',()=>{
 const r=H.harvestReview(base);
 assert.equal(r.candidate,true);
 assert.equal(r.benchmarkYears,70);
 assert.equal(r.legalAgeVerified,false);
 assert.equal(r.protectionVerified,false);
 assert.match(r.warning,/KEINE Fällfreigabe/);
});
test('unknown site, inferred site or unknown tree shares fall back to 100-year screen',()=>{
 for(const input of [{...base,site_index:''},{...base,allowSiteReference:false},{...base,pine_pct:null,spruce_pct:null}]){
  const r=H.harvestReview(input);
  assert.equal(r.benchmarkYears,100);
  assert.equal(r.candidate,false);
 }
});
test('same threshold with missing diameter or low stock never qualifies',()=>{
 for(const input of [{...base,diameter:null},{...base,volume:50},{...base,basal:8},{...base,age:60}])
  assert.equal(H.harvestReview(input).candidate,false);
});
test('aggregate model uses shared site reference but never calls it a felling permit',()=>{
 const r=M.recommend({land_type:'forest',area_ha:5,inventory:{
   age_years:75,basal_area_m2_ha:25,mean_height_m:18,mean_diameter_cm:24,volume_m3sk_ha:180,
   site_index:'T24',species_pct:{pine:78,spruce:12,birch:10,other:0}}});
 assert.equal(r.action,'regeneration');
 assert.equal(r.screening.benchmarkYears,70);
 assert.equal(r.review,true);assert.match(r.reason,/KEINE Fällfreigabe/);
});
test('automatically guessed site species does not lower the aggregate threshold',()=>{
 const r=M.recommend({land_type:'forest',area_ha:5,inventory:{
   age_years:75,basal_area_m2_ha:25,mean_height_m:18,mean_diameter_cm:24,volume_m3sk_ha:180,
   site_index:'T24',species_pct:{pine:78,spruce:12,birch:10,other:0},
   sources:{site_index:{area_ha:5,site_species_inferred:true}}}});
 assert.notEqual(r.action,'regeneration');
});


test('real 8.87 ha northern mixed stand T17 and G15 shows approaching end-use, never a harvest permit',()=>{
 const inventory={age_years:89,volume_m3sk_ha:132.3,basal_area_m2_ha:19.8,
   mean_height_m:13,mean_diameter_cm:18,p95_height_m:13,site_index_pine:17,site_index_spruce:15,
   scan_year:2021,species_pct:{pine:53,spruce:28,birch:19,other:0},
   sources:{site_index_pine:{area_ha:8.87},site_index_spruce:{area_ha:8.87}}};
 const stand={land_type:'forest',hk_class:'',area_ha:8.87,action:'none',removal_pct:0,inventory};
 const a=H.endUseAssessment(stand);
 assert.equal(a.status,'approaching');
 assert.equal(a.candidate,false);
 assert.deepEqual(a.references.map(x=>[x.site_index,x.min_age_years,x.age_gap_years]),[['T17',90,1],['G15',100,11]]);
 assert.equal(a.legalAgeVerified,false);assert.equal(a.economicOptimumVerified,false);
 assert.equal(M.endUseAssessment(stand).status,'approaching');
 assert.equal(stand.action,'none');assert.equal(inventory.site_index,undefined);
});
test('mature northern pine T24 can be recommended only for a field maturity review',()=>{
 const a=H.endUseAssessment({land_type:'forest',area_ha:5,inventory:{
   age_years:95,basal_area_m2_ha:25,mean_height_m:18,mean_diameter_cm:24,volume_m3sk_ha:180,
   site_index:'T24',species_pct:{pine:78,spruce:12,birch:10,other:0}}});
 assert.equal(a.status,'candidate');
 assert.equal(a.candidate,true);
 assert.equal(a.references[0].min_age_years,70);
 assert.equal(a.legalAgeVerified,false);
 assert.equal(a.protectionVerified,false);
 assert.equal(a.economicOptimumVerified,false);
});
test('young stands and insufficient wood quality are not a final harvest recommendation',()=>{
 const inv={age_years:50,basal_area_m2_ha:25,mean_height_m:18,mean_diameter_cm:24,volume_m3sk_ha:180,
   site_index:'T24',species_pct:{pine:80,spruce:10,birch:10,other:0}};
 assert.equal(H.endUseAssessment({land_type:'forest',inventory:inv}).status,'not-yet');
 const sparse={...inv,age_years:105,volume_m3sk_ha:40};
 assert.equal(H.endUseAssessment({land_type:'forest',inventory:sparse}).status,'structure-review');
});
test('poor age raster coverage, protected forest and unsupported SIS do not yield false maturity',()=>{
 const base={age_years:105,basal_area_m2_ha:25,mean_height_m:18,mean_diameter_cm:24,volume_m3sk_ha:180,
   species_pct:{pine:70,spruce:20,birch:10,other:0}};
 assert.equal(H.endUseAssessment({land_type:'forest',hk_class:'NO',inventory:base}).status,'not-applicable');
 const sparse={...base,site_index_pine:24,sources:{site_index_pine:{area_ha:1}}};
 assert.equal(H.endUseAssessment({land_type:'forest',area_ha:5,inventory:sparse}).candidate,false);
 const weird={...base,site_index:'T33'};
 assert.equal(H.endUseAssessment({land_type:'forest',inventory:weird}).status,'needs-review');
 const ageSparse={...base,site_index:'T24',sources:{age_years:{area_ha:1}}};
 assert.equal(H.endUseAssessment({land_type:'forest',area_ha:5,inventory:ageSparse}).candidate,false);
});
test('unknown Standorttyp age 115 is only the non-statutory conservative 100 year screening',()=>{
 const a=H.endUseAssessment({land_type:'forest',inventory:{age_years:115,
   basal_area_m2_ha:26,mean_height_m:18,mean_diameter_cm:24,volume_m3sk_ha:190}});
 assert.equal(a.status,'candidate');
 assert.equal(a.references[0].legal_reference,false);
 assert.match(a.warnings.join(' '),/keine gesetzliche Altersfreigabe/);
});
test('mostly birch is not tested under northern conifer minimum ages',()=>{
 const a=H.endUseAssessment({land_type:'forest',inventory:{age_years:85,basal_area_m2_ha:21,
   mean_height_m:17,mean_diameter_cm:19,volume_m3sk_ha:140,
   species_pct:{pine:10,spruce:15,birch:70,other:5},site_index:'T17'}});
 assert.equal(a.status,'needs-review');assert.equal(a.candidate,false);
 assert.match(a.reason,/Nadelholz-Alterstabelle/);
});
