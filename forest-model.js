/* LIGNUM — © 2026 Benedikt Holz. Forest planning, quantities in m³sk. */
(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory(require('./vendor/proj4-2.11.0.js'),require('./vendor/polygon-clipping-0.15.7.js'));
  else root.ForestModel=factory(root.proj4,root.polygonClipping);
})(typeof globalThis!=='undefined'?globalThis:this,function(proj4,clip){
  'use strict';
  const SWEREF='+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs';
  const LAND={forest:'Wald',unproductive:'Unproduktiver Wald',wetland:'Moor / Feuchtgebiet',other:'Sonstige Fläche',water:'Wasser',agriculture:'Landwirtschaft'};
  const HK={K:'Kahlfläche',R:'Jungbestand / Pflege',G1:'Erstdurchforstung',G2:'Weitere Durchforstung',S1:'Älterer Bestand',S2:'Verjüngungsreifer Bestand',E:'Ungleichaltriger Bestand',NS:'Naturschutz mit Pflege',NO:'Naturschutz ohne Eingriff'};
  const ACTIONS={none:'Keine Maßnahme',thinning:'Durchforstung',regeneration:'Verjüngung / Ernte',tending:'Kulturpflege',planting:'Pflanzung',nature:'Naturpflege'};
  const FIELDS={volume_m3sk_ha:['Vorrat je Hektar','m³sk/ha',0,3000],volume_m3sk:['Vorrat gesamt','m³sk',0,1e8],stock_area_ha:['Ausgewertete Vorratsfläche','ha',0,1e6],mean_height_m:['Mittlere Höhe','m',0,100],mean_diameter_cm:['Mittlerer Durchmesser','cm',0,300],basal_area_m2_ha:['Grundfläche','m²/ha',0,150],age_years:['Bestandsalter','Jahre',0,1000],scan_year:['Aufnahmejahr','',1900,2200],reference_year:['Bezugsjahr','',1900,2200],projected_to_year:['Fortgeschrieben bis','',1900,2200],annual_growth_m3sk_ha:['Angenommener jährlicher Zuwachs','m³sk/ha/Jahr',0,100],price_sek_m3sk:['Angenommener Preis','SEK/m³sk',0,10000]};
  const SOURCE_LINKS={downloads:'https://www.skogsstyrelsen.se/laddanergeodata',api:'https://www.skogsstyrelsen.se/e-tjanster-och-kartor/karttjanster/geodatatjanster/skogsstyrelsens-api/',rasterAccount:'https://www.skogsstyrelsen.se/e-tjanster-och-kartor/karttjanster/geodatatjanster/anvandarkonto/',quality:'https://www.skogsstyrelsen.se/skogligagrunddata'};
  const SPECIES={pine:'Kiefer',spruce:'Fichte',birch:'Birke',other:'Weitere Baumarten'};
  function number(value){
    if(value==null||String(value).trim()==='')return null;
    const n=Number(typeof value==='string'?value.replace(/\s/g,'').replace(',','.'):value);
    if(!Number.isFinite(n))throw Error('Ungültige Zahl: '+String(value).slice(0,40));return n;
  }
  const round=(n,d=3)=>Math.round(n*10**d)/10**d;
  function ringArea(r){const [x,y]=r[0];let a=0;for(let i=1;i<r.length;i++)a+=(r[i-1][0]-x)*(r[i][1]-y)-(r[i][0]-x)*(r[i-1][1]-y);return Math.abs(a)/2;}
  function projectedArea(polys){return polys.reduce((s,p)=>s+Math.max(0,ringArea(p[0])-p.slice(1).reduce((v,r)=>v+ringArea(r),0)),0)/10000;}
  const polygons=g=>g.type==='Polygon'?[g.coordinates]:g.coordinates;
  function mapGeometry(g,fn){return {type:g.type,coordinates:g.type==='Polygon'?g.coordinates.map(r=>r.map(fn)):g.coordinates.map(p=>p.map(r=>r.map(fn)))};}
  const projected=g=>mapGeometry(g,p=>proj4('EPSG:4326',SWEREF,p)).coordinates;
  function area(g){const c=projected(g);return projectedArea(g.type==='Polygon'?[c]:c);}
  function cross(a,b,c){return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
  function intersects(a,b,c,d){
    const eps=1e-15,ab1=cross(a,b,c),ab2=cross(a,b,d),cd1=cross(c,d,a),cd2=cross(c,d,b);
    const on=(p,q,r)=>Math.abs(cross(p,q,r))<eps&&r[0]>=Math.min(p[0],q[0])-eps&&r[0]<=Math.max(p[0],q[0])+eps&&r[1]>=Math.min(p[1],q[1])-eps&&r[1]<=Math.max(p[1],q[1])+eps;
    return (ab1*ab2<0&&cd1*cd2<0)||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);
  }
  function geometry(input,crs='EPSG:4326'){
    let g=input?.type==='Feature'?input.geometry:input;if(!g)return null;
    if(!['Polygon','MultiPolygon'].includes(g.type))throw Error('Nur Polygon und MultiPolygon sind als Flächen zulässig.');
    g=JSON.parse(JSON.stringify(g));let count=0;
    if(crs==='EPSG:3006')g=mapGeometry(g,p=>proj4(SWEREF,'EPSG:4326',p));
    else if(!['EPSG:4326','urn:ogc:def:crs:OGC:1.3:CRS84','CRS84'].includes(crs))throw Error('Koordinatensystem nicht unterstützt. Bitte GeoJSON in WGS84 oder SWEREF99 TM exportieren.');
    for(const poly of polygons(g)){
      if(!Array.isArray(poly)||!poly.length)throw Error('Leere Fläche.');
      for(const ring of poly){
        if(!Array.isArray(ring)||ring.length<3)throw Error('Eine Fläche benötigt mindestens drei Punkte.');
        for(let i=0;i<ring.length;i++){const p=ring[i];if(!Array.isArray(p)||p.length<2||!Number.isFinite(p[0])||!Number.isFinite(p[1])||Math.abs(p[0])>180||Math.abs(p[1])>90)throw Error('Ungültige Koordinaten. GeoJSON verwendet Längengrad, Breitengrad.');ring[i]=p.slice(0,2);}
        if(ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])ring.push([...ring[0]]);
        count+=ring.length;if(count>2500)throw Error('Flächengrenze zu detailliert. Bitte auf höchstens 2.500 Punkte vereinfachen.');
        for(let i=0;i<ring.length-1;i++)for(let j=i+2;j<ring.length-1;j++){
          if(i===0&&j===ring.length-2)continue;
          if(intersects(ring[i],ring[i+1],ring[j],ring[j+1]))throw Error('Die Flächengrenze kreuzt oder berührt sich selbst.');
        }
      }
      for(let i=1;i<poly.length;i++){
        if(clip.difference([poly[i]],[poly[0]]).length)throw Error('Eine Aussparung liegt außerhalb ihrer Fläche.');
        for(let j=1;j<i;j++)if(clip.intersection([poly[i]],[poly[j]]).length)throw Error('Aussparungen dürfen sich nicht überschneiden.');
      }
    }
    const ha=area(g);if(!Number.isFinite(ha)||ha<0.0001)throw Error('Die Fläche ist leer oder zu klein.');
    if(g.type==='MultiPolygon')for(let i=0;i<g.coordinates.length;i++)for(let j=0;j<i;j++)if(overlap({type:'Polygon',coordinates:g.coordinates[i]},{type:'Polygon',coordinates:g.coordinates[j]})>0.0001)throw Error('Teile einer MultiPolygon-Fläche überschneiden sich.');
    return g;
  }
  function overlap(a,b){if(!a||!b)return 0;const aP=mapGeometry(a,p=>proj4('EPSG:4326',SWEREF,p)),bP=mapGeometry(b,p=>proj4('EPSG:4326',SWEREF,p));return projectedArea(clip.intersection(aP.coordinates,bP.coordinates));}
  function inside(child,parent){return !parent||!child||area(child)-overlap(child,parent)<Math.max(0.0001,area(child)*0.00001);}
  function inventory(raw={}){
    const out={};
    for(const [key,[label,,min,max]] of Object.entries(FIELDS)){
      const value=number(raw[key]);if(value==null)continue;if(value<min||value>max)throw Error(label+' muss zwischen '+min+' und '+max+' liegen.');
      if(/year/.test(key)&&key!=='annual_growth_m3sk_ha'&&!Number.isInteger(value))throw Error(label+' muss eine ganze Zahl sein.');out[key]=value;
    }
    if(raw.site_index){const si=String(raw.site_index).toUpperCase().replace(/\s/g,'');if(!/^[TG]\d{1,2}$/.test(si))throw Error('Standortindex bitte als T25 oder G26 eingeben.');out.site_index=si;}
    if(raw.species_pct&&Object.values(raw.species_pct).some(v=>v!=null&&v!=='')){
      const values={};let total=0;for(const k of Object.keys(SPECIES)){const n=number(raw.species_pct[k]);if(n==null)throw Error('Bitte alle vier Baumartenanteile eintragen, auch 0.');if(n<0||n>100)throw Error('Baumartenanteile müssen zwischen 0 und 100 liegen.');values[k]=n;total+=n;}
      if(Math.abs(total-100)>0.05)throw Error('Die Baumartenanteile müssen zusammen 100 % ergeben.');out.species_pct=values;
    }
    if(raw.source_label)out.source_label=String(raw.source_label).slice(0,300);
    if(raw.sources&&typeof raw.sources==='object'&&!Array.isArray(raw.sources))out.sources=JSON.parse(JSON.stringify(raw.sources));
    if(JSON.stringify(out).length>25000)throw Error('Zu viele Quellenangaben.');return out;
  }
  function stand(raw){
    const g=geometry(raw.geometry),ha=g?area(g):number(raw.area_ha);
    if(ha==null||ha<=0||ha>1e6)throw Error('Bitte eine gültige Bestandsfläche angeben oder zeichnen.');
    const land=raw.land_type||'forest';if(!Object.hasOwn(LAND,land))throw Error('Unbekannte Flächenart.');
    const inv=inventory(raw.inventory);if(inv.stock_area_ha!=null&&inv.stock_area_ha>ha+0.01)throw Error('Die ausgewertete Vorratsfläche ist größer als der Bestand.');
    if(inv.volume_m3sk!=null&&inv.volume_m3sk_ha!=null){const expected=inv.volume_m3sk_ha*(inv.stock_area_ha??ha);if(Math.abs(inv.volume_m3sk-expected)>Math.max(1,expected*.02))throw Error('Gesamtvorrat und Vorrat je Hektar widersprechen sich.');}
    const removal=number(raw.removal_pct)??0;if(removal<0||removal>100)throw Error('Entnahme muss zwischen 0 und 100 % liegen.');
    if(raw.hk_class&&!Object.hasOwn(HK,raw.hk_class))throw Error('Unbekannte Bestandsklasse.');if(raw.action&&!Object.hasOwn(ACTIONS,raw.action))throw Error('Unbekannte Maßnahme.');
    return {number:String(raw.number||'').trim().slice(0,40),name:String(raw.name||'Bestand').trim().slice(0,150)||'Bestand',geometry:g,area_ha:round(ha,6),land_type:land,hk_class:raw.hk_class||'',inventory:inv,action:raw.action||'none',removal_pct:removal,notes:String(raw.notes||'').slice(0,5000),area_id:raw.area_id||null};
  }
  function validateLayout(property,stands){
    const max=property.geometry?area(property.geometry):number(property.area_ha);
    const sum=stands.reduce((v,s)=>v+s.area_ha,0);
    if(max&&sum>max+Math.max(.01,max*.0001))throw Error('Die Summe der Bestandsflächen überschreitet die Grundstücksfläche.');
    for(let i=0;i<stands.length;i++){
      if(!inside(stands[i].geometry,property.geometry))throw Error('Bestand '+stands[i].name+' liegt außerhalb der Grundstücksgrenze.');
      for(let j=0;j<i;j++)if(overlap(stands[i].geometry,stands[j].geometry)>.0001)throw Error('Bestände '+stands[i].name+' und '+stands[j].name+' überschneiden sich.');
    }
  }
  function stock(s){const i=s.inventory||{};if((s.land_type!=='forest'&&s.land_type!=='unproductive')||i.stock_area_ha===0)return null;return i.volume_m3sk??(i.volume_m3sk_ha==null?null:i.volume_m3sk_ha*(i.stock_area_ha??s.area_ha));}
  function referenceYear(i){
    if(i.projected_to_year!=null)return i.projected_to_year;
    const source=i.sources?.volume_m3sk_ha||i.sources?.volume_m3sk;
    if(source?.year!=null)return Number(source.year);
    if(source?.scan_date){const first=Number(source.scan_date.slice(0,4)),last=Number((source.scan_date_end||source.scan_date).slice(0,4));return first===last?first:null;}
    return i.reference_year??i.scan_year??null;
  }
  function scenario(s,targetYear){
    const i=s.inventory||{},base=stock(s),removal=base==null?null:base*(s.removal_pct||0)/100;
    const year=referenceYear(i);
    const projected=base==null||year==null||i.annual_growth_m3sk_ha==null||targetYear<year?null:base+i.annual_growth_m3sk_ha*(i.stock_area_ha??s.area_ha)*(targetYear-year);
    return {stock:base,removal,remaining:base==null?null:base-removal,projected,year,gross:removal==null||i.price_sek_m3sk==null?null:removal*i.price_sek_m3sk};
  }
  function summary(stands,property={}){
    const land={},species={},ageBands={},classes={};let known=0,unknown=0,total=0,speciesKnown=0,ageKnown=0,removal=0;
    for(const s of stands){const i=s.inventory||{},v=stock(s);land[s.land_type]=(land[s.land_type]||0)+s.area_ha;classes[s.hk_class||'unknown']=(classes[s.hk_class||'unknown']||0)+s.area_ha;
      if(s.land_type==='forest'||s.land_type==='unproductive'){
        if(v==null)unknown+=s.area_ha;else{const covered=Math.min(s.area_ha,i.stock_area_ha??s.area_ha);known+=covered;unknown+=s.area_ha-covered;total+=v;removal+=v*(s.removal_pct||0)/100;}
        if(i.age_years!=null){const key=Math.floor(i.age_years/20)*20,covered=Math.min(s.area_ha,i.sources?.age_years?.area_ha??s.area_ha);ageBands[key]=(ageBands[key]||0)+covered;ageKnown+=covered;}
        if(v!=null&&i.species_pct&&(i.sources?.species_pct?.area_ha==null||i.sources.species_pct.area_ha>=s.area_ha-.0001)){speciesKnown+=v;for(const k of Object.keys(SPECIES))species[k]=(species[k]||0)+v*i.species_pct[k]/100;}
      }
    }
    return {land,classes,species,ageBands,ageKnown,total:known>0?total:null,knownArea:known,unknownArea:unknown,speciesKnown,removal:known>0?removal:null,remaining:known>0?total-removal:null,registeredArea:stands.reduce((a,s)=>a+s.area_ha,0),propertyArea:property.area_ha||null,density:known>0?total/known:null};
  }
  // Conservative planning hints: never replace a field inspection or regulatory review.
  function recommend(s){
    const i=s.inventory||{},age=i.age_years,basal=i.basal_area_m2_ha;
    const unknown={action:'none',confidence:'low',reason:'Datenlage unzureichend; vor Ort prüfen.',review:true};
    if(s.land_type==='wetland'||s.land_type==='water')return {action:'none',confidence:'high',reason:'Keine automatische Holzernteempfehlung für Wasser oder Feuchtgebiet.',review:true};
    if(!['forest','unproductive'].includes(s.land_type))return unknown;
    if(s.hk_class==='NO'||s.hk_class==='NS')return {action:'nature',confidence:'medium',reason:'Naturschutzklasse: Maßnahmen nur nach fachlicher Prüfung.',review:true};
    if(s.hk_class==='K')return {action:'planting',confidence:'medium',reason:'Kahlfläche: Verjüngungsbedarf und natürliche Ansamung prüfen.',review:true};
    if(s.hk_class==='R')return {action:'tending',confidence:'medium',reason:'Jungbestand: Pflegebedarf vor Ort kontrollieren.',review:true};
    if(s.hk_class==='G1'||s.hk_class==='G2'){
      if(basal!=null&&basal<12)return {action:'none',confidence:'low',reason:'Geringe Grundfläche; Durchforstung nicht ohne Bestandsprüfung empfehlen.',review:true};
      return {action:'thinning',confidence:basal!=null?'medium':'low',reason:'Durchforstungsklasse; Stabilität, Dichte und Standort prüfen.',review:true};
    }
    if(s.hk_class==='S2')return {action:'regeneration',confidence:'low',reason:'Verjüngungsreifer Bestand; Dauerwaldoption, Naturwerte und Verjüngung prüfen.',review:true};
    if(s.hk_class==='E')return {action:'none',confidence:'low',reason:'Ungleichaltriger Bestand: einzelstammweise Eingriffe nur nach örtlicher Beurteilung.',review:true};
    if(age!=null&&age<20)return {action:'tending',confidence:'low',reason:'Junger Bestand; Pflegebedarf prüfen.',review:true};
    return unknown;
  }
  function recommendParts(stands){
    const parts=stands.map(s=>({id:s.id??null,name:s.name,area_ha:s.area_ha,...recommend(s)}));
    const actions=[...new Set(parts.map(p=>p.action))];
    return {uniform:parts.length>0&&actions.length===1,action:actions.length===1?actions[0]:null,parts,requiresReview:true};
  }
  function color(s,theme='class'){
    if(s.land_type==='water')return '#58b5d6';if(s.land_type==='wetland')return '#967aaf';if(!['forest','unproductive'].includes(s.land_type))return '#a29375';
    const i=s.inventory||{};
    if(theme==='species'){if(!i.species_pct)return '#87918a';const k=Object.keys(SPECIES).sort((a,b)=>i.species_pct[b]-i.species_pct[a])[0];return {pine:'#d1dc4e',spruce:'#277d6e',birch:'#d28a42',other:'#a074c7'}[k];}
    if(theme==='age'){const n=i.age_years;return n==null?'#87918a':n<20?'#9accff':n<40?'#a9d77e':n<60?'#68b35d':n<80?'#2e8d4c':n<120?'#28614b':'#6c3c83';}
    if(theme==='volume'){const n=i.volume_m3sk_ha;return n==null?'#87918a':n<50?'#d9e7bd':n<100?'#a6cd8d':n<200?'#6ba66b':n<300?'#367958':'#15513e';}
    return {K:'#ec7775',R:'#8ccbe3',G1:'#91c85d',G2:'#549d49',S1:'#a5a7a3',S2:'#6c7370',E:'#578c6d',NS:'#c3a16d',NO:'#856b98'}[s.hk_class]||'#87918a';
  }
  function wkt(g){const p=mapGeometry(geometry(g),x=>proj4('EPSG:4326',SWEREF,x));const r=ring=>'('+ring.map(x=>x.map(v=>round(v,3)).join(' ')).join(', ')+')';const poly=p=> '('+p.map(r).join(', ')+')';return p.type==='Polygon'?'POLYGON '+poly(p.coordinates):'MULTIPOLYGON ('+p.coordinates.map(poly).join(', ')+')';}
  function parseGeoJSON(data){
    if(typeof data==='string')data=JSON.parse(data);const crs=data.crs?.properties?.name||'EPSG:4326';const code=/3006/.test(crs)?'EPSG:3006':/4326|CRS84/.test(crs)?'EPSG:4326':crs;
    const features=data.type==='FeatureCollection'?data.features:data.type==='Feature'?[data]:[{type:'Feature',properties:{},geometry:data}];
    if(!Array.isArray(features)||!features.length||features.length>300)throw Error('Bitte 1 bis 300 Flächen importieren.');
    return features.map((f,index)=>{const p=f.properties||{},inv={...(p.inventory||{})};
      const aliases={volume_m3sk_ha:['volym_ha','volym_m3sk_ha'],volume_m3sk:['vorrat_m3sk','total_volume_m3sk'],mean_height_m:['medelhojd','height_m'],mean_diameter_cm:['medeldiameter','diameter_cm'],basal_area_m2_ha:['grundyta'],age_years:['alder','age'],site_index:['standortsindex'],scan_year:['skannat_ar'],reference_year:['data_year']};
      for(const k of [...Object.keys(FIELDS),'site_index'])if(p[k]!=null)inv[k]=p[k];
      for(const [k,keys] of Object.entries(aliases))for(const a of keys)if(inv[k]==null&&p[a]!=null)inv[k]=p[a];
      if(p.species_pct)inv.species_pct=p.species_pct;
      if(!inv.source_label)inv.source_label=String(p.source_label||'GeoJSON-Import');
      return stand({...p,name:p.name||p.namn||'Bestand '+(index+1),number:p.number||p.avd_nr||String(index+1),geometry:geometry(f.geometry,code),inventory:inv});
    });
  }
  function parseCSV(text){
    const first=text.replace(/^\uFEFF/,'').split(/\r?\n/)[0],delimiter=first.includes(';')?';':',';
    const rows=[];let row=[],cell='',quoted=false;
    text=text.replace(/^\uFEFF/,'');
    for(let i=0;i<=text.length;i++){
      const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
      else if(!quoted&&(c===delimiter||c==='\n'||c===undefined)){row.push(cell.replace(/\r$/,''));cell='';if(c!==delimiter){if(row.some(x=>x.trim()))rows.push(row);row=[];}}
      else if(c!==undefined)cell+=c;
    }
    if(quoted)throw Error('CSV enthält ein nicht geschlossenes Anführungszeichen.');
    const headers=rows.shift()?.map(s=>s.trim());if(!headers||!rows.length||rows.length>300)throw Error('CSV benötigt eine Kopfzeile und 1 bis 300 Bestände.');
    if(new Set(headers).size!==headers.length)throw Error('CSV enthält doppelte Spaltennamen.');
    if(!headers.includes('area_ha'))throw Error('CSV benötigt die Spalte area_ha (Fläche in Hektar).');
    return rows.map((r,index)=>{
      if(r.length!==headers.length)throw Error('CSV-Zeile '+(index+2)+' hat eine abweichende Spaltenzahl.');
      const p=Object.fromEntries(headers.map((h,i)=>[h,r[i]])),inv={};for(const k of Object.keys(FIELDS))if(p[k]!==undefined)inv[k]=p[k];
      if(p.site_index)inv.site_index=p.site_index;inv.source_label=p.source_label||'CSV-Import';
      if(Object.keys(SPECIES).some(k=>p[k+'_pct']!==undefined))inv.species_pct=Object.fromEntries(Object.keys(SPECIES).map(k=>[k,p[k+'_pct']]));
      return stand({...p,number:p.number||String(index+1),name:p.name||'Bestand '+(index+1),inventory:inv});
    });
  }
  function featureCollection(stands){return {type:'FeatureCollection',lignum_schema:'forest-stands-v1',features:stands.map(s=>({type:'Feature',geometry:s.geometry,properties:{...stand(s),geometry:undefined}}))};}
  return {LAND,HK,ACTIONS,FIELDS,SPECIES,SOURCE_LINKS,number,round,geometry,area,overlap,inside,inventory,stand,validateLayout,stock,referenceYear,scenario,summary,recommend,recommendParts,color,wkt,parseGeoJSON,parseCSV,featureCollection};
});
