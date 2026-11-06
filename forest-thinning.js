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
    const basal=numeric(i.basal_area_m2_ha),dom=numeric(i.dominant_height_m),mean=numeric(i.mean_height_m),
      age=numeric(i.age_years),area=numeric(raw.area_ha);
    const si=typeof i.site_index==='string'?i.site_index.trim().toUpperCase():'';
    const match=/^([TG])(\d{1,2})$/.exec(si),type=match?.[1],value=match?Number(match[2]):null;
    const c=match?TABLE[type].find(row=>value>=row[0]&&value<=row[1]):null;
    if(!(basal>0))result.missing.push('basal_area_m2_ha');
    if(!(dom>0)&&!(mean>0))result.missing.push('dominant_height_m');
    if(!c)result.missing.push('site_index');
    if(result.missing.length){result.reason='Für die INGVAR-Berechnung fehlen Grundfläche, Oberhöhe/Höhenhinweis oder ein unterstützter Standortindex (T14–T30 bzw. G16–G40).';return result;}
    if([['basal_area_m2_ha',basal],['dominant_height_m',dom],['mean_height_m',mean],['site_index',value]].some(([k,v])=>
      v!=null&&area>0&&i.sources?.[k]?.area_ha!=null&&Number(i.sources[k].area_ha)<area*.7)){
      return {...result,missing:['Rasterabdeckung'],reason:'Mindestens eine notwendige Kennzahl deckt weniger als 70 % der Fläche ab.'};
    }
    if(age!=null&&age<20)return {...result,status:'not-applicable',reason:'Jungbestand: vor einer Durchforstung zunächst Pflegebedarf beurteilen.'};
    // Mean height is never silently re-labelled as measured dominant height.
    // Without measured dominant height, a deliberately wide 100–120% sensitivity
    // interval is used. It is not a measured or validated height conversion.
    const exact=dom!=null&&dom>0;
    const minHeight=exact?dom:mean,maxHeight=exact?dom:mean*1.2;
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
      height_kind:exact?'measured':'sensitivity-mean-height',standortindex:si,
      strength_cap_pct:strongLimit,target_fraction_of_upper:.8,
      confidence:exact?'medium':'low'};
    if(!exact)base.warnings.push('Oberhöhe nicht vorhanden: 100–120 % der mittleren Höhe ist nur ein Sensitivitätsbereich, kein gemessener Umrechnungsfaktor.');
    if(numeric(i.p95_height_m)>0)base.warnings.push('Der Laser-P95-Höhenkennwert ist zusätzlich verfügbar, wird aber nicht ungeprüft als Hdom/Oberhöhe in die INGVAR-Formel eingesetzt.');
    if(i.sources?.site_index?.site_species_inferred===true||raw.siteTypeInferred)base.warnings.push('Standortindex-Baumart wurde automatisch angenommen; vor Ort bestätigen.');
    const p=i.species_pct||{};
    if(type==='G'&&numeric(p.spruce)!=null&&numeric(p.spruce)<40)base.warnings.push('G-Standortindex bei geringem Fichtenanteil: Baumart-/Standortzuordnung prüfen.');
    if(type==='T'&&numeric(p.spruce)!=null&&numeric(p.spruce)>65)base.warnings.push('T-Standortindex bei hohem Fichtenanteil: Baumart-/Standortzuordnung prüfen.');
    if(basal<upperLo){
      return {...base,status:'none',action:'none',reason:'Grundfläche liegt unter der oberen INGVAR-Grenze; derzeit kein Durchforstungsbedarf aus diesem Diagramm ableitbar.'};
    }
    if(!exact&&basal<upperHi){
      return {...base,status:'uncertain',action:'review',removal_range_pct:[0,round(pctHigh)],
        reason:'Je nach tatsächlicher Oberhöhe liegt der Bestand möglicherweise bereits an der Durchforstungsgrenze. Oberhöhe messen, bevor ein Prozentwert festgelegt wird.'};
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
      reason:'Die Grundfläche liegt selbst bei der höheren angenommenen Oberhöhe über der oberen INGVAR-Grenze. Der Prozentbereich ist nur eine Vorplanung; Oberhöhe vor Festlegung messen.'};
  }
  return {evaluate,TABLE,SOURCE};
});
