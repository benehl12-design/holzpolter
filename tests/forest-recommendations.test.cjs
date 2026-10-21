const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../forest-model.js');
test('wetland remains protected',()=>assert.equal(M.recommend({land_type:'wetland',inventory:{}}).action,'none'));
test('mixed stands need separate treatment',()=>{const r=M.recommendParts([{land_type:'forest',hk_class:'R',inventory:{}},{land_type:'forest',hk_class:'G1',inventory:{}}]);assert.equal(r.uniform,false);assert.equal(r.action,null);});
