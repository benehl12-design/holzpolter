/* LIGNUM · Advisory Swedish thinning bands. Skogforsk hprYield 2024, appendix 14.
   INGVAR basal-area upper limit: c + k * ln(dominant height); lower limit: 60% of upper.
   Reference: https://www.skogforsk.se/contentassets/2d0af30a469b4500b5cf61cef2ad4ca6/arbetsrapport-1228-2024-hpryield--berakningsmodul-for-generering-av-geografiskt-uppdelade-nyckeltal-baserade-pa-skordardata.pdf
   The target at 80% of upper and the precautionary 35/30% caps are Lignum planning
   assumptions, NOT direct INGVAR output. Basal-area removal is NOT timber volume removal.
*/
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.ForestThinning=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const TABLE={
    G:[[16,22,-21.11,18.747],[23,28,-19.007,18.706],[29,34,-18.812,19.041],[35,40,-19.581,19.844]],
    T:[[14,17,-22.642,17.621],[18,21,-8.4582,12.905],[22,25,-10.823,14.434],[26,30,-10.523,14.941]]
  };
  const SOURCE='Skogforsk hprYield (2024), Bilaga 14 · INGVAR-Grundflächenband';
  const round=(n,d=1)=>Math.round(n*10**d)/10**d;
  const numeric=value=>value==null||value===''?null:(Number.isFinite(Number(value))?Number(value):null);
  function evaluate(raw={}){
    const i=raw.inventory||raw,land=raw.land_type||'forest',hk=raw.hk_class||'';
    const result={status:'needs-data',action:'review',removal_pct:null,removal_range_pct:null,
      basal_after_m2_ha:null,upper_basal_m2_ha:null,lower_basal_m2_ha:null,
      method:SOURCE,missing:[],warnings:[],confidence:'low',reason:'',review:true};
    if(['water','wetland'].includes(land)||['NO','NS','E','K','R'].includes(hk)||land!=='forest'){
      return {...result,status:'not-applicable',reason:'Schutz-, Jung- oder ungleichaltriger Bestand: reguläre Gallringsmall nicht automatisch anwenden.'};
    }
    const basal=numeric(i.basal_area_m2_ha),dom=numeric(i.dominant_height_m),mean=numeric(i.mean_height_m),p95=numeric(i.p95_height_m),
      age=numeric(i.age_years),area=numeric(raw.area_ha);
    const si=typeof i.site_index==='string'?i.site_index.trim().toUpperCase():'';
    const match=/^([TG])(\d{1,2})$/.exec(si),type=match?.[1],value=match?Number(match[2]):null;
    const c=match?TABLE[type].find(row=>value>=row[0]&&value<=row[1]):null;
    if(!(basal>0))result.missing.push('basal_area_m2_ha');
    if(!(dom>0)&&!(mean>0)&&!(p95>0))result.missing.push('dominant_height_m');
    const hasReferences=numeric(i.site_index_pine)>0||numeric(i.site_index_spruce)>0;
    if(!c)result.missing.push(!si?(hasReferences?'site_type_confirmation':'site_index'):'site_index_unsupported');
    if(result.missing.length){
      result.reason=result.missing.length===1&&hasReferences&&!si
        ?'Die Standortreferenzkarten für Kiefer und/oder Fichte sind vorhanden. Für den Mischbestand ist die standortanzeigende Baumart noch nicht bestätigt; beide Referenzen werden getrennt und nur bedingt geprüft.'
        :result.missing.length===1&&si&&!c
          ?'Der bestätigte Standortindex '+si+' liegt außerhalb der hinterlegten INGVAR-Tabelle (T14–T30 bzw. G16–G40). Eine Extrapolation wäre nicht belastbar.'
          :'Für die INGVAR-Berechnung fehlen Grundfläche, Höhenhinweis oder eine bestätigte und unterstützte Standortzuordnung (T14–T30 bzw. G16–G40).';
      return result;
    }
    // P95 from a 10 m LiDAR pixel summarizes return heights, not the 100
    // thickest trees per hectare. It can guide a wide *sensitivity scenario*
    // but must NEVER become a measured Hdom or a definitive removal percentage.
    const exact=dom!=null&&dom>0;
    const p95Coverage=i.sources?.p95_height_m?.area_ha;
    const p95Covered=area==null||!(area>0)||p95Coverage==null||Number(p95Coverage)>=area*.7;
    const p95Plausible=p95>0&&p95>=8&&p95<=32&&
      (!(mean>0)||(p95>=mean*.9&&p95<=mean*1.8));
    const useP95=!exact&&p95Plausible&&p95Covered;
    const heightField=exact?'dominant_height_m':useP95?'p95_height_m':'mean_height_m';
    if(!exact&&!useP95&&!(mean>0)){
      return {...result,missing:['dominant_height_m'],reason:'P95 ohne ausreichende Rasterabdeckung oder außerhalb plausibler Grenzen; mittlere Höhe oder Gelände-Oberhöhe erforderlich.'};
    }
    const minHeight=exact?dom:useP95?p95*.8:mean,
      maxHeight=exact?dom:useP95?p95*1.2:mean*1.2;
    if([['basal_area_m2_ha',basal],[heightField,exact?dom:useP95?p95:mean],['site_index',value]].some(([k,v])=>
      v!=null&&area>0&&i.sources?.[k]?.area_ha!=null&&Number(i.sources[k].area_ha)<area*.7)){
      return {...result,missing:['Rasterabdeckung'],reason:'Mindestens eine notwendige Kennzahl deckt weniger als 70 % der Fläche ab.'};
    }
    if(age!=null&&age<20)return {...result,status:'not-applicable',reason:'Jungbestand: vor einer Durchforstung zunächst Pflegebedarf beurteilen.'};
    if(minHeight<8||maxHeight>40)return {...result,status:'needs-data',missing:['dominant_height_m'],reason:'Höhe außerhalb des Anwendungsbereichs für diese orientierende Berechnung.'};
    const upper=h=>c[2]+c[3]*Math.log(h);
    const upperLo=upper(minHeight),upperHi=upper(maxHeight);
    if(!(upperLo>0&&upperHi>0))return {...result,reason:'Das Diagramm liefert für diese Höhe keine plausible positive Grundfläche.'};
    const lowerLo=.6*upperLo,lowerHi=.6*upperHi;
    const strongLimit=hk==='G1'?35:30; // Lignum safety cap, not an INGVAR coefficient
    const suggested=limit=>Math.max(0,Math.min(strongLimit,100*(basal-.8*limit)/basal));
    const pctLow=suggested(upperHi),pctHigh=suggested(upperLo);
    const base={...result,upper_basal_m2_ha:round(upperLo),lower_basal_m2_ha:round(lowerLo),
      upper_range_m2_ha:[round(upperLo),round(upperHi)],lower_range_m2_ha:[round(lowerLo),round(lowerHi)],
      basis_height_m:exact?dom:null,height_range_m:exact?null:[round(minHeight),round(maxHeight)],
      height_kind:exact?'measured':useP95?'sensitivity-p95-laser':'sensitivity-mean-height',standortindex:si,
      strength_cap_pct:strongLimit,target_fraction_of_upper:.8,
      confidence:exact?'medium':'low'};
    if(!exact&&useP95)base.warnings.push('Hdom fehlt: der Laserscan-P95-Wert wird ausschließlich als ±20-%-Sensitivitätsbereich für INGVAR verwendet (nicht statistisch kalibriert, keine Messung oder Sicherheitsgrenze). Keine verbindliche Prozentangabe.');
    else if(!exact)base.warnings.push('Oberhöhe nicht vorhanden: 100–120 % der mittleren Höhe ist nur ein Sensitivitätsbereich, kein gemessener Umrechnungsfaktor.');
    if(p95>0&&!useP95)base.warnings.push('P95 wurde nicht als Hdom-Ersatz verwendet; Datenabdeckung, Plausibilität oder vorrangige Geländemessung prüfen.');
    if(useP95&&i.scan_year)base.warnings.push('P95-Laserscan ist historisch (Scan-Metadatenjahr '+i.scan_year+'); Zuwachs und Eingriffe seitdem wurden nicht fortgeschrieben.');
    if(i.sources?.site_index?.site_species_inferred===true||raw.siteTypeInferred)base.warnings.push('Standortindex-Baumart wurde automatisch angenommen; vor Ort bestätigen.');
    const p=i.species_pct||{};
    if(type==='G'&&numeric(p.spruce)!=null&&numeric(p.spruce)<40)base.warnings.push('G-Standortindex bei geringem Fichtenanteil: Baumart-/Standortzuordnung prüfen.');
    if(type==='T'&&numeric(p.spruce)!=null&&numeric(p.spruce)>65)base.warnings.push('T-Standortindex bei hohem Fichtenanteil: Baumart-/Standortzuordnung prüfen.');
    if(basal<upperLo){
      return {...base,status:'none',action:'none',reason:'Grundfläche liegt unter der oberen INGVAR-Grenze; derzeit kein Durchforstungsbedarf aus diesem Diagramm ableitbar.'};
    }
    if(!exact&&basal<upperHi){
      return {...base,status:'uncertain',action:'review',removal_range_pct:[0,round(pctHigh)],
        reason:'Die Höhe ist nur als Sensitivität angesetzt (P95 oder mittlere Höhe). Je nach tatsächlicher Oberhöhe liegt der Bestand möglicherweise bereits an der Durchforstungsgrenze. Vor einer Entnahme Oberhöhe messen.'};
    }
    if(exact){
      const percentage=round(pctHigh);
      const after=round(basal*(1-percentage/100));
      return {...base,status:'recommended',action:'thinning',removal_pct:percentage,
        basal_after_m2_ha:after,removal_range_pct:[percentage,percentage],
        reason:'Bestandsgrundfläche erreicht die obere INGVAR-Grenze. Vorschlag für verbleibende Grundfläche: ca. 80 % der oberen Modellgrenze, begrenzt durch eine vorsichtige maximale Entnahmestärke.',
        ...(after>upperLo?{warnings:[...base.warnings,'Bei begrenzter Entnahme liegt die Grundfläche weiterhin über der oberen Diagrammgrenze: in Etappen planen.']}:{} )};
    }
    const lo=round(pctLow),hi=round(pctHigh);
    return {...base,status:'provisional',action:'thinning',removal_range_pct:[lo,hi],
      reason:'Die Grundfläche liegt auch bei der höheren angesetzten Höhenvariante über der oberen INGVAR-Grenze. Der Prozentbereich ist nur eine Orientierung, keine Entnahmeempfehlung; Oberhöhe vor Festlegung messen.'};
  }
  // Read *both* independently sampled Swedish SIS raster maps as conditional
  // alternatives. Dominant timber shares do not establish the site-indicating
  // species. Never persist or silently copy a provisional site type to inventory.
  function siteAlternatives(raw={}){
    const i=raw.inventory||raw,area=numeric(raw.area_ha);
    if(i.site_index)return [];
    return [['T','pine','Kiefer'],['G','spruce','Fichte']].map(([type,kind,species])=>{
      const key='site_index_'+kind,n=numeric(i[key]);
      if(!(n>0))return null;
      const rounded=Math.round(n),site_index=type+rounded,source=i.sources?.[key];
      const range=type==='T'?'T14–T30':'G16–G40';
      const covered=source?.area_ha==null?null:numeric(source.area_ha);
      const coverage=area>0&&covered!=null?Math.min(100,round(covered/area*100)):null;
      const base={species,type,site_index,coverage_pct:coverage,coverage_ha:covered,range,confirmed:false};
      if(!TABLE[type].some(row=>rounded>=row[0]&&rounded<=row[1])){
        return {...base,status:'outside-table',advice:null,
          note:site_index+' liegt außerhalb der hinterlegten INGVAR-'+species+'tabelle ('+range+'). Keine Extrapolation.'};
      }
      if(area>0&&covered!=null&&covered<area*.7){
        return {...base,status:'insufficient-coverage',advice:null,
          note:'Der Standortindex deckt weniger als 70 % der gewählten Fläche ab. Keine belastbare Gesamtflächenbewertung.'};
      }
      const inventory={...i,site_index,sources:{...i.sources,site_index:source??{name:'SIS-Rasterreferenz ohne ausgewiesene Abdeckung'}}};
      return {...base,status:'conditional',
        advice:evaluate({...raw,inventory,siteTypeInferred:true}),
        note:'Nur unter der Annahme, dass '+species+' die standortanzeigende Baumart ist; vor Ort bestätigen.'};
    }).filter(Boolean);
  }
  return {evaluate,siteAlternatives,TABLE,SOURCE};
});
