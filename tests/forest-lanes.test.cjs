const test=require('node:test');
const assert=require('node:assert/strict');
const Lanes=require('../forest-lanes.js');
const polygonClipping=require('../vendor/polygon-clipping-0.15.7.js');
const projection=Lanes.makeProjection(67,20);
const LL=(x,y)=>projection.toLL(x,y);
const boundary=(x0,y0,x1,y1)=>({type:'Polygon',coordinates:[[
  [x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]
].map(([x,y])=>{const [lat,lng]=LL(x,y);return [lng,lat];})]});
const line=(y,x0=0,x1=100)=>[LL(x0,y),LL(x1,y)];
const plan=(lines)=>({id:'plan',name:'Test',compartments:[{spacing_m:20,lines}]});
test('map footprint width is 4 metres irrespective of latitude or zoom',()=>{
  const poly=Lanes.corridor(line(30));
  assert.equal(poly.type,'Polygon');
  const coords=poly.coordinates[0].map(p=>projection.toXY(p[1],p[0]));
  assert.ok(Math.abs(coords[0][1]-coords[coords.length-2][1])-4<.005);
  const a=Lanes.estimate([plan([line(30)])],boundary(0,0,100,100),200,polygonClipping);
  assert.ok(Math.abs(a.area_ha-.04)<.0001,JSON.stringify(a));
  assert.ok(Math.abs(a.stock_m3sk-8)<.03);
});
test('20 metre spacing is measured centre to centre with 16 metres of clear gap',()=>{
  const x=projection.toXY(...line(30)[0]),y=projection.toXY(...line(50)[0]);
  assert.ok(Math.abs(Math.hypot(y[0]-x[0],y[1]-x[1])-20)<.01);
  const a=Lanes.estimate([plan([line(30),line(50)])],boundary(0,0,100,100),200,polygonClipping);
  assert.ok(Math.abs(a.area_ha-.08)<.0002);
  assert.ok(Math.abs(a.stock_m3sk-16)<.05);
});
test('crossing or duplicate lanes are not counted twice',()=>{
  const a=Lanes.estimate([plan([line(30),line(30)])],boundary(0,0,100,100),200,polygonClipping);
  assert.ok(Math.abs(a.area_ha-.04)<.0001);
  assert.equal(a.lanes,2);
});
test('geometry clipped to selected forest boundary and area only from inside it',()=>{
  const a=Lanes.estimate([plan([line(30,-50,50)])],boundary(0,0,100,100),200,polygonClipping);
  assert.ok(Math.abs(a.area_ha-.02)<.0001);
  assert.ok(Math.abs(a.stock_m3sk-4)<.03);
});
test('old-style plans still work and connectors are not treated as harvested forest',()=>{
  const p={id:'old',lines:[line(30)],edge_lines:[line(50)],connectors:[line(70)]};
  assert.equal(Lanes.laneLines(p).length,2);
  const r=Lanes.estimate([p],boundary(0,0,100,100),null,polygonClipping);
  assert.equal(r.stock_m3sk,null);
  assert.ok(Math.abs(r.area_ha-.08)<.0002);
});
test('plan feature collections can render every saved compartment',()=>{
  const result=Lanes.planFeatures(plan([line(30),line(50)]));
  assert.equal(result.features.length,2);
  assert.equal(result.features[0].properties.width_m,4);
  assert.equal(result.features[1].geometry.type,'Polygon');
});