const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../forest-model.js');
test('wetland remains protected',()=>assert.equal(M.recommend({land_type:'wetland',inventory:{}}).action,'none'));
test('mixed stands need separate treatment',()=>{const r=M.recommendParts([{land_type:'forest',hk_class:'R',inventory:{}},{land_type:'forest',hk_class:'G1',inventory:{}}]);assert.equal(r.uniform,false);assert.equal(r.action,null);});

test('uses observed age, basal area and height without a manually assigned class',()=>{
 const r=M.recommend({land_type:'forest',area_ha:3,inventory:{age_years:45,basal_area_m2_ha:27,mean_height_m:16}});
 assert.equal(r.action,'thinning');assert.equal(r.confidence,'medium');assert.equal(r.review,true);
});
test('does not recommend thinning when ground area is low',()=>{
 assert.equal(M.recommend({land_type:'forest',inventory:{age_years:45,basal_area_m2_ha:9,mean_height_m:17}}).action,'none');
});
test('does not extrapolate from sparse raster coverage',()=>{
 const r=M.recommend({land_type:'forest',area_ha:10,inventory:{age_years:45,basal_area_m2_ha:27,mean_height_m:16,sources:{age_years:{area_ha:2}}}});
 assert.equal(r.action,'none');assert.ok(r.missing.includes('age_years'));
});
test('unknown age with stock volume alone cannot imply thinning',()=>{
 assert.equal(M.recommend({land_type:'forest',inventory:{volume_m3sk_ha:180}}).action,'none');
});

test('mature well-stocked forest is only flagged for a harvest review',()=>{
 const r=M.recommend({land_type:'forest',area_ha:6,inventory:{
 age_years:115,basal_area_m2_ha:25,mean_height_m:18,mean_diameter_cm:24,volume_m3sk_ha:190}});
 assert.equal(r.action,'regeneration');
 assert.equal(r.confidence,'low');
 assert.equal(r.review,true);
 assert.match(r.reason,/KEINE Fällfreigabe/);
});
test('forest with immature age cannot be automatically marked as regeneration',()=>{
 const r=M.recommend({land_type:'forest',area_ha:6,inventory:{
 age_years:65,basal_area_m2_ha:25,mean_height_m:18,mean_diameter_cm:24,volume_m3sk_ha:190}});
 assert.notEqual(r.action,'regeneration');
});
test('missing diameter or low stock does not qualify harvest review',()=>{
 for(const inventory of [
 {age_years:115,basal_area_m2_ha:25,mean_height_m:18,volume_m3sk_ha:190},
 {age_years:115,basal_area_m2_ha:25,mean_height_m:18,mean_diameter_cm:24,volume_m3sk_ha:60}
 ])assert.notEqual(M.recommend({land_type:'forest',inventory}).action,'regeneration');
});
test('protected stand never receives an automatic harvest flag',()=>{
 const r=M.recommend({land_type:'forest',hk_class:'NO',inventory:{
 age_years:150,basal_area_m2_ha:30,mean_height_m:22,mean_diameter_cm:27,volume_m3sk_ha:300}});
 assert.equal(r.action,'nature');
});
test('sparse raster coverage prevents a whole-area harvest recommendation',()=>{
 const r=M.recommend({land_type:'forest',area_ha:10,inventory:{
 age_years:115,basal_area_m2_ha:25,mean_height_m:18,mean_diameter_cm:24,volume_m3sk_ha:190,
 sources:{age_years:{area_ha:2}}}});
 assert.notEqual(r.action,'regeneration');
});
