// Schema verified against Skogsstyrelsen Skogliga grunddata API 1.1, 2026-10-16.
export const API='https://api.skogsstyrelsen.se/sksapi/skogligagrunddata/v1.1';
export const ENDPOINTS={Volym:'volume_m3sk_ha',Medelhojd:'mean_height_m',Medeldiameter:'mean_diameter_cm',Grundyta:'basal_area_m2_ha'};
export function geometryParameters(g,project){
  if(!g||!['Polygon','MultiPolygon'].includes(g.type))throw Error('Eine Polygon-Flächengrenze ist erforderlich.');
  const polys=g.type==='Polygon'?[g.coordinates]:g.coordinates;let count=0,area=0;
  const projected=polys.map(poly=>poly.map((ring,index)=>{
    if(!Array.isArray(ring)||ring.length<4)throw Error('Die Flächengrenze ist nicht geschlossen.');
    const points=ring.map(p=>{
      if(++count>2500||!Array.isArray(p)||p.length<2||!Number.isFinite(p[0])||!Number.isFinite(p[1])||p[0]<10||p[0]>25||p[1]<54||p[1]>70)throw Error('Ungültige oder zu umfangreiche Flächengrenze für Schweden.');
      return project(p.slice(0,2));
    });
    if(ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])throw Error('Die Flächengrenze ist nicht geschlossen.');
    const [x,y]=points[0];let sum=0;for(let i=1;i<points.length;i++)sum+=(points[i-1][0]-x)*(points[i][1]-y)-(points[i][0]-x)*(points[i-1][1]-y);
    area+=(index?-1:1)*Math.abs(sum)/2;return points;
  }));
  const ha=area/10000;if(ha<=.0001||ha>10000)throw Error('Bitte eine Bestandsfläche zwischen 1 m² und 10.000 ha anfragen.');
  const ring=r=>'('+r.map(p=>p.map(x=>x.toFixed(3)).join(' ')).join(', ')+')';
  const poly=p=>'('+p.map(ring).join(', ')+')';
  const wkt=g.type==='Polygon'?'POLYGON '+poly(projected[0]):'MULTIPOLYGON ('+projected.map(poly).join(', ')+')';
  return {area_ha:ha,parameters:{geometri:wkt,pixelstorlek:ha>100?10:2,marktyper:['AllSkogsmark']}};
}
export function mapResponses(responses,polygonArea){
  const inventory={source_label:'Skogsstyrelsen · Skogliga grunddata API 1.1',sources:{}},warnings=[];
  for(const [endpoint,field] of Object.entries(ENDPOINTS)){
    const r=responses[endpoint],row=r?.data?.AllSkogsmark;
    if(!row||!Number.isFinite(row.medel)||row.medel<=0||!Number.isFinite(row.arealHa)||row.arealHa<=0){warnings.push(endpoint+': keine auswertbaren Daten');continue;}
    inventory[field]=row.medel;
    const source={name:'Skogsstyrelsen · '+endpoint,url:API+'/'+endpoint,scan_date:r.metadata?.minDatum,scan_date_end:r.metadata?.maxDatum,omdrev:r.metadata?.omdrev,pixel_m:r.metadata?.pixelstorlek,area_ha:row.arealHa};
    inventory.sources[field]=source;
    if(endpoint==='Volym'){
      inventory.scan_year=null;inventory.reference_year=null;inventory.projected_to_year=null;
      inventory.stock_area_ha=Math.min(row.arealHa,polygonArea);
      inventory.volume_m3sk=row.medel*inventory.stock_area_ha;
      const first=Number(r.metadata?.minDatum?.slice(0,4)),last=Number(r.metadata?.maxDatum?.slice(0,4));
      if(first&&first===last)inventory.scan_year=first;
      if(first!==last)warnings.push('Die Fläche enthält mehrere Aufnahmejahre; Details stehen bei den Quellen.');
    }
  }
  if(!Object.keys(inventory.sources).length)throw Error('Für diese Fläche liegen keine auswertbaren Grunddaten vor. Junge Bestände können im Rohdatensatz mit 0 kodiert sein.');
  return {inventory,note:'Werte beziehen sich auf die jeweilige Laseraufnahme. Keine automatische Fortschreibung auf das aktuelle Jahr. '+warnings.join(' · ')};
}
