/* LIGNUM — Geographically scaled 4 m skid-lane footprints.
 * Coordinates: saved centerlines are [latitude, longitude].
 * Corridors and stand intersections use a local metric plane for small forest stands.
 * The model estimates standing stock in corridors, NOT merchantable harvested logs.
 */
(function(root,factory){
  const model=factory();
  if(typeof module==='object'&&module.exports)module.exports=model;
  else root.ForestLanes=model;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const WIDTH_M=4, R=6378137, RAD=Math.PI/180;
  const valid=p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(Number(p[0]))&&Number.isFinite(Number(p[1]))&&Math.abs(Number(p[0]))<=90&&Math.abs(Number(p[1]))<=180;
  const makeProjection=(lat,lng)=>{
    const sy=R*RAD,sx=sy*Math.cos(lat*RAD);
    return {
      toXY:(latitude,longitude)=>[(longitude-lng)*sx,(latitude-lat)*sy],
      toLL:(x,y)=>[lat+y/sy,lng+x/sx],
      toGeo:(x,y)=>[lng+x/sx,lat+y/sy]
    };
  };
  function laneLines(plan){
    if(!plan||plan.deleted_at)return [];
    const parts=Array.isArray(plan.compartments)?plan.compartments:[];
    const lists=parts.length?parts.flatMap(c=>[c.lines]):[plan.lines,plan.edge_lines];
    return lists.flatMap(a=>Array.isArray(a)?a:[]).filter(line=>Array.isArray(line)&&line.length>=2&&line.every(valid));
  }
  function corridor(line,width=WIDTH_M){
    if(!Array.isArray(line)||line.length<2||line.some(p=>!valid(p)))return null;
    const lat=line.reduce((a,p)=>a+Number(p[0]),0)/line.length,
      lng=line.reduce((a,p)=>a+Number(p[1]),0)/line.length,
      projection=makeProjection(lat,lng);
    const pts=[];
    for(const p of line){
      const xy=projection.toXY(Number(p[0]),Number(p[1]));
      if(!pts.length||Math.hypot(xy[0]-pts.at(-1)[0],xy[1]-pts.at(-1)[1])>0.01)pts.push(xy);
    }
    if(pts.length<2)return null;
    const normals=[];
    for(let j=0;j<pts.length-1;j++){
      const dx=pts[j+1][0]-pts[j][0],dy=pts[j+1][1]-pts[j][1],len=Math.hypot(dx,dy);
      normals.push([-dy/len,dx/len]);
    }
    const half=width/2;
    const offset=pts.map((p,i)=>{
      const a=normals[Math.max(0,i-1)],b=normals[Math.min(i,normals.length-1)];
      const sum=[a[0]+b[0],a[1]+b[1]],m=Math.hypot(sum[0],sum[1]);
      if(i===0||i===pts.length-1||m<0.01)return [p[0]+b[0]*half,p[1]+b[1]*half];
      const n=[sum[0]/m,sum[1]/m],dot=Math.abs(n[0]*b[0]+n[1]*b[1]);
      const length=Math.min(half/Math.max(dot,0.01),half*3);
      return [p[0]+n[0]*length,p[1]+n[1]*length];
    });
    const other=pts.map((p,i)=>{
      const a=normals[Math.max(0,i-1)],b=normals[Math.min(i,normals.length-1)];
      const sum=[a[0]+b[0],a[1]+b[1]],m=Math.hypot(sum[0],sum[1]);
      if(i===0||i===pts.length-1||m<0.01)return [p[0]-b[0]*half,p[1]-b[1]*half];
      const n=[sum[0]/m,sum[1]/m],dot=Math.abs(n[0]*b[0]+n[1]*b[1]);
      const length=Math.min(half/Math.max(dot,0.01),half*3);
      return [p[0]-n[0]*length,p[1]-n[1]*length];
    });
    const ring=[...offset,...other.reverse(),offset[0]].map(p=>projection.toGeo(p[0],p[1]));
    return {type:'Polygon',coordinates:[ring]};
  }
  function planFeatures(plan){
    const lines=laneLines(plan);
    return {type:'FeatureCollection',features:lines.map(line=>corridor(line)).filter(Boolean).map(geometry=>({
      type:'Feature',geometry,properties:{plan_id:plan.id||null,plan_name:plan.name||'Fahrgassen-Plan',width_m:WIDTH_M}
    }))};
  }
  function bounds(geometry){
    if(!geometry)return null;
    const g=geometry.type==='Feature'?geometry.geometry:geometry;
    const first=(g.type==='Polygon'?g.coordinates?.[0]?.[0]:g.type==='MultiPolygon'?g.coordinates?.[0]?.[0]?.[0]:null);
    return valid([first?.[1],first?.[0]])?[first[1],first[0]]:null;
  }
  function xyGeom(geom,projection){
    const g=geom?.type==='Feature'?geom.geometry:geom;
    if(!g||!['Polygon','MultiPolygon'].includes(g.type))return null;
    const projectRing=ring=>ring.map(p=>projection.toXY(p[1],p[0]));
    const polygon=rings=>rings.map(projectRing);
    return g.type==='Polygon'?[polygon(g.coordinates)]:g.coordinates.map(polygon);
  }
  function polygonArea(multi){
    if(!Array.isArray(multi))return 0;
    const ringArea=ring=>Math.abs(ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+p[0]*q[1]-q[0]*p[1];},0)/2);
    return multi.reduce((sum,poly)=>sum+Math.max(0,ringArea(poly[0]||[])-(poly.slice(1).reduce((s,ring)=>s+ringArea(ring),0))),0);
  }
  const bbox=poly=>{const b=[Infinity,Infinity,-Infinity,-Infinity];for(const ring of poly)for(const [x,y] of ring){b[0]=Math.min(x,b[0]);b[1]=Math.min(y,b[1]);b[2]=Math.max(x,b[2]);b[3]=Math.max(y,b[3]);}return b;};
  const overlap=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
  // Union the actual 4 m corridor geometry to avoid double-counting crossing
  // and overlapping lanes, then intersect with the chosen stand's real boundary.
  function estimate(plans,forestGeometry,densityM3skHa,polygonClipping){
    const start=bounds(forestGeometry);
    if(!start||!polygonClipping?.union||!polygonClipping?.intersection)return null;
    const projection=makeProjection(...start);
    const area=xyGeom(forestGeometry,projection);
    if(!area||!area.length)return null;
    const forestBBoxes=area.map(bbox);
    const pieces=[];
    let count=0;
    for(const plan of (plans||[])){
      for(const line of laneLines(plan)){
        const polygon=corridor(line);
        if(!polygon)continue;
        const shape=xyGeom(polygon,projection)[0];
        if(!forestBBoxes.some(b=>overlap(b,bbox(shape))))continue;
        pieces.push([shape]);count++;
      }
    }
    if(!pieces.length)return {width_m:WIDTH_M,lanes:0,area_ha:0,stock_m3sk:0,density_m3sk_ha:densityM3skHa==null?null:Number(densityM3skHa)};
    // Prevent a malformed/huge plan from blocking the main-thread map.
    if(pieces.length>1500)return {error:'Zu viele Fahrgassen für eine sichere Flächenberechnung.'};
    try{
      const joined=pieces.length===1?pieces[0]:polygonClipping.union(...pieces);
      const clipped=polygonClipping.intersection(joined,area);
      const areaHa=polygonArea(clipped)/10000;
      const stock=Number.isFinite(Number(densityM3skHa))&&densityM3skHa!=null&&Number(densityM3skHa)>=0
        ? areaHa*Number(densityM3skHa):null;
      return {width_m:WIDTH_M,lanes:count,area_ha:areaHa,stock_m3sk:stock,density_m3sk_ha:densityM3skHa==null?null:Number(densityM3skHa)};
    }catch(error){
      return {error:'Gassenflächen konnten nicht zuverlässig verschnitten werden.'};
    }
  }
  return {WIDTH_M,makeProjection,laneLines,corridor,planFeatures,estimate,polygonArea};
});