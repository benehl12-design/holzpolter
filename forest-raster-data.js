/* LIGNUM · Native cells from public Skogsstyrelsen ZIPs, evaluated on the device. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./vendor/proj4-2.11.0.js'),require('./vendor/polygon-clipping-0.15.7.js'));
  else root.ForestRasterData=factory(root.proj4,root.polygonClipping);
})(typeof globalThis!=='undefined'?globalThis:this,function(proj4,clip){
  'use strict';
  const SWEREF='+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs',CACHE='lignum-forest-rasters-v1';
  const rectangle=b=>[[[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]],[b[0],b[1]]]]];
  const localRectangle=(b,origin)=>rectangle([b[0]-origin[0],b[1]-origin[1],b[2]-origin[0],b[3]-origin[1]]);
  const boundsOverlap=(a,b)=>a[0]<b[2]&&a[2]>b[0]&&a[1]<b[3]&&a[3]>b[1];
  function ringArea(r){const [x,y]=r[0];let sum=0;for(let i=1;i<r.length;i++)sum+=(r[i-1][0]-x)*(r[i][1]-y)-(r[i][0]-x)*(r[i-1][1]-y);return Math.abs(sum)/2;}
  const area=ps=>ps.reduce((sum,p)=>sum+Math.max(0,ringArea(p[0])-p.slice(1).reduce((s,r)=>s+ringArea(r),0)),0);
  function projected(geometry){
    if(!['Polygon','MultiPolygon'].includes(geometry?.type))throw Error('Eine Bestandsgrenze ist erforderlich.');
    const ps=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
    return ps.map(p=>p.map(r=>r.map(x=>proj4('EPSG:4326',SWEREF,x))));
  }
  function bounds(ps){const pts=ps.flat(2);return pts.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);}
  function decode(layer){
    if(layer.values)return layer;
    if(!Number.isInteger(layer.width)||!Number.isInteger(layer.height)||layer.width<1||layer.height<1||layer.width*layer.height>1e6||!Number.isFinite(layer.step)||layer.step<=0)throw Error('Ungültiges Rastergitter.');
    const data=new Int32Array(layer.width*layer.height);let at=0;
    for(const [value,n] of layer.runs){if(!Number.isInteger(value)||value< -1||value>65535||!Number.isInteger(n)||n<1||at+n>data.length)throw Error('Beschädigte Rasterdaten.');data.fill(value,at,at+n);at+=n;}
    if(at!==data.length)throw Error('Unvollständige Rasterdaten.');
    return {...layer,values:data};
  }
  function valueAt(layer,x,y){if(!layer)return -1;const col=Math.floor((x-layer.x)/layer.step),row=Math.floor((layer.y-y)/layer.step);return col>=0&&row>=0&&col<layer.width&&row<layer.height?layer.values[row*layer.width+col]:-1;}
  function cells(layer,polygon,callback){
    const b=bounds(polygon),step=layer.step;
    const x0=Math.max(0,Math.floor((b[0]-layer.x)/step)),x1=Math.min(layer.width,Math.ceil((b[2]-layer.x)/step));
    const y0=Math.max(0,Math.floor((layer.y-b[3])/step)),y1=Math.min(layer.height,Math.ceil((layer.y-b[1])/step));
    for(let row=y0;row<y1;row++)for(let col=x0;col<x1;col++){
      const x=layer.x+col*step,y=layer.y-row*step;
      const w=area(clip.intersection(polygon,rectangle([x,y-step,x+step,y])));
      if(w>1e-7)callback(layer.values[row*layer.width+col],w,x+step/2,y-step/2);
    }
  }
  const metricKeys={volume:'volume_m3sk_ha',height:'mean_height_m',diameter:'mean_diameter_cm',basal_area:'basal_area_m2_ha'};
  function evaluate(geometry,index,tiles,options={}){
    if(index.schema!=='lignum-raster-index-v1')throw Error('Datenpaket wird nicht unterstützt.');
    const {poly:polygon,needed:expected,origin}=selection(geometry,index),fullArea=area(polygon);
    const byFile=new Map(tiles.map(t=>[t.file,t.data]));
    for(const t of expected)if(!byFile.has(t.file))throw Error('Ein benötigter Datenausschnitt fehlt. Bitte online vollständig laden.');
    const totals={},provenance={},species={pine:0,spruce:0,birch:0,other:0},speciesFiles=new Set();let speciesArea=0,covered=0;
    function accumulate(key,value,w,id){
      const source=index.sources[id];if(!source)throw Error('Quellenangabe fehlt.');
      const t=totals[key]||(totals[key]={sum:0,area:0});t.sum+=value*(source.scale??1)*w;t.area+=w;
      const records=provenance[key]||(provenance[key]={});records[id]=(records[id]||0)+w;
    }
    for(const entry of expected){
      const tile=byFile.get(entry.file);if(tile.schema!=='lignum-raster-tile-v1'||JSON.stringify(tile.bounds)!==JSON.stringify(entry.bounds))throw Error('Falscher Datenausschnitt.');
      const part=clip.intersection(polygon,localRectangle(tile.bounds,origin));covered+=area(part);
      const layers=Object.fromEntries(Object.entries(tile.layers).map(([k,v])=>[k,{...decode(v),x:v.x-origin[0],y:v.y-origin[1]}]));
      for(const [kind,key] of Object.entries(metricKeys)){
        const ids=[kind+'_3',kind+'_2'].filter(id=>layers[id]),base=layers[ids[0]];if(!base)continue;
        for(const id of ids){const l=layers[id];if(l.x!==base.x||l.y!==base.y||l.step!==base.step||l.width!==base.width||l.height!==base.height)throw Error('Grunddatenraster sind nicht deckungsgleich.');}
        cells(base,part,(_,w,x,y)=>{for(const id of ids){const value=valueAt(layers[id],x,y);
          // 0 in a newer observation is unestimated and must not revive older forest.
          if(value>=0){if(value>0)accumulate(key,value,w,id);break;}
        }});
      }
      if(options.ageType){const id='age_'+options.ageType,layer=layers[id];if(layer)cells(layer,part,(v,w)=>{if(v>0)accumulate('age_years',v,w,id);});}
      if(options.siteSpecies){const id='site_'+(options.siteSpecies==='T'?'pine':'spruce'),layer=layers[id];if(layer)cells(layer,part,(v,w)=>{if(v>0)accumulate('site_index',v,w,id);});}
      const recent=!!layers.species2018_pine,prefix=recent?'species2018_':'species_';
      const ids=['pine','spruce','birch','broadleaf','contorta','oak','beech'].map(k=>prefix+k),base=layers[prefix+'pine'];
      if(base&&ids.every(id=>layers[id])){
        for(const id of ids){const l=layers[id];if(l.x!==base.x||l.y!==base.y||l.step!==base.step||l.width!==base.width||l.height!==base.height)throw Error('Baumartenraster sind nicht deckungsgleich.');}
        cells(base,part,(_,w,x,y)=>{const v=ids.map(id=>valueAt(layers[id],x,y)),sum=v.reduce((a,b)=>a+b,0);if(v.some(n=>n<0)||sum<=0)return;
          let weight=w,commonArea=w;
          if(recent){
            const volumeIds=['volume_3','volume_2'].filter(id=>layers[id]),grid=layers[volumeIds[0]];if(!grid)return;
            weight=commonArea=0;
            const cell=clip.intersection(part,rectangle([x-base.step/2,y-base.step/2,x+base.step/2,y+base.step/2]));
            cells(grid,cell,(_,a,vx,vy)=>{for(const id of volumeIds){const density=valueAt(layers[id],vx,vy);if(density>=0){if(density>0){weight+=density*a;commonArea+=a;}break;}}});
            if(!weight)return;
            weight/=sum; // Normalize rounded per-cell percentages before volume weighting.
          }
          species.pine+=v[0]*weight;species.spruce+=v[1]*weight;species.birch+=v[2]*weight;species.other+=(v[3]+v[4]+v[5]+v[6])*weight;speciesArea+=commonArea;ids.forEach(id=>speciesFiles.add(id));});
      }
    }
    const inventory={sources:{},source_label:'Skogsstyrelsen / SLU · ZIP-Daten, lokal ausgewertet'},fields=[];
    for(const [key,t] of Object.entries(totals)){
      inventory[key]=key==='site_index'?options.siteSpecies+Math.round(t.sum/t.area):key==='age_years'?Math.round(t.sum/t.area):t.sum/t.area;
      const ids=Object.keys(provenance[key]),sources=ids.map(id=>({...index.sources[id],area_ha:provenance[key][id]/10000})),years=[...new Set(sources.map(s=>s.year??null))];
      inventory.sources[key]={name:sources.map(s=>s.name).join(' / '),year:years.length===1?years[0]:null,area_ha:t.area/10000,method:'native cell-polygon intersection area weighted',datasets:sources};fields.push(key);
      if(key==='volume_m3sk_ha'){
        inventory.stock_area_ha=t.area/10000;inventory.volume_m3sk=t.sum/10000;fields.push('volume_m3sk','stock_area_ha','reference_year','scan_year','projected_to_year');
        if(years.length===1&&years[0]!=null)inventory.reference_year=years[0];
      }
    }
    if(options.ageType&&!fields.includes('age_years'))fields.push('age_years');
    if(options.siteSpecies&&!fields.includes('site_index'))fields.push('site_index');
    // A refreshed stock source with no valid cells clears obsolete stock values.
    for(const key of Object.values(metricKeys))if(!fields.includes(key))fields.push(key);
    if(!('volume_m3sk_ha' in inventory))fields.push('volume_m3sk','stock_area_ha','reference_year','scan_year','projected_to_year');
    const speciesTotal=Object.values(species).reduce((a,b)=>a+b,0);
    if(speciesTotal>0){const recent=[...speciesFiles].some(id=>id.startsWith('species2018_'));inventory.species_pct=Object.fromEntries(Object.entries(species).map(([k,v])=>[k,v/speciesTotal*100]));inventory.sources.species_pct={name:recent?'SLU Trädslag 2018 · Bilder 2017–2019 · mit Grunddatenvorrat gewichtet':'SLU Skogskarta 2015 · alle sieben Baumartengruppen',year:null,product_year:recent?2018:2015,area_ha:speciesArea/10000,method:recent?'2017-2019 cell volume percentages weighted by available Omdrev volume on exact common native cell intersections':'volume shares on common valid native cells',datasets:[...speciesFiles].map(id=>index.sources[id])};}
    fields.push('species_pct');
    return {inventory,fields:[...new Set(fields)],coverage_ha:covered/10000,area_ha:fullArea/10000,note:'ZIP-Daten: Quelle und Abdeckung je Kennzahl prüfen. Aufnahmejahre variieren; spätere Eingriffe sind nicht berücksichtigt.'};
  }
  const baseURL=()=>new URL('data/forest-rasters/',typeof document!=='undefined'?document.baseURI:undefined);
  let indexPromise;
  async function jsonFile(url,fresh=false){
    let cache=null,hit=null,timer;
    try{if(typeof caches!=='undefined'){cache=await caches.open(CACHE);hit=await cache.match(url);}}catch{}
    if(hit&&!fresh){try{return await hit.clone().json();}catch{}}
    const controller=typeof AbortController!=='undefined'?new AbortController():null;
    if(controller)timer=setTimeout(()=>controller.abort(),60000);
    try{
      const r=await fetch(url,{cache:'no-cache',signal:controller?.signal});
      if(!r.ok)throw Error('Datendatei nicht verfügbar ('+r.status+').');
      const copy=r.clone(),data=await r.json();
      if(cache){try{await cache.put(url,copy);}catch{}}
      return data;
    }catch(e){if(hit){try{return await hit.clone().json();}catch{}}throw Error('Datenausschnitt nicht gespeichert. Bitte einmal online auswerten. '+e.message);}
    finally{clearTimeout(timer);}
  }
  async function index(){if(!indexPromise)indexPromise=jsonFile(new URL('index.json',baseURL()).href,true).then(info=>{
    if(info.schema!=='lignum-raster-index-v1'||!Array.isArray(info.tiles))throw Error('Das Datenverzeichnis ist ungültig. Bitte online erneut laden.');return info;
  }).catch(e=>{indexPromise=null;throw e;});return indexPromise;}
  function selection(geometry,info){
    const global=projected(geometry),b=bounds(global),origin=[Math.floor(b[0]/1000)*1000,Math.floor(b[1]/1000)*1000];
    // A rigid translation keeps native cells and border precision unchanged,
    // while avoiding unstable clipping around 7-million-metre northings.
    const poly=global.map(p=>p.map(r=>r.map(([x,y])=>[x-origin[0],y-origin[1]])));
    return {poly,origin,needed:info.tiles.filter(t=>boundsOverlap(t.bounds,b)&&area(clip.intersection(poly,localRectangle(t.bounds,origin)))>1e-7)};
  }
  async function coverage(geometry){
    const info=await index(),{poly,needed,origin}=selection(geometry,info);
    return {name:info.name||info.region||'Sarvisvaara',area_ha:area(poly)/10000,
      coverage_ha:needed.reduce((total,t)=>total+area(clip.intersection(poly,localRectangle(t.bounds,origin))),0)/10000};
  }
  async function inventory(geometry,options={},progress=()=>{}){
    const info=await index(),{needed}=selection(geometry,info);
    if(!needed.length)throw Error('Die Fläche liegt außerhalb des verfügbaren Datengebiets '+(info.name||'Sarvisvaara')+'. Die Auswahl der Alterskarte ändert das Datengebiet nicht.');
    const tiles=[];
    for(const entry of needed){if(!/^[\w-]+\.json$/.test(entry.file))throw Error('Ungültige Datendatei.');progress(tiles.length+1,needed.length);tiles.push({file:entry.file,data:await jsonFile(new URL(entry.file,baseURL()).href)});}
    if(typeof Worker!=='undefined'&&typeof document!=='undefined')return new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('forest-raster-worker.js',document.baseURI));
      const timer=setTimeout(()=>{worker.terminate();reject(Error('Die Fläche ist für diese Auswertung zu groß. Bitte in kleinere Bestände aufteilen.'));},120000);
      const finish=()=>{clearTimeout(timer);worker.terminate();};
      worker.onmessage=e=>{finish();if(e.data.error)reject(Error(e.data.error));else resolve(e.data.result);};
      worker.onerror=()=>{finish();reject(Error('Die Rasterauswertung konnte nicht gestartet werden. Bitte die App online neu laden.'));};
      worker.postMessage({geometry,index:info,tiles,options});
    });
    return evaluate(geometry,info,tiles,options);
  }
  function merge(current,result){
    const out={...current,sources:{...current?.sources}};
    for(const key of result.fields){delete out[key];delete out.sources[key];}
    return {...out,...result.inventory,sources:{...out.sources,...result.inventory.sources}};
  }
  return {inventory,index,coverage,evaluate,decode,merge};
});
