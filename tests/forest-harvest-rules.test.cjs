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
