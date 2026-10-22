/* LIGNUM — © 2026 Benedikt Holz. Company-scoped forest planning UI. */
(function(){
  'use strict';
  const M=window.ForestModel,esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=(n,d=0)=>n==null?'–':Number(n).toLocaleString('de-DE',{maximumFractionDigits:d});
  let screen,map,shapes,propertyId=null,standId=null,properties=[],stands=[],owner=null,ownerCompany=null,request=0,theme='class',draft=null,draw=null,busy=false,search='';
  let sharedAreas=[],quick=null,areaWarning='';
  let basemap,baseMode='satellite',mapObserver,mapFrame,mapTimer,mapRetry,fitPending=false;
  const basemaps={
    satellite:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:21,maxNativeZoom:18,attribution:'Tiles © Esri'}],
    streets:['https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:21,maxNativeZoom:19,attribution:'© OpenStreetMap contributors'}]
  };
  const el=id=>document.getElementById(id),admin=()=>isAdminUser(),ctx=()=>({id:currentUser?.id,company:currentProfile?.company_id});
  const same=who=>ctx().id===who.id&&ctx().company===who.company;
  const property=()=>properties.find(p=>p.id===propertyId),selected=()=>stands.find(s=>s.id===standId&&s.property_id===propertyId);
  const rows=()=>stands.filter(s=>s.property_id===propertyId);
  const opts=(o,value,empty)=>`${empty!=null?`<option value="">${esc(empty)}</option>`:''}${Object.entries(o).map(([k,v])=>`<option value="${esc(k)}" ${k===value?'selected':''}>${esc(v)}</option>`).join('')}`;
  function message(text='',error=false){el('fp-message').textContent=text;el('fp-message').className='fp-message'+(error?' error':'');}
  function mount(){
    if(screen)return;
    screen=document.createElement('section');screen.id='forest-screen';screen.setAttribute('aria-label','Forstplanung');
    screen.innerHTML=`<header class="fp-header"><button class="fp-btn" data-act="close" aria-label="Zurück zur Startseite">←</button><h1>Forstplanung<small id="fp-subtitle">Grundstücke · Bestände · Maßnahmen</small></h1><button class="fp-btn" data-act="refresh" aria-label="Forstplanung aktualisieren">↻</button></header>
      <div id="fp-message" class="fp-message" role="status" aria-live="polite"></div>
      <div class="fp-toolbar"><button class="fp-btn primary" data-act="draw-quick">Fläche auswerten</button><button class="fp-btn" data-act="shared-areas">Vorhandene Flächen</button><select id="fp-property" class="fp-input" aria-label="Grundstück"></select><button class="fp-btn" data-act="new-property" data-admin>+ Grundstück</button><select id="fp-theme" class="fp-input" aria-label="Kartenfarben"><option value="class">Bestandsklassen</option><option value="age">Alter</option><option value="species">Baumarten</option><option value="volume">Vorrat je Hektar</option></select><select id="fp-basemap" class="fp-input" aria-label="Hintergrundkarte"><option value="satellite">Satellit</option><option value="streets">Straßenkarte</option></select></div>
      <div class="fp-layout"><div class="fp-map-side"><div class="fp-map-wrap"><div id="fp-map" aria-label="Bestandskarte"></div><div id="fp-map-status" class="fp-map-status" role="status" hidden></div><div id="fp-draw-tools" class="fp-draw-tools" hidden></div></div><div id="fp-legend" class="fp-legend"></div></div><main id="fp-content" class="fp-content"></main></div><div id="fp-modal-root"></div><input id="fp-file" class="fp-visually-hidden" type="file" accept=".geojson,.json,.csv" aria-label="Bestandsdaten importieren">`;
    document.body.append(screen);
    screen.addEventListener('click',event=>{const b=event.target.closest('[data-act]');if(!b||b.disabled)return;event.preventDefault();dispatch(b.dataset.act,b.dataset.id,b).catch(e=>message(e.message,true));});
    el('fp-property').addEventListener('change',()=>{if(busy){el('fp-property').value=propertyId;return;}cancelDraw();closeModal();quick=null;propertyId=el('fp-property').value||null;standId=null;render(true);});
    el('fp-theme').addEventListener('change',()=>{theme=el('fp-theme').value;renderMap();});
    el('fp-basemap').addEventListener('change',()=>setBasemap(el('fp-basemap').value));
    window.addEventListener('online',()=>{if(visible())reloadMap();});
    window.addEventListener('resize',()=>sizeMap());
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)sizeMap();});
    screen.addEventListener('input',e=>{if(e.target.id==='fp-search'){search=e.target.value.toLowerCase();renderList();}});
    screen.addEventListener('keydown',e=>{if(e.key==='Escape'){if(draw)cancelDraw();else if(el('fp-modal-root').children.length)closeModal();else close();}});
    el('fp-file').addEventListener('change',()=>readFile().catch(e=>message(e.message,true)));
  }
  const visible=()=>!!screen&&screen.style.display!=='none';
  function mapStatus(text='',retry=false){
    const status=el('fp-map-status');if(!status)return;
    status.hidden=!text;status.innerHTML=esc(text)+(retry?`<div class="fp-actions">${button('retry-map','Erneut laden')}${baseMode==='satellite'?button('street-map','Straßenkarte zeigen'):''}</div>`:'');
  }
  function sizeMap(fit=false){
    if(!map||!visible())return;fitPending=fitPending||fit;
    cancelAnimationFrame(mapFrame);
    mapFrame=requestAnimationFrame(()=>{
      const box=el('fp-map');if(!visible()||!box.clientWidth||!box.clientHeight)return;
      map.invalidateSize({pan:false,animate:false});
      if(fitPending){const focus=quick?.geometry||property()?.geometry;const bounds=focus?L.geoJSON(focus).getBounds():shapes.getBounds();if(bounds.isValid())map.fitBounds(bounds,{padding:[18,18],maxZoom:18,animate:false});fitPending=false;}
    });
  }
  function setBasemap(mode=baseMode){
    if(!map||!basemaps[mode])return;
    clearTimeout(mapTimer);clearTimeout(mapRetry);if(basemap)map.removeLayer(basemap);
    baseMode=mode;el('fp-basemap').value=mode;
    const [url,options]=basemaps[mode],layer=L.tileLayer(url,{...options,crossOrigin:'anonymous'});
    let loaded=0,failed=0,retried=false;
    const current=()=>basemap===layer&&visible();
    const failure=()=>{
      if(!current())return;
      mapStatus(navigator.onLine?'Die Hintergrundkarte wurde nicht vollständig geladen. Bitte erneut laden oder die Kartenart wechseln.':'Offline: Für diesen Kartenausschnitt sind noch keine vollständigen Kartenbilder gespeichert.',true);
      if(!retried&&navigator.onLine){retried=true;mapRetry=setTimeout(()=>{if(current())layer.redraw();},1200);}
    };
    layer.on('loading',()=>{if(!current())return;loaded=0;failed=0;clearTimeout(mapTimer);mapTimer=setTimeout(failure,10000);});
    layer.on('tileload',()=>{if(current()){loaded++;if(!failed)mapStatus();}});
    layer.on('tileerror',()=>{if(current())failed++;});
    layer.on('load',()=>{if(!current())return;clearTimeout(mapTimer);if(failed)failure();else{clearTimeout(mapRetry);mapStatus();}});
    basemap=layer;mapStatus('Hintergrundkarte wird geladen …');layer.addTo(map);sizeMap();
  }
  function reloadMap(){sizeMap();setBasemap();}
  async function open(){
    mount();hideAllScreens();screen.style.display='flex';
    if(!map){
      map=L.map('fp-map',{zoomControl:true,attributionControl:true}).setView([66.748,21.47],12);shapes=L.featureGroup().addTo(map);
      map.on('click',e=>{if(draw){draw.points.push([e.latlng.lng,e.latlng.lat]);paintDraw();}});
      if(typeof ResizeObserver!=='undefined'){mapObserver=new ResizeObserver(()=>sizeMap());mapObserver.observe(el('fp-map'));}
    }
    setBasemap();
    const who=ctx();if(owner!==who.id||ownerCompany!==who.company){owner=who.id;ownerCompany=who.company;properties=[];stands=[];sharedAreas=[];quick=null;propertyId=null;standId=null;}
    render();sizeMap();await refresh();
  }
  function hide(){if(!screen)return;screen.style.display='none';cancelAnimationFrame(mapFrame);clearTimeout(mapTimer);clearTimeout(mapRetry);cancelDraw();closeModal();request++;}
  function close(){hide();showModeScreen();}
  async function refresh(){
    if(!screen||screen.style.display==='none')return;const token=++request,who=ctx();if(!who.id||!who.company)return hide();
    message('Forstplanung wird geladen …');
    try{
      const [p,s,a,g]=await Promise.all([dbFetch('forest_properties?company_id=eq.'+who.company+'&order=name'),dbFetch('forest_stands?company_id=eq.'+who.company+'&order=number'),dbFetch('areas?company_id=eq.'+who.company+'&order=name').then(rows=>({rows})).catch(()=>({rows:[],error:true})),dbFetch('geojson_layers?company_id=eq.'+who.company+'&order=created_at').then(rows=>({rows})).catch(()=>({rows:[],error:true}))]);
      if(token!==request||ctx().id!==who.id||ctx().company!==who.company)return;
      properties=p||[];stands=s||[];sharedAreas=[];let invalid=0;
      for(const area of a.rows||[]){if(area.company_id&&area.company_id!==who.company)continue;if(!Array.isArray(area.boundary)||area.boundary.length<3)continue;try{const geometry=M.geometry({type:'Polygon',coordinates:[area.boundary.map(p=>[p[1],p[0]])]});sharedAreas.push({...area,area_id:area.id,geometry,area_ha:M.area(geometry)});}catch{invalid++;}}
      // Read the same imported cadastral layers as the main map, including local-only imports.
      const layers=[...(g.rows||[]),...(window.getLocalPlanningBoundaries?.()||[])];
      for(const layer of layers){
        if(layer.company_id!==who.company)continue;
        let geo=layer.geojson;
        try{if(typeof geo==='string')geo=JSON.parse(geo);}catch{invalid++;continue;}
        const visit=(item,key,props={})=>{
          if(!item)return;
          if(item.type==='FeatureCollection'){(item.features||[]).forEach((f,i)=>visit(f,key+'.'+i));return;}
          if(item.type==='Feature'){visit(item.geometry,key,item.properties||{});return;}
          if(item.type==='GeometryCollection'){(item.geometries||[]).forEach((f,i)=>visit(f,key+'.'+i,props));return;}
          if(!['Polygon','MultiPolygon'].includes(item.type))return;
          try{
            // Do not discard detailed cadastral outlines because the editing validator has a point limit.
            const check=c=>{if(!Array.isArray(c)||!c.length)throw Error();if(typeof c[0]==='number'){if(c.length<2||!Number.isFinite(c[0])||!Number.isFinite(c[1])||Math.abs(c[0])>180||Math.abs(c[1])>90)throw Error();}else c.forEach(check);};check(item.coordinates);
            const geometry=JSON.parse(JSON.stringify(item)),ha=M.area(geometry);if(!Number.isFinite(ha)||ha<=0)throw Error();
            sharedAreas.push({id:'geojson:'+layer.id+':'+key,name:String(props.fastighetsbeteckning||props.beteckning||props.name||props.id||layer.name||'Grundstück'),geometry,area_ha:ha,color:layer.color});
          }catch{invalid++;}
        };visit(geo,'0');
      }
      areaWarning=(a.error||g.error)?'Die Grenzen aus der normalen Karte konnten nicht vollständig geladen werden. Bitte erneut aktualisieren.':invalid?`${invalid} Flächengrenze(n) sind ungültig und konnten nicht angezeigt werden.`:'';
      if(quick?.source_id){const current=sharedAreas.find(a=>a.id===quick.source_id);if(!current)quick=null;else if(JSON.stringify(current.geometry)!==JSON.stringify(quick.geometry))quick=areaSelection(current);else quick={...quick,name:current.name||'Fläche'};}
      if(!properties.some(p=>p.id===propertyId))propertyId=properties[0]?.id||null;
      if(!stands.some(s=>s.id===standId&&s.property_id===propertyId))standId=null;
      render(true);message(areaWarning||(navigator.onLine?'':'Offline: gespeicherte Daten und Änderungen sind verfügbar.'),!!areaWarning);
    }catch(e){if(token===request){render();message('Laden nicht möglich: '+e.message,true);}}
  }
  function controls(){screen.querySelectorAll('[data-admin]').forEach(b=>b.hidden=!admin());}
  function render(fit=false){
    el('fp-property').innerHTML=properties.length?properties.map(p=>`<option value="${p.id}" ${p.id===propertyId?'selected':''}>${esc(p.cadastral_ref||p.name)}</option>`).join(''):'<option value="">Noch kein Grundstück</option>';
    el('fp-subtitle').textContent=property()?.name||'Grundstücke · Bestände · Maßnahmen';renderMap(fit);renderDetail();controls();
  }
  function renderMap(fit=false){
    if(!map)return;shapes.clearLayers();const p=property();
    for(const a of sharedAreas){const layer=L.geoJSON(a.geometry,{style:{color:a.color||'#efc86d',weight:2,dashArray:a.color?null:'7 5',fillOpacity:.04,bubblingMouseEvents:false}});layer.eachLayer(l=>{l.bindTooltip(esc(a.name||'Fläche'),{className:'fp-stand-label'});l.on('click',e=>{if(draw||busy)return;L.DomEvent.stopPropagation(e);selectArea(a.id);});});layer.addTo(shapes);}
    if(quick?.result?.subareas?.parts)for(const part of quick.result.subareas.parts){
      const colors={thinning:'#e5a44a',tending:'#7dbb77',regeneration:'#ba7064',review:'#b7a0cb',unknown:'#999999'};
      L.geoJSON(part.geometry,{interactive:false,style:{color:colors[part.action]||'#999',weight:2,fillColor:colors[part.action]||'#999',fillOpacity:.3}}).addTo(shapes);
    }
    if(quick?.result?.subareas?.structureZones?.length)for(const part of quick.result.subareas.structureZones){
      const colors={low:'#72a7ca',mid:'#80b88e',high:'#c5a66b'};
      L.geoJSON(part.geometry,{interactive:false,style:{color:colors[part.zone],weight:2,fillColor:colors[part.zone],fillOpacity:.25}}).addTo(shapes);
    }
    if(quick?.geometry)L.geoJSON(quick.geometry,{interactive:false,style:{color:'#fff',weight:3,fillColor:'#8dbd74',fillOpacity:quick?.result?.subareas?.parts?.length||quick?.result?.subareas?.structureZones?.length?0:.18}}).addTo(shapes);
    if(p?.geometry)L.geoJSON(p.geometry,{interactive:false,style:{color:'#f2f3d5',weight:3,fillOpacity:0}}).addTo(shapes);
    for(const s of rows())if(s.geometry){
      const layer=L.geoJSON(s.geometry,{style:{color:s.id===standId?'#fff':M.color(s,theme),weight:s.id===standId?4:2,fillColor:M.color(s,theme),fillOpacity:.36,bubblingMouseEvents:false}});
      layer.eachLayer(l=>{l.bindTooltip(esc(s.number),{permanent:true,direction:'center',className:'fp-stand-label'});l.on('click',e=>{if(draw||busy)return;L.DomEvent.stopPropagation(e);quick=null;standId=s.id;render();});});layer.addTo(shapes);
    }
    if(draw)paintDraw();
    sizeMap(fit);
    const labels=theme==='class'?{...M.HK,unknown:'Keine Klasse'}:theme==='species'?M.SPECIES:theme==='age'?{'0–19':'0–19 Jahre','20–39':'20–39 Jahre','40–59':'40–59 Jahre','60–79':'60–79 Jahre','80–119':'80–119 Jahre','120+':'120+ Jahre'}:{'<50':'< 50 m³sk/ha','50–99':'50–99','100–199':'100–199','200–299':'200–299','300+':'300+'};
    const colors=theme==='class'?['#ec7775','#8ccbe3','#91c85d','#549d49','#a5a7a3','#6c7370','#578c6d','#c3a16d','#856b98','#87918a']:theme==='species'?['#d1dc4e','#277d6e','#d28a42','#a074c7']:theme==='age'?['#9accff','#a9d77e','#68b35d','#2e8d4c','#28614b','#6c3c83']:['#d9e7bd','#a6cd8d','#6ba66b','#367958','#15513e'];
    if(quick?.result?.subareas){
      const parts=quick.result.subareas.parts||[];
      const entries=[['thinning','#e5a44a','Durchforstung prüfen'],['tending','#7dbb77','Jungbestandspflege prüfen'],['regeneration','#ba7064','Ernte / Verjüngung prüfen (keine Fällfreigabe)']].filter(([key])=>parts.some(p=>p.action===key));
      if(quick.result.subareas.structureZones?.length){
        const zones=quick.result.subareas.structureZones;
        el('fp-legend').innerHTML=[['low','#72a7ca','Unterdurchschnittlicher Holzvorrat'],['mid','#80b88e','Durchschnittlicher Holzvorrat'],['high','#c5a66b','Überdurchschnittlicher Holzvorrat']].filter(([id])=>zones.some(z=>z.zone===id)).map(([,color,label])=>`<span><i class="fp-dot" style="background:${color}"></i>${label} (keine Maßnahmenempfehlung)</span>`).join('')+(Number.isFinite(quick.result.subareas.stockMean_m3sk_ha)?`<span>Flächendurchschnitt: ${fmt(quick.result.subareas.stockMean_m3sk_ha,1)} m³sk/ha · durchschnittlich: 75–125 % davon</span>`:'')+'<span><i class="fp-dot" style="background:#fff"></i>Gewählte Flächengrenze</span>';
        return;
      }
      el('fp-legend').innerHTML=entries.map(([,color,label])=>`<span><i class="fp-dot" style="background:${color}"></i>${label}</span>`).join('')+
        '<span><i class="fp-dot" style="background:#87918a"></i>Ohne gesicherte Maßnahmenempfehlung (nicht eingefärbt)</span>'+
        '<span><i class="fp-dot" style="background:#ffffff"></i>Gewählte Flächengrenze</span>';
      return;
    }
    el('fp-legend').innerHTML=Object.values(labels).map((v,i)=>`<span><i class="fp-dot" style="background:${colors[i]}"></i>${esc(v)}</span>`).join('')+(sharedAreas.length?'<span><i class="fp-dot" style="background:#efc86d"></i>Grenzen aus der normalen Karte</span>':'')+(theme==='class'?'':'<span><i class="fp-dot" style="background:#87918a"></i>Keine Daten</span>');
  }
  function stat(label,value,unit='',digits=0){return `<div class="fp-stat"><small>${esc(label)}</small><strong>${/jahr|Fortschreibung/i.test(label)?esc(value??'–'):fmt(value,digits)}</strong> <span>${esc(unit)}</span></div>`;}
  const button=(act,label,id='',cls='')=>`<button class="fp-btn ${cls}" data-act="${act}" data-id="${esc(id)}">${esc(label)}</button>`;
  function bars(data,labels,unit,colors={}){const max=Math.max(1,...Object.values(data));return Object.entries(data).map(([k,n])=>`<div class="fp-bar-row"><span>${esc(labels[k]||k)}</span><div class="fp-bar"><i style="width:${Math.max(0,n/max*100)}%;background:${colors[k]||'#74a560'}"></i></div><span>${fmt(n,1)} ${esc(unit)}</span></div>`).join('')||'<p class="fp-muted">Noch keine Daten.</p>';}
  function sources(){return `<div class="fp-source"><b>Datenquellen und Datenstand</b><p>Die Walddaten werden aus heruntergeladenen Skogsstyrelsen-/SLU-ZIP-Dateien ausgewertet. Dafür wird kein Skogsstyrelsen-API-Zugang benötigt.</p><p>Das regionale Datenpaket für Sarvisvaara wird beim Auswerten geladen und für weitere Offline-Auswertungen gespeichert. Für andere Gebiete lassen sich weitere Ausschnitte aus den Norrbotten-Originaldaten aufbereiten.</p><p>Aufnahmejahr und Abdeckung stehen an jeder Kennzahl. Alter: Bezugsjahr 2025, Karte nach tatsächlichem Waldtyp auswählen. Baumarten bei Sarvisvaara: SLU Trädslag 2018 mit Bildern aus 2017–2019. Die ältere SLU-Karte 2015 deckt den Ort nicht ab. Eingriffe nach der Aufnahme bitte ergänzen.</p><p>Bearbeitung: native Rasterzellen ausgeschnitten und flächengewichtet ausgewertet. Quellen: Skogsstyrelsen / SLU. Alter und SIS: <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>; weitere Quellen nach <a href="https://www.skogsstyrelsen.se/e-tjanster-och-kartor/karttjanster/geodatatjanster/villkor/" target="_blank" rel="noopener">Originalbedingungen</a>.</p><a href="${M.SOURCE_LINKS.downloads}" target="_blank" rel="noopener">Originaldaten</a> · <a href="${M.SOURCE_LINKS.quality}" target="_blank" rel="noopener">Datenqualität</a></div>`;}
  function sharedList(){return `${areaWarning?`<p class="fp-form-error">${esc(areaWarning)}</p>`:''}<p class="fp-muted">Die Grenzen stammen aus der normalen Karte und werden beim Öffnen oder Aktualisieren neu geladen.</p>`+(sharedAreas.length?sharedAreas.map(a=>`<div class="fp-row">${button('select-area',a.name||'Fläche',a.id)}<span>${fmt(a.area_ha,2)} ha</span></div>`).join(''):'<p class="fp-muted">Noch keine Grundstücksgrenzen oder eingezeichneten Flächen vorhanden.</p>');}
  function areaSelection(a){return {name:a.name||'Fläche',source_id:a.id,area_id:a.area_id,geometry:a.geometry,area_ha:a.area_ha};}
  function selectArea(id){const a=sharedAreas.find(a=>a.id===id);if(!a||busy)return;cancelDraw();closeModal();quick=areaSelection(a);standId=null;render(true);}
  function recommendationView(s,spatial=null){
    const r=M.recommend(s);
    const localized=spatial?.parts?.filter(p=>p.action===r.action)||[];
    const mapped=localized.length>0;
    const isAction=r.action!=='none'&&r.action!=='unknown';
    const mappedOther=spatial?.parts?.filter(p=>['thinning','tending','regeneration'].includes(p.action)&&p.action!==r.action)||[];
    const status=spatial?(mapped
      ?'<p class="fp-muted"><strong>Räumlich zugeordnet:</strong> Die farbigen Bereiche zeigen nur Kandidaten für eine Prüfung, keine Freigabe zum Eingriff. Außerhalb der Markierung gilt die Empfehlung nicht automatisch.</p>'
      :mappedOther.length
        ?'<p class="fp-muted"><strong>Andere kartierte Prüfbereiche vorhanden:</strong> Die Karte zeigt geeignete Stellen für andere Maßnahmen als den Durchschnittshinweis. Welche Maßnahmen wo zu prüfen sind, steht in der Liste der farbigen Teilbereiche. Keine flächendeckende Maßnahme ableiten.</p>'
        :'<p class="fp-muted"><strong>Nicht räumlich zugeordnet:</strong> Diese Aussage stammt ausschließlich aus den Durchschnittswerten. Keine bestätigte Maßnahmenfläche auf der Karte. Keine flächendeckende Maßnahme daraus ableiten.</p>')
      :'<p class="fp-muted">Noch keine räumliche Prüfung vorhanden. Keine Maßnahmenfläche auf der Karte bestätigt.</p>';
    return `<section class="fp-scenario"><h3>${mapped?'Räumlich geprüfter Maßnahmenhinweis':mappedOther.length?'Andere Maßnahmen in der Karte vorhanden':'Allgemeiner Bestands-Hinweis (nicht kartiert)'}</h3><strong>${mapped?esc(M.ACTIONS[r.action]):mappedOther.length?'Kartierte Prüfbereiche siehe Karte und Teilflächenliste':'Keine räumlich bestätigte Maßnahme'}</strong><p>${isAction?'Aus den Durchschnittswerten: '+esc(M.ACTIONS[r.action])+' – '+esc(r.reason):esc(r.reason)}</p>${status}${r.missing?.length?`<p class="fp-muted">Fehlende oder unzureichend abgedeckte Kennzahlen: ${r.missing.map(k=>esc(M.FIELDS[k]?.[0]||k)).join(', ')}.</p>`:''}<p class="fp-muted">Vorläufige Empfehlung, keine Fällfreigabe: Bestand, Naturwerte, Boden, Nachwuchs und gesetzliches Mindestalter am Standort vor Ort prüfen. Teilflächen mit unterschiedlichen Bedingungen getrennt bewerten.</p></section>`;
  }
  function speciesStockView(result){
    const i=result?.inventory||{},v=i.species_volume_m3sk,density=i.species_volume_m3sk_ha;
    const title='<h3>Holzvorrat nach Baumarten (Schätzung)</h3>';
    if(!v||!density)return '<section class="fp-scenario">'+title+
      '<p>Für eine getrennte Vorratsberechnung fehlen gemeinsam abgedeckte SLU-Trädslag-2018- und Gesamtvorratsraster. Die bisherige Baumartenverteilung in Prozent ist kein nachgewiesener Baumartenvorrat.</p></section>';
    const types=['pine','spruce','birch','other'],focus=types.includes(result.species_focus)?result.species_focus:'all';
    const table=types.map(kind=>`<tr><td>${focus===kind?'<strong>':''}${esc(M.SPECIES[kind])}${focus===kind?'</strong>':''}</td><td>${fmt(v[kind],1)} m³sk</td><td>${fmt(density[kind],1)} m³sk/ha</td></tr>`).join('');
    const selected=focus!=='all'
      ?`<p><strong>Gewählte Baumart: ${esc(M.SPECIES[focus])}</strong> · geschätzter Vorrat ${fmt(v[focus],1)} m³sk · ${fmt(density[focus],1)} m³sk/ha.</p>`
      :'<p><strong>Alle Baumarten im Vergleich:</strong> Die Gesamtsumme des Bestandes steht darunter separat.</p>';
    return `<section class="fp-scenario">${title}${selected}
      <table class="fp-table"><thead><tr><th>Baumart</th><th>Vorrat</th><th>Vorrat je ha</th></tr></thead><tbody>${table}</tbody></table>
      <p class="fp-muted">Die Schätzung gilt ausschließlich für ${fmt(i.species_stock_area_ha,2)} ha gemeinsame gültige Rasterabdeckung. Berechnung: Baumartenanteile der SLU-Karte 2018 × Gesamtvorrat der Skogsstyrelsen-Raster auf denselben Zellen. Andere Jahre und spätere Eingriffe sind nicht berücksichtigt; fehlende Flächen werden nicht hochgerechnet. Höhe, Durchmesser und Grundfläche beziehen sich weiterhin auf alle Baumarten zusammen.</p></section>`;
  }
  function renderQuick(c){
    const r=quick.result,i=r?.inventory||{};
    c.innerHTML=`${button('overview','← Übersicht')}<h2 style="margin-top:16px">${esc(quick.name)}</h2><p class="fp-muted">${quick.source_id?'Grenze aus der normalen Karte':'Frei gewählte Fläche'} · ${fmt(quick.area_ha,2)} ha</p>
      <div class="fp-actions">${button('quick-data',r?'Neu auswerten':'Walddaten anzeigen','','primary')}${r&&admin()?button('save-quick','Optional speichern'):''}${button('draw-quick','Andere Fläche zeichnen')}</div>
      ${r?`${speciesStockView(r)}<h3>Kennzahlen des gesamten Bestandes (alle Baumarten)</h3><div class="fp-grid">${Object.entries(i).filter(([k,v])=>M.FIELDS[k]&&typeof v==='number').map(([k,v])=>stat(k==='volume_m3sk_ha'?'Gesamtvorrat je Hektar (alle Arten)':k==='volume_m3sk'?'Gesamtvorrat (alle Arten)':M.FIELDS[k][0],v,M.FIELDS[k][1],1)).join('')}${i.site_index?`<div class="fp-stat"><small>Standortindex</small><strong>${esc(i.site_index)}</strong></div>`:''}</div><h3>Baumarten</h3>${i.species_pct?bars(i.species_pct,M.SPECIES,'%'):'<p class="fp-muted">Keine Baumartenwerte für diese Fläche verfügbar.</p>'}<p class="fp-muted">Datengebiet: ${fmt(r.coverage_ha,2)} von ${fmt(r.area_ha,2)} ha. ${esc(r.note||'')} Fehlende Flächen werden nicht hochgerechnet.</p><details class="fp-source"><summary>Quellen je Kennzahl</summary>${Object.entries(i.sources||{}).map(([k,v])=>`<p>${esc(M.FIELDS[k]?.[0]||k)}: ${esc(v.name||v.source||'Quelle')} · ${esc(v.year||v.scan_date||'Jahr nicht angegeben')}${v.area_ha!=null?' · '+fmt(v.area_ha,2)+' ha':''}</p>`).join('')}</details><p class="fp-muted">Diese Auswertung ist noch nicht als Bestand gespeichert.</p>`:'<p class="fp-muted">Die Fläche ist ausgewählt. Mit „Walddaten anzeigen“ erhältst du die Kennzahlen, ohne ein Grundstück oder einen Bestand anzulegen.</p>'}${r?recommendationView({land_type:'forest',inventory:i,area_ha:quick.area_ha},r.subareas):''}${r?.subareas?`<section class="fp-scenario"><h3>Große zusammenhängende Maßnahmenbereiche</h3><p class="fp-muted">${esc(r.subareas.method)} ${fmt(r.subareas.analyzed_ha,2)} ha Rasterfläche untersucht; ${fmt(r.subareas.unshown_ha,2)} ha nicht einzeln dargestellt. Nur ausreichend große Bereiche sind eingefärbt. Nicht markierte Bereiche sind nicht automatisch zur Nutzung freigegeben.</p>${r.subareas.validation?`<p class="fp-muted">${esc(r.subareas.validation)}</p>`:""}${r.subareas.diagnostics?`<p class="fp-muted">Nicht als Bestand übernommen: ${r.subareas.diagnostics.rejectedHeterogeneous} strukturell uneinheitliche, ${r.subareas.diagnostics.rejectedSparse} unvollständig erfasste und ${r.subareas.diagnostics.rejectedSmall} zu kleine Rastergruppen.</p>`:""}${r.subareas.error?`<p class="fp-form-error">${esc(r.subareas.error)}</p>`:""}${r.subareas.parts.length?r.subareas.parts.map((p,n)=>`<p><strong>Bereich ${n+1} · ${fmt(p.area_ha,2)} ha</strong> ${p.action==='regeneration'&&p.structure?.harvestReference?`· nordschwedischer Altersrichtwert ${p.structure.harvestReference.years} Jahre (${esc(p.structure.harvestReference.referenceIndex)})`:''} · ${p.structure?`Alter Ø ${fmt(p.structure.age_years,0)} J., Höhe Ø ${fmt(p.structure.height_m,1)} m, Grundfläche Ø ${fmt(p.structure.basal_area_m2_ha,1)} m²/ha · `:""}${esc({thinning:'Durchforstung prüfen',tending:'Jungbestandspflege prüfen',regeneration:'Ernte / Verjüngung prüfen – keine Fällfreigabe',review:'Keine weitere Entnahme ohne Prüfung',unknown:'Daten unzureichend'}[p.action]||'Prüfen')}</p>`).join(''):(r.subareas.structureZones?.length?`<p><strong>Waldstruktur statt Maßnahme:</strong> Die strenge Maßnahmenprüfung hat keine Fläche bestätigt. Deshalb werden nur gemessene Vorratsunterschiede dargestellt – ohne Einschlagsempfehlung.</p>${r.subareas.structureZones.map((z,n)=>`<p>Vorratsbereich ${n+1}: ${fmt(z.area_ha,2)} ha · Ø ${fmt(z.volume_m3sk_ha,0)} m³sk/ha · ${esc({low:'unterdurchschnittlicher Holzvorrat',mid:'durchschnittlicher Holzvorrat',high:'überdurchschnittlicher Holzvorrat'}[z.zone])}</p>`).join('')}`:'<p>Keine belastbare Maßnahmenfläche oder ausreichend abgedeckte Vorratszone erkennbar. Prüfe die Rasterabdeckung und den gewählten Bereich.</p>')}</section>`:''}${r?.site_selection?`<p class="fp-muted">Standortindex-Typ: ${esc(r.site_selection.type)} · ${esc(r.site_selection.method)}</p>`:''}${r?.age_selection?`<p class="fp-muted">Alterskarte: ${esc(r.age_selection.type)} · ${esc(r.age_selection.method)}</p>`:''}${sources()}`;
  }
  function saveQuick(){
    if(!quick?.result)return;
    modal('Auswertung optional speichern',`<div id="fp-save-error" class="fp-form-error" role="alert"></div><p>Speichere die ausgewählte Fläche mit ihren Kennzahlen als Bestand. Wähle ein bestehendes Grundstück oder lege jetzt eines an.</p>${properties.map(p=>`<div class="fp-row">${button('quick-save-property',p.name,p.id)}</div>`).join('')}<div class="fp-actions">${button('quick-new-property','Neues Grundstück anlegen')}${button('cancel','Zurück')}</div>`);
  }
  function saveQuickTo(id){
    if(!quick?.result)return;
    const raw={name:quick.name,geometry:quick.geometry,area_ha:quick.area_ha,area_id:quick.area_id,inventory:quick.result.inventory};
    if(id){const p=properties.find(p=>p.id===id);if(!p)return;if(!M.inside(raw.geometry,p.geometry)){el('fp-save-error').textContent='Die Fläche liegt außerhalb dieses Grundstücks. Bitte ein passendes Grundstück auswählen.';return;}propertyId=id;standId=null;render();showForm('stand',{...raw,number:String(rows().length+1)});}
    else{showForm('property',{name:quick.name,geometry:quick.geometry,area_ha:quick.area_ha});draft.continueWith=raw;}
  }
  function renderDetail(){
    const p=property(),s=selected(),c=el('fp-content');if(!c)return;if(quick){renderQuick(c);return;}
    if(!p){c.innerHTML=`<div class="fp-empty"><h2>Walddaten direkt ansehen</h2><p>Zeichne eine Fläche oder wähle eine vorhandene Grenze aus der normalen Karte. Ein Grundstück musst du dafür nicht anlegen.</p><div class="fp-actions">${button('draw-quick','Fläche auswerten','','primary')}${button('shared-areas','Vorhandene Fläche wählen')}</div></div>${sharedList()}${sources()}`;return;}
    if(s){const i=s.inventory||{},v=M.stock(s),r=M.scenario(s,new Date().getFullYear()+5);
      c.innerHTML=`${button('overview','← Grundstücksübersicht')}<h2 style="margin-top:16px">${esc(s.number)} · ${esc(s.name)}</h2><p class="fp-muted">${esc(M.LAND[s.land_type])} · ${esc(M.HK[s.hk_class]||'Klasse noch nicht erfasst')}${s._offline_pending?' · <span class="fp-pending">Synchronisierung ausstehend</span>':''}</p>
      <div class="fp-grid">${stat('Bestandsfläche',s.area_ha,'ha',2)}${stat('Geschätzter Vorrat',v,'m³sk')}${stat('Vorrat je ausgewertetem Hektar',i.volume_m3sk_ha,'m³sk/ha',1)}${stat('Grundfläche',i.basal_area_m2_ha,'m²/ha',1)}${stat('Bestandsalter',i.age_years,'Jahre')}${stat('Mittlere Höhe',i.mean_height_m,'m',1)}${stat('Mittlerer Durchmesser',i.mean_diameter_cm,'cm',1)}<div class="fp-stat"><small>Standortindex</small><strong>${esc(i.site_index||'–')}</strong></div>${stat('Aufnahmejahr',i.scan_year)}${stat('Bezugsjahr / Fortschreibung',M.referenceYear(i))}</div>
      ${i.stock_area_ha!=null?`<p class="fp-muted">Vorratsdaten für ${fmt(i.stock_area_ha,2)} von ${fmt(s.area_ha,2)} ha. Fehlende Flächen werden nicht als 0 gerechnet.</p>`:''}
      <h3>Baumarten</h3>${i.sources?.species_pct?.area_ha!=null?`<p class="fp-muted">Baumarten-Rasterabdeckung: ${fmt(i.sources.species_pct.area_ha,2)} von ${fmt(s.area_ha,2)} ha.</p>`:''}${i.species_pct?bars(i.species_pct,M.SPECIES,'%'): '<p class="fp-muted">Baumartenanteile noch nicht erfasst.</p>'}
      <h3>Maßnahme und Szenario</h3><div class="fp-scenario">${esc(M.ACTIONS[s.action])} · geplante Entnahme ${fmt(s.removal_pct,1)} %<br>Entnahme: <b>${fmt(r.removal)} m³sk</b> · verbleibend: <b>${fmt(r.remaining)} m³sk</b>${r.projected!=null?`<br>Vorrat ${new Date().getFullYear()+5} vor Entnahme: ${fmt(r.projected)} m³sk`:''}${r.gross!=null?`<br>Angenommener Bruttoerlös der Entnahme: ${fmt(r.gross)} SEK`:''}<p class="fp-muted">Planungsszenario auf Basis der erfassten Werte. Zuwachs und Preis sind eigene Annahmen; Kosten und Grundstückswert sind darin nicht enthalten.</p></div>
      ${recommendationView(s)}
      ${s.notes?`<p style="white-space:pre-wrap;line-height:1.6">${esc(s.notes)}</p>`:''}
      <div class="fp-actions">${admin()?button('edit-stand','Bestand bearbeiten',s.id)+button('draw-stand','Grenze zeichnen',s.id)+button('fetch-data','ZIP-Daten auswerten',s.id)+button('order','Auftrag vorbereiten',s.id)+button('delete-stand','Bestand löschen',s.id,'danger'):''}</div><p class="fp-muted">Quelle: ${esc(i.source_label||'Noch nicht erfasst')}</p>${i.sources?`<details class="fp-source"><summary>Quellen je Kennzahl</summary>${Object.entries(i.sources).map(([k,v])=>`<p>${esc(M.FIELDS[k]?.[0]||k)}: ${esc(v.name||v.source||'Quelle')} · ${esc(v.year||[v.scan_date,v.scan_date_end!==v.scan_date?v.scan_date_end:null].filter(Boolean).join(' – ')||'Jahr nicht angegeben')}${v.area_ha!=null?' · Abdeckung '+fmt(v.area_ha,2)+' ha':''}</p>`).join('')}</details>`:''}${sources()}`;
    }else{const sum=M.summary(rows(),p);
      c.innerHTML=`<h2>${esc(p.name)}</h2><p class="fp-muted">${esc(p.cadastral_ref||'Grundstück')}${p._offline_pending?' · <span class="fp-pending">Synchronisierung ausstehend</span>':''}</p><div class="fp-grid">${stat('Grundstücksfläche',p.area_ha,'ha',2)}${stat('Erfasste Waldfläche',(sum.land.forest||0)+(sum.land.unproductive||0),'ha',2)}${stat('Bekannter Holzvorrat',sum.total,'m³sk')}${stat('Vorrat je ausgewertetem Waldhektar',sum.density,'m³sk/ha',1)}</div><p class="fp-muted">${fmt(sum.registeredArea,2)} von ${fmt(p.area_ha,2)} ha als Bestände erfasst. Vorratsdaten für ${fmt(sum.knownArea,2)} ha; ${fmt(sum.unknownArea,2)} ha erfasster Wald ohne Vorratsdaten.</p>
      <div class="fp-actions">${admin()?button('edit-property','Grundstück bearbeiten',p.id)+button('draw-property','Grundstücksgrenze zeichnen',p.id)+button('new-stand','+ Bestand','','primary')+button('draw-stand','+ Bestand zeichnen')+button('from-area','Lignum-Gebiet übernehmen')+button('import','Daten importieren'):''}${p.geometry?button('export-property','Grundstücksgrenze exportieren'):''}${rows().length?button('export','Bestände exportieren'):''}</div>
      ${rows().length?`<section class="fp-scenario"><h3>Automatische Teilflächenbewertung</h3>${M.recommendParts(rows()).uniform?'Einheitlicher Vorschlag: '+esc(M.ACTIONS[M.recommendParts(rows()).action]):'Unterschiedliche Teilbestände benötigen getrennte Maßnahmen.'}${M.recommendParts(rows()).parts.map(x=>`<p>${esc(x.name)}: ${esc(M.ACTIONS[x.action])} – ${esc(x.reason)}</p>`).join('')}<p class="fp-muted">Alle Vorschläge vor Ort prüfen.</p></section>`:''}<h3>Bestände (${rows().length})</h3><input class="fp-input" id="fp-search" type="search" placeholder="Name oder Bestandsnummer suchen" value="${esc(search)}" aria-label="Bestände suchen"><div id="fp-stand-list"></div>
      <h3>Flächennutzung</h3>${bars(sum.land,M.LAND,'ha')}<h3>Altersverteilung</h3>${bars(sum.ageBands,Object.fromEntries(Object.keys(sum.ageBands).map(k=>[k,k+'–'+(Number(k)+19)+' Jahre'])),'ha')}<p class="fp-muted">Altersangaben für ${fmt(sum.ageKnown,2)} ha erfassten Wald.</p><h3>Holzvorrat nach Baumart</h3>${bars(sum.species,M.SPECIES,'m³sk')}<p class="fp-muted">Baumartenaufteilung für ${fmt(sum.speciesKnown)} m³sk mit vollständigen Baumartenangaben. Lückenhafte Rasterabdeckung wird nicht hochgerechnet.</p>${p.notes?`<p class="fp-muted" style="white-space:pre-wrap">${esc(p.notes)}</p>`:''}${admin()?button('delete-property','Grundstück mit Beständen löschen',p.id,'danger'):''}${sources()}`;renderList();
    }
  }
  function renderList(){const list=el('fp-stand-list');if(!list)return;const data=rows().filter(s=>(s.number+' '+s.name).toLowerCase().includes(search));list.innerHTML=data.map(s=>`<div class="fp-row"><i class="fp-dot" style="background:${M.color(s,theme)}"></i><button data-act="select" data-id="${s.id}"><b>${esc(s.number)} · ${esc(s.name)}</b><small>${fmt(s.area_ha,2)} ha · ${fmt(M.stock(s))} m³sk · ${esc(M.ACTIONS[s.action])}${s._offline_pending?' · lokal gespeichert':''}</small></button><span>›</span></div>`).join('')||'<p class="fp-muted">Keine Bestände vorhanden oder keine Treffer.</p>';}
  function closeModal(){if(el('fp-modal-root'))el('fp-modal-root').replaceChildren();draft=null;}
  function modal(title,body){el('fp-modal-root').innerHTML=`<div class="fp-modal"><section class="fp-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div style="display:flex;gap:10px;align-items:center"><h2 style="flex:1">${esc(title)}</h2>${button('cancel','×')}</div>${body}</section></div>`;setTimeout(()=>el('fp-modal-root').querySelector('input,button')?.focus(),30);}
  function field(key,label,value='',extra=''){return `<label>${esc(label)}<input class="fp-input" name="${key}" value="${esc(value??'')}" ${extra}></label>`;}
  function showForm(kind,raw={}){
    draft={kind,raw:JSON.parse(JSON.stringify(raw)),who:ctx(),propertyId};
    const isP=kind==='property',i=raw.inventory||{},p=property(),isNew=!raw.id;
    modal(isP?(isNew?'Grundstück anlegen':'Grundstück bearbeiten'):(isNew?'Bestand anlegen':'Bestand bearbeiten'),`<form id="fp-form"><div class="fp-form-grid">${field('name','Name *',raw.name||'','required maxlength="150"')}${isP?field('cadastral_ref','Grundstücksbezeichnung',raw.cadastral_ref):field('number','Bestandsnummer *',raw.number||String(rows().length+1),'required maxlength="40"')}${field('area_ha','Fläche (ha) *',raw.geometry?fmt(M.area(raw.geometry),4).replace(/\./g,''):raw.area_ha,'inputmode="decimal" '+(raw.geometry?'readonly':'required'))}${!isP?`<label>Flächenart<select class="fp-input" name="land_type">${opts(M.LAND,raw.land_type||'forest')}</select></label><label>Bestandsklasse<select class="fp-input" name="hk_class">${opts(M.HK,raw.hk_class,'Noch nicht erfasst')}</select></label><label>Maßnahme<select class="fp-input" name="action">${opts(M.ACTIONS,raw.action||'none')}</select></label>`:''}</div><p class="fp-muted">${raw.geometry?'Grenze vorhanden. Die Fläche wird aus dem Polygon berechnet.':'Du kannst die Grenze nach dem Speichern zeichnen oder als GeoJSON importieren.'}</p>
      ${isP?`<label>Grundstücksgrenze als GeoJSON<input class="fp-input" name="geometry_file" type="file" accept=".geojson,.json"></label>`:`<fieldset><legend>Bestandsdaten · leere Felder bleiben unbekannt</legend><div class="fp-form-grid">${Object.entries(M.FIELDS).filter(([k])=>!['annual_growth_m3sk_ha','price_sek_m3sk'].includes(k)).map(([k,[label,unit]])=>field(k,label+(unit?' ('+unit+')':''),i[k],'inputmode="decimal"')).join('')}${field('site_index','Standortindex (z. B. T25 / G26)',i.site_index)}${field('source_label','Quelle',i.source_label||'Manuelle Eingabe')}</div></fieldset><fieldset><legend>Baumartenanteile · zusammen 100 %</legend><div class="fp-form-grid">${Object.entries(M.SPECIES).map(([k,v])=>field('species_'+k,v+' (%)',i.species_pct?.[k],'inputmode="decimal"')).join('')}</div></fieldset><details><summary>Entnahme, Zuwachs- und Erlösannahmen</summary><div class="fp-form-grid">${field('removal_pct','Geplante Entnahme (%)',raw.removal_pct??0,'inputmode="decimal"')}${field('annual_growth_m3sk_ha','Angenommener Zuwachs (m³sk/ha/Jahr)',i.annual_growth_m3sk_ha,'inputmode="decimal"')}${field('price_sek_m3sk','Angenommener Preis (SEK/m³sk)',i.price_sek_m3sk,'inputmode="decimal"')}</div><p class="fp-muted">m³sk ist stehendes Holz einschließlich Rinde und Spitze. Käuferpreise in m³fub dürfen hier nicht unverändert eingesetzt werden.</p></details>`}
      <label>Notizen<textarea class="fp-input" name="notes" rows="3" maxlength="5000">${esc(raw.notes||'')}</textarea></label><div id="fp-form-error" class="fp-form-error" role="alert"></div><div class="fp-actions"><button type="submit" class="fp-btn primary">Speichern</button>${button('cancel','Abbrechen')}</div></form>`);
    el('fp-form').addEventListener('submit',e=>{e.preventDefault();saveForm().catch(e=>{if(el('fp-form-error'))el('fp-form-error').textContent=e.message;});});
  }
  async function saveForm(){
    if(busy||!draft)return;const form=el('fp-form');busy=true;form.querySelector('button[type=submit]').disabled=true;
    try{return await saveFormData(form,draft);}finally{busy=false;if(form.isConnected)form.querySelector('button[type=submit]').disabled=false;}
  }
  async function saveFormData(form,editing){
    const who=editing.who;if(!same(who))throw Error('Benutzer wurde gewechselt.');if(!admin())throw Error('Nur ein Admin kann die Forstplanung ändern.');
    const d=Object.fromEntries(new FormData(form)),raw=editing.raw,kind=editing.kind;let g=raw.geometry;
    if(kind==='property'&&d.geometry_file?.size){if(d.geometry_file.size>5e6)throw Error('GeoJSON bitte auf unter 5 MB vereinfachen.');const parsed=JSON.parse(await d.geometry_file.text());const features=parsed.type==='FeatureCollection'?parsed.features:[parsed];if(features.length!==1)throw Error('Die Grundstücksdatei muss genau eine Polygon- oder MultiPolygon-Fläche enthalten.');g=M.geometry(features[0],/3006/.test(parsed.crs?.properties?.name||'')?'EPSG:3006':'EPSG:4326');}
    let data;
    if(kind==='property'){
      const ha=g?M.area(g):M.number(d.area_ha);if(!d.name.trim()||ha==null||ha<=0)throw Error('Bitte Name und gültige Grundstücksfläche angeben.');
      data={name:d.name.trim(),cadastral_ref:d.cadastral_ref.trim(),geometry:g||null,area_ha:ha,notes:d.notes};M.validateLayout(data,raw.id?stands.filter(s=>s.property_id===raw.id):[]);
    }else{
      const inv={};for(const k of Object.keys(M.FIELDS))if(d[k]!=null&&d[k]!=='')inv[k]=d[k];inv.site_index=d.site_index;inv.source_label=d.source_label;
      const species=Object.fromEntries(Object.keys(M.SPECIES).map(k=>[k,d['species_'+k]]));if(Object.values(species).some(v=>v!==''))inv.species_pct=species;
      if(M.number(inv.volume_m3sk)===raw.inventory?.volume_m3sk&&raw.inventory?.volume_m3sk_ha!=null&&(M.number(inv.volume_m3sk_ha)!==raw.inventory.volume_m3sk_ha||M.number(inv.stock_area_ha)!==(raw.inventory.stock_area_ha??null)))delete inv.volume_m3sk;
      inv.sources={...raw.inventory?.sources};
      const comparable=M.inventory(inv);for(const k of Object.keys(inv.sources))if(comparable[k]==null)delete inv.sources[k];for(const k of [...Object.keys(M.FIELDS),'site_index','species_pct'])if(comparable[k]!=null&&JSON.stringify(comparable[k])!==JSON.stringify(raw.inventory?.[k]))inv.sources[k]={name:raw.id?'Manuelle Ergänzung':(inv.source_label||'Manuelle Eingabe'),year:inv.reference_year||inv.scan_year||null};
      data=M.stand({...d,geometry:g,inventory:inv,area_id:raw.area_id});if(!data.number)throw Error('Bitte eine Bestandsnummer angeben.');
      const other=rows().filter(s=>s.id!==raw.id);if(other.some(s=>s.number===data.number))throw Error('Diese Bestandsnummer ist bereits vergeben.');M.validateLayout(property(),[...other,data]);
      data.property_id=propertyId;
    }
    if(!same(who)||draft!==editing||propertyId!==editing.propertyId)throw Error('Auswahl wurde gewechselt. Bitte erneut öffnen.');
      const table=kind==='property'?'forest_properties':'forest_stands',id=raw.id||newRecordId();
      if(!raw.id)Object.assign(data,{id,company_id:who.company,created_by:who.id});
      const guard=raw.updated_at&&!raw._offline_pending&&navigator.onLine&&!window.OfflineQueue.size()?'&updated_at=eq.'+encodeURIComponent(raw.updated_at):'';
      const updated=await dbFetch(table+(raw.id?'?id=eq.'+id+guard:'?select=*'),{method:raw.id?'PATCH':'POST',body:data,prefer:'return=representation'});
      if(!same(who))return;const row=Array.isArray(updated)&&updated[0]?updated[0]:{...raw,...data,id,_offline_pending:true};
      if(kind==='property'){properties=properties.filter(p=>p.id!==id).concat(row);propertyId=id;standId=null;}else{stands=stands.filter(s=>s.id!==id).concat(row);standId=id;}
      const continueWith=editing.continueWith;quick=null;closeModal();render(true);if(kind==='property'&&continueWith)showForm('stand',{...continueWith,number:String(rows().length+1)});message(row._offline_pending?'Lokal gespeichert · Synchronisierung folgt.':'Gespeichert.');
  }
  function startDraw(kind,id){if(kind!=='quick'&&!admin())return;cancelDraw();const raw=kind==='property'?properties.find(p=>p.id===id):stands.find(s=>s.id===id);draw={kind,raw:raw||{},points:[],layer:L.featureGroup().addTo(map)};closeModal();paintDraw();}
  function paintDraw(){if(!draw)return;draw.layer.clearLayers();const points=draw.points.map(p=>[p[1],p[0]]);if(points.length>1)L.polyline(points,{color:'#f4d76e',weight:3,interactive:false}).addTo(draw.layer);points.forEach(p=>L.circleMarker(p,{radius:4,color:'#fff',fillOpacity:1,interactive:false}).addTo(draw.layer));shapes.eachLayer(group=>group.eachLayer?.(l=>{const path=l.getElement?.();if(path)path.style.pointerEvents='none';}));const tools=el('fp-draw-tools');tools.hidden=false;tools.innerHTML=`<p>${draw.kind==='quick'?'Auswertungsfläche':draw.kind==='property'?'Grundstück':'Bestand'}: Grenze antippen · ${points.length} Punkte</p>${button('finish-draw',draw.kind==='quick'?'Walddaten anzeigen':'Grenze übernehmen','','primary')}${button('undo-draw','Letzten Punkt entfernen')}${button('cancel-draw','Abbrechen')}`;}
  function cancelDraw(){if(draw&&map)map.removeLayer(draw.layer);draw=null;if(el('fp-draw-tools'))el('fp-draw-tools').hidden=true;if(map&&shapes)shapes.eachLayer(group=>group.eachLayer?.(l=>{const path=l.getElement?.();if(path)path.style.pointerEvents='';}));}
  function finishDraw(){if(!draw||draw.points.length<3)throw Error('Mindestens drei Grenzpunkte setzen.');const g=M.geometry({type:'Polygon',coordinates:[draw.points]});if(draw.kind==='stand'&&!M.inside(g,property()?.geometry))throw Error('Der Bestand liegt außerhalb des Grundstücks.');const next={kind:draw.kind,raw:{...draw.raw,geometry:g,area_ha:M.area(g)}};cancelDraw();if(next.kind==='quick'){quick={...next.raw,name:'Freie Fläche'};standId=null;render();return fetchData(quick,true);}showForm(next.kind,next.raw);}
  async function remove(kind,id){if(!admin())throw Error('Nur ein Admin kann löschen.');const who=ctx(),p=kind==='property';if(!confirm(p?'Grundstück und alle zugehörigen Bestände löschen?':'Diesen Bestand löschen?'))return;busy=true;try{await dbFetch((p?'forest_properties':'forest_stands')+'?id=eq.'+id,{method:'DELETE',prefer:'return=representation'});if(!same(who))return;if(p){properties=properties.filter(p=>p.id!==id);stands=stands.filter(s=>s.property_id!==id);propertyId=properties[0]?.id||null;}else stands=stands.filter(s=>s.id!==id);standId=null;render(true);message('Löschung gespeichert.');}finally{busy=false;}}
  async function readFile(){
    const file=el('fp-file').files[0];el('fp-file').value='';if(!file)return;if(!admin()||!property())throw Error('Bitte als Admin ein Grundstück auswählen.');if(file.size>5e6)throw Error('Import bitte auf unter 5 MB vereinfachen.');
    const who=ctx(),target=propertyId,text=await file.text();if(!same(who)||target!==propertyId)return;
    const imported=/\.csv$/i.test(file.name)?M.parseCSV(text):M.parseGeoJSON(text),seen=new Set(),data=[];
    for(const s of imported){
      if(seen.has(s.number))throw Error('Bestandsnummer '+s.number+' ist in der Datei mehrfach vorhanden.');seen.add(s.number);
      const existing=rows().find(x=>x.number===s.number);
      if(existing){
        if(Math.abs(existing.area_ha-s.area_ha)>Math.max(.01,existing.area_ha*.0001)||(existing.geometry&&s.geometry&&(M.area(existing.geometry)+M.area(s.geometry)-2*M.overlap(existing.geometry,s.geometry))>.01))throw Error('Bestand '+s.number+': Grenze oder Fläche weicht vom vorhandenen Bestand ab. Bitte Zuordnung prüfen.');
        M.stand({...existing,inventory:s.inventory});data.push({...existing,inventory:s.inventory,replace:true});
      }else data.push(s);
    }
    M.validateLayout(property(),[...rows().filter(s=>!seen.has(s.number)),...data]);const updates=data.filter(s=>s.replace).length;
    draft={kind:'import',data,who,propertyId:target};
    modal('Import prüfen',`<p>${data.length-updates} neue Bestände · ${updates} bestehende Datenblätter</p><p class="fp-muted">${esc(file.name)}. Neue Bestände werden angelegt. Bei übereinstimmenden Bestandsnummern bleiben Grenzen, Namen und Maßnahmen erhalten.</p>${updates?'<label class="fp-source"><input type="checkbox" id="fp-replace-confirm"> Ich möchte die Kennzahlen der genannten vorhandenen Bestände ersetzen. Fehlende Werte in der Datei werden dabei unbekannt.</label>':'<p class="fp-muted">Fehlende Kennzahlen bleiben unbekannt.</p>'}<table class="fp-table"><thead><tr><th>Nr.</th><th>Bestand</th><th>Import</th></tr></thead><tbody>${data.map(s=>`<tr><td>${esc(s.number)}</td><td>${esc(s.name)} · ${fmt(s.area_ha,2)} ha</td><td>${s.replace?'Kennzahlen ersetzen':'Neu'}</td></tr>`).join('')}</tbody></table><div class="fp-actions">${button('confirm-import','Import übernehmen','','primary')}${button('cancel','Abbrechen')}</div>`);
  }
  async function confirmImport(){
    if(busy||draft?.kind!=='import')return;if(el('fp-replace-confirm')&&!el('fp-replace-confirm').checked)throw Error('Bitte das Ersetzen der vorhandenen Kennzahlen bestätigen.');
    busy=true;const data=draft.data,who=draft.who,target=draft.propertyId;let count=0;
    try{for(const s of data){
      if(!same(who))throw Error('Benutzer wurde gewechselt.');const {replace,...incoming}=s,body=replace?{inventory:s.inventory}:{...incoming,id:newRecordId(),property_id:target,company_id:who.company,created_by:who.id};
      const guard=replace&&s.updated_at&&!s._offline_pending&&navigator.onLine&&!window.OfflineQueue.size()?'&updated_at=eq.'+encodeURIComponent(s.updated_at):'';
      const saved=await dbFetch('forest_stands'+(replace?'?id=eq.'+s.id+guard:'?select=*'),{method:replace?'PATCH':'POST',body,prefer:'return=representation'});count++;
      if(!same(who))throw Error('Benutzer wurde gewechselt.');const row=saved?.[0]||{...incoming,...body,_offline_pending:true};stands=replace?stands.map(x=>x.id===s.id?row:x):stands.concat(row);
    }closeModal();standId=null;render(true);message(count+' Bestände übernommen.');
    }catch(e){closeModal();if(same(who))render(true);throw Error(count+' von '+data.length+' Beständen gespeichert. '+e.message);}finally{busy=false;}
  }
  async function fromArea(){const who=ctx(),target=propertyId,data=await dbFetch('areas?company_id=eq.'+who.company+'&order=name');if(!same(who)||target!==propertyId)return;const eligible=(data||[]).filter(a=>a.boundary?.length>=3);if(!eligible.length)throw Error('Noch keine Lignum-Gebiete mit Flächengrenze vorhanden.');draft={kind:'area',data:eligible};modal('Gebiet als Bestand übernehmen',eligible.map(a=>`<div class="fp-row">${button('choose-area',a.name,a.id)}</div>`).join(''));}
  async function fetchData(s,direct=false){
    if(!s?.geometry)throw Error('Bitte zuerst eine Bestandsgrenze zeichnen oder importieren.');
    if(!window.ForestRasterData)throw Error('Bitte die App online neu laden, damit die ZIP-Auswertung verfügbar wird.');
    draft={kind:'zip-options',stand:s,who:ctx(),propertyId,direct};
    const job=draft;
    modal(direct?'Fläche auswerten':'ZIP-Daten auswerten',`<p>${esc(s.name)} · Vorrat, Höhe, Durchmesser, Grundfläche und Baumarten aus dem hinterlegten Datenpaket.</p><p id="fp-zip-coverage" class="fp-muted">Datenabdeckung wird geprüft …</p><label>Altersmodell (nur Bestandsalter, kein Baumarten-Vorratsfilter)<select id="fp-age-type" class="fp-input"><option value="auto">Automatisch anhand der verfügbaren Baumartendaten (Näherung)</option><option value="">Alter nicht übernehmen</option><option value="pine">Kiefernwald</option><option value="spruce">Fichtenwald</option><option value="birch">Birkenwald</option><option value="other">Weitere Laubbäume</option><option value="mixed">Mischwald</option></select></label><p class="fp-muted"><strong>Wichtig:</strong> Kiefer, Fichte und Birke im Altersmodell beeinflussen die Altersschätzung, nicht den gesamten Holzvorrat. Den Vorrat der einzelnen Baumarten zeigt Lignum getrennt anhand überlappender SLU-Baumarten- und Vorratsraster.</p>
      <label>Baumart für die Vorratsanzeige<select id="fp-species-focus" class="fp-input"><option value="followAge">Passend zur gewählten Alterskarte</option><option value="all">Alle Baumarten</option><option value="pine">Kiefer</option><option value="spruce">Fichte</option><option value="birch">Birke</option><option value="other">Weitere Baumarten</option></select></label><p class="fp-muted">Damit vergleichst du den geschätzten Vorrat je Baumart. Gesamthöhe, Gesamtdurchmesser, Grundfläche und Gesamtvorrat bleiben die Werte des ganzen Waldbestandes.</p><p class="fp-muted">Automatisch wird die Alterskarte vorsichtig anhand der Baumarten-Volumenanteile angenähert. Diese sind kein Nachweis der 65-%-Grundflächenregel. Bei bekanntem Waldtyp kannst du die Auswahl korrigieren. Alterswerte beziehen sich auf 2025 und unterschätzen alte Bestände.</p><label>Standortanzeigende Baumart<select id="fp-site-species" class="fp-input"><option value="auto">Automatisch aus Baumartendaten (Näherung)</option><option value="">Standortindex nicht übernehmen</option><option value="T">Kiefer · T</option><option value="G">Fichte · G</option></select></label><p class="fp-muted">Die standortanzeigende Baumart kann von der häufigsten Baumart abweichen. Eine automatisch ausgewählte T-/G-Karte ist nur eine Näherung und wird nicht zur Bestätigung der gesetzlichen Mindestaltersgrenze genutzt. Korrigiere die Auswahl, wenn du den tatsächlichen Waldstandort kennst. Bereits geladene Ausschnitte sind offline verfügbar.</p><div id="fp-zip-error" class="fp-form-error" role="alert" tabindex="-1"></div><div class="fp-actions">${button('calculate-zip','Auswerten','','primary')}${button('cancel','Abbrechen')}</div>`);
    window.ForestRasterData.coverage(s.geometry).then(c=>{
      if(draft!==job||!same(job.who))return;
      el('fp-zip-coverage').textContent=`Datengebiet ${c.name}: ${fmt(c.coverage_ha,2)} von ${fmt(c.area_ha,2)} ha im Datenpaket.`;
      if(!c.coverage_ha)el('fp-zip-error').textContent='Die Fläche liegt außerhalb des derzeit verfügbaren Datengebiets. Die Auswahl der Alterskarte ändert das Datengebiet nicht.';
    }).catch(e=>{if(draft===job)el('fp-zip-coverage').textContent=e.message;});
  }
  async function calculateZIP(){
    if(draft?.kind!=='zip-options')return;const job=draft,who=job.who,s=job.stand;
    const ageType=el('fp-age-type').value,focusChoice=el('fp-species-focus').value;
    const speciesFocus=focusChoice==='followAge'&&['pine','spruce','birch','other'].includes(ageType)?ageType:
      focusChoice==='followAge'?'all':focusChoice;
    const options={ageType,speciesFocus,siteSpecies:el('fp-site-species').value,includeSubareas:true};
    busy=true;el('fp-modal-root').querySelectorAll('button').forEach(b=>b.disabled=true);
    el('fp-zip-error').textContent='';
    try{
      const r=await window.ForestRasterData.inventory(s.geometry,options,(n,total)=>message('ZIP-Daten werden ausgewertet · Ausschnitt '+n+' von '+total+' …'));
      if(!same(who)||(job.direct?quick!==s:selected()?.id!==s.id)||screen.style.display==='none'||draft!==job)return;
      if(job.direct){quick={...s,result:r};closeModal();render();message('Walddaten angezeigt. Speichern ist optional.');return;}
      draft={kind:'zip',stand:s,result:r,who,propertyId};
      modal('ZIP-Ergebnis prüfen',`<p>${esc(s.name)} · ausgewerteter Ausschnitt ${fmt(r.coverage_ha,2)} von ${fmt(r.area_ha,2)} ha.</p><div class="fp-grid">${Object.entries(r.inventory).filter(([k,v])=>M.FIELDS[k]&&typeof v==='number').map(([k,v])=>stat(M.FIELDS[k][0],v,M.FIELDS[k][1],1)).join('')}${r.inventory.site_index?`<div class="fp-stat"><small>Standortindex</small><strong>${esc(r.inventory.site_index)}</strong></div>`:''}</div><p class="fp-muted">${esc(r.note)} Vorhandene Kennzahlen der ausgewerteten Datentypen werden ersetzt; nicht abgedeckte Werte werden unbekannt. Nicht gewählte Alters- und Standortangaben bleiben erhalten. ${r.coverage_ha<r.area_ha-.0001?'Ein Teil des Bestandes liegt außerhalb des Datenpakets. Die fehlende Fläche wird nicht hochgerechnet.':''}</p><div class="fp-actions">${button('apply-zip','Kennzahlen übernehmen','','primary')}${button('cancel','Abbrechen')}</div>`);message('Auswertung fertig. Bitte Kennzahlen prüfen und übernehmen.');
    }catch(e){if(draft===job&&same(who)){el('fp-zip-error').textContent=e.message;el('fp-zip-error').focus();message(e.message,true);}}
    finally{busy=false;el('fp-modal-root').querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  async function prepareOrder(s){await openAuftragForm();el('apl-f-titel').value=(M.ACTIONS[s.action]||'Forstmaßnahme')+' · '+s.name;el('apl-f-beschreibung').value='Forstplanung: '+property().name+' · Bestand '+s.number+'\nFläche: '+fmt(s.area_ha,2)+' ha\nGeschätzter Vorrat: '+fmt(M.stock(s))+' m³sk\nGeplante Entnahme: '+fmt(s.removal_pct,1)+' %\n'+(s.notes||'');if(s.area_id)el('apl-f-gebiet').value=s.area_id;if(s.geometry){const ll=L.geoJSON(s.geometry).getBounds().getCenter();aplFormSetLoc(ll.lat,ll.lng);}message('Auftrag aus der Forstplanung vorbereitet.');}
  async function dispatch(act,id,buttonEl){
    if(busy)return;
    if(['new-property','edit-property','new-stand','edit-stand','draw-property','draw-stand','import','confirm-import','from-area','choose-area','save-quick','quick-save-property','quick-new-property','apply-zip','delete-property','delete-stand','order'].includes(act)&&!admin())throw Error('Nur ein Admin kann die Forstplanung ändern.');
    switch(act){
      case 'close':return close();case 'refresh':reloadMap();return refresh();case 'retry-map':return reloadMap();case 'street-map':return setBasemap('streets');case 'overview':quick=null;standId=null;return render();case 'select':quick=null;standId=id;return render();case 'cancel':return closeModal();
      case 'new-property':return showForm('property');case 'edit-property':return showForm('property',property());case 'new-stand':return showForm('stand');case 'edit-stand':return showForm('stand',selected());
      case 'draw-quick':return startDraw('quick');case 'shared-areas':return modal('Flächen aus der normalen Karte',sharedList());case 'select-area':return selectArea(id);case 'quick-data':return fetchData(quick,true);case 'save-quick':return saveQuick();case 'quick-save-property':return saveQuickTo(id);case 'quick-new-property':return saveQuickTo();
      case 'draw-property':return startDraw('property',id);case 'draw-stand':return startDraw('stand',id);case 'finish-draw':return finishDraw();case 'undo-draw':draw?.points.pop();return paintDraw();case 'cancel-draw':cancelDraw();return renderMap();
      case 'delete-property':return remove('property',id);case 'delete-stand':return remove('stand',id);case 'import':el('fp-file').click();return;case 'confirm-import':return confirmImport();case 'from-area':return fromArea();
      case 'choose-area':{const a=draft?.data.find(a=>a.id===id);if(a)return showForm('stand',{name:a.name,number:String(rows().length+1),geometry:{type:'Polygon',coordinates:[a.boundary.map(p=>[p[1],p[0]])]},area_id:a.id});return;}
      case 'fetch-data':buttonEl.disabled=true;try{return await fetchData(selected());}finally{buttonEl.disabled=false;}
      case 'calculate-zip':return calculateZIP();
      case 'apply-zip':{if(draft?.kind!=='zip')return;const who=draft.who;if(!same(who)||draft.propertyId!==propertyId)throw Error('Auswahl wurde gewechselt.');busy=true;try{const s=draft.stand,inv=M.inventory(window.ForestRasterData.merge(s.inventory,draft.result));const guard=s.updated_at&&!s._offline_pending&&navigator.onLine&&!window.OfflineQueue.size()?'&updated_at=eq.'+encodeURIComponent(s.updated_at):'';const data=await dbFetch('forest_stands?id=eq.'+s.id+guard,{method:'PATCH',body:{inventory:inv},prefer:'return=representation'});if(!same(who))return;stands=stands.map(x=>x.id===s.id?(data?.[0]||{...s,inventory:inv,_offline_pending:true}):x);closeModal();return render();}finally{busy=false;}}
      case 'order':return prepareOrder(selected());
      case 'export-property':case 'export':{const output=act==='export-property'?{type:'FeatureCollection',features:[{type:'Feature',geometry:property().geometry,properties:{name:property().name,area_ha:property().area_ha}}]}:M.featureCollection(rows());const blob=new Blob([JSON.stringify(output,null,2)],{type:'application/geo+json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=act==='export-property'?'lignum-grundstueck.geojson':'lignum-bestaende.geojson';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;}
    }
  }
  window.ForestPlanning={open,hide,refresh,isOpen:()=>!!screen&&screen.style.display!=='none'};
})();
