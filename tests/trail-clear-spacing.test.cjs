const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const cut=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start);assert.ok(start>=0&&end>start,'expected segment '+a);return source.slice(start,end);};
function harness(){
  const customInput={value:'',classList:{toggle(){}}};
  const chips=[15,20,25,30].map(n=>({dataset:{spc:String(n)},classList:{toggle(k,on){this.on=on;}}}));
  const stand={manual:false,spacing:20,lines:[]},updates=[];
  const ctx={console,Number,Math,isFinite,parseFloat,
    document:{querySelectorAll:()=>chips,getElementById:()=>customInput,activeElement:null},
    setTimeout:fn=>{fn();return 1;},clearTimeout:()=>{},
    _renderTrailPreview:()=>updates.push('preview'),
    cmpGetSelected:()=>stand,cmpApplySpacing:()=>updates.push('manual'),cmpRegenLines:()=>updates.push('auto')
  };
  vm.createContext(ctx);
  vm.runInContext(cut('const TRAIL_LANE_WIDTH_M = 4;','let _trailOrientationMode'),ctx);
  vm.runInContext(cut('function setTrailSpacing(m) {','function setTrailOrientation(mode)'),ctx);
  vm.runInContext(cut('function cmpSetSpacing(v) {','function cmpToggleSplit()'),ctx);
  const value=expr=>vm.runInContext(expr,ctx);
  return {ctx,stand,chips,customInput,updates,value};
}
test('entered 20 m is clear edge-to-edge; generated centre spacing is 24 m',()=>{
  const h=harness();
  assert.equal(h.value('_trailSpacing'),24);
  assert.equal(h.value('trailCenterSpacing(20)'),24);
  assert.equal(h.value('trailClearSpacing(24)'),20);
  h.value('setTrailSpacing(20)');
  assert.equal(h.value('_trailSpacing'),24);
  assert.equal(h.customInput.value,20);
  assert.equal(h.chips[1].on,true);
  h.value('setTrailSpacingCustom("25")');
  assert.equal(h.value('_trailSpacing'),29);
  assert.ok(h.updates.includes('preview'));
});
test('automatic and manual compartments use the same clear 20 m -> 24 m centres',()=>{
  const h=harness();
  h.value('cmpSetSpacing(20)');
  assert.equal(h.stand.spacing,24);
  assert.deepEqual(h.updates,['auto']);
  h.stand.manual=true;
  h.value('cmpSetSpacing(30)');
  assert.equal(h.stand.spacing,34);
  assert.deepEqual(h.updates,['auto','manual']);
});
test('existing saved centre-to-centre distances stay unchanged; only their labels convert',()=>{
  const h=harness();
  assert.equal(h.value('trailClearSpacing(20)'),16);
  assert.equal(h.value('trailClearSpacing(24)'),20);
  assert.match(source,/spacing:\s*sc\.spacing_m\|\|_trailSpacing/);
  assert.match(source,/spacing_m:\s*c\.spacing/);
  assert.match(source,/spacing_m:\s*comps\[0\]\.spacing_m/);
  assert.match(source,/trailClearSpacing\(c\.spacing\)/);
});
test('both editors explicitly label the free forest gap and retain 4 metre lane width',()=>{
  assert.match(source,/Freier Wald zwischen den Gassen \(Rand–Rand\)/);
  assert.match(source,/Gassenbreite:<\/b> 4 m/);
  assert.match(source,/Freier Wald \(Rand–Rand\)/);
  assert.match(source,/Freier Wald<\/span>/);
  assert.match(source,/20 m freiem Wald und 4 m Gassenbreite liegen die Gassenmitten 24 m auseinander/);
});