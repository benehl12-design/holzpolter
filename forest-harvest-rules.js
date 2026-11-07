/* LIGNUM — conservative harvest screening, not a felling permit.
 * Northern-Sweden reference ages: Skogsstyrelsen SKSFS 2011:7, ch. 3,
 * table 4 (Norrbotten, Västerbotten, Jämtland, Västernorrland).
 * https://www.skogsstyrelsen.se/globalassets/lag-och-tillsyn/foreskrifter-efter-amne/skogsvard/sksfs-2011-7-skogsstyrelsens-foreskrifter-och-allmanna-rad-till-skogsvardslagen-.pdf
 */
(function(root,factory){
  const rules=factory();
  if(typeof module==='object'&&module.exports)module.exports=rules;
  else root.ForestHarvestRules=rules;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const northAges={12:100,16:90,20:80,24:70,28:65};
  function minAgeNorth(siteIndex){
    const match=/^[TG](\d{1,2})$/.exec(String(siteIndex||'').trim().toUpperCase());
    if(!match)return null;
    const site=Number(match[1]);
    // For intermediate site values use the next lower index (higher age),
    // not interpolation that could falsely imply legal eligibility.
    const lower=Object.keys(northAges).map(Number).filter(n=>n<=site).sort((a,b)=>b-a)[0];
    if(lower==null||site>28)return null;
    return {years:northAges[lower],siteIndex:match[0],referenceIndex:match[0][0]+lower,region:'BD/AC/Z/Y',conservative:true};
  }
  function harvestReview(input={}){
    const age=Number(input.age),basal=Number(input.basal),height=Number(input.height),
      diameter=Number(input.diameter),volume=Number(input.volume);
    const required=[['age',input.age],['basal',input.basal],['height',input.height],
      ['diameter',input.diameter],['volume',input.volume]];
    const missing=required.filter(([,v])=>v==null||v===''||!Number.isFinite(Number(v))).map(([k])=>k);
    const pine=input.pine_pct, spruce=input.spruce_pct;
    const conifersKnown=pine!=null&&spruce!=null&&Number.isFinite(Number(pine))&&Number.isFinite(Number(spruce));
    const coniferShare=conifersKnown?Number(pine)+Number(spruce):null;
    const reference=(input.allowSiteReference!==false&&coniferShare!=null&&coniferShare>=50)
      ?minAgeNorth(input.site_index):null;
    const benchmark=reference?.years??100;
    // The >100 default is ONLY a cautious screening rule when conifer share or
    // site data is unknown. It is not a statutory age test.
    const candidate=!missing.length&&age>=benchmark&&basal>=16&&height>=12&&diameter>=18&&volume>=120;
    return {
      candidate,review:true,legalAgeVerified:false,protectionVerified:false,
      benchmarkYears:benchmark,reference,coniferShare,
      missing,
      conditions:{
        age:!missing.includes('age')&&age>=benchmark,
        basal:!missing.includes('basal')&&basal>=16,
        height:!missing.includes('height')&&height>=12,
        diameter:!missing.includes('diameter')&&diameter>=18,
        volume:!missing.includes('volume')&&volume>=120
      },
      reason:reference
        ?'Nordschwedischer LÅF-Tabellenrichtwert '+reference.years+' Jahre für '+reference.referenceIndex+
          '; Altersraster, Standort, Baumartenanteile und Rechtslage vor Ort verifizieren.'
        :'Ohne belastbaren Standortindex und nachgewiesene Nadelholzdominanz wird konservativ erst ab 100 Jahren eine Ernteprüfung vorgeschlagen.',
      warning:'Nur Ernteprüfung, KEINE Fällfreigabe. Grundflächengewichtetes Alter, Standortsituation, Natur-/Kulturwerte, Rentierhaltung, Verjüngung und ggf. Anmeldung/Genehmigung prüfen.'
    };
  }
  // Stand-level screen for possible regeneration/final harvesting (Endnutzung).
  // The Swedish statutory *minimum* felling age is NOT the economic optimum.
  // A separate field visit, actual age, nature-value review and profitability
  // assessment are required before any real harvesting decision.
  function endUseAssessment(raw={}){
    const i=raw.inventory||raw,area=Number(raw.area_ha);
    const num=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
    const age=num(i.age_years),basal=num(i.basal_area_m2_ha),
      height=num(i.mean_height_m),diameter=num(i.mean_diameter_cm),volume=num(i.volume_m3sk_ha);
    const result={status:'needs-review',candidate:false,age_years:age,
      references:[],structure:null,missing:[],warnings:[],legalAgeVerified:false,
      economicOptimumVerified:false,protectionVerified:false,
      next:['Alter und Standorttyp vor Ort bestätigen','Natur- und Kulturwerte sowie Rentierhaltung prüfen',
        'Wertzuwachs, Holzpreise, Erntekosten und Verjüngung gegenüberstellen'],
      reason:'Eine Endnutzung kann noch nicht ausreichend eingeordnet werden.'};
    const land=raw.land_type||'forest',hk=raw.hk_class||'';
    if(land!=='forest'||['NO','NS','E','K','R'].includes(hk)){
      return {...result,status:'not-applicable',reason:'Schutz-, Jung-, ungleichaltriger oder nicht als Wirtschaftswald bestätigter Bestand: keine automatische Endnutzungsempfehlung.'};
    }
    const keys=[['age_years',age],['basal_area_m2_ha',basal],
      ['mean_height_m',height],['mean_diameter_cm',diameter],['volume_m3sk_ha',volume]];
    for(const [name,value] of keys){
      if(value==null||value<=0)result.missing.push(name);
      else if(area>0&&i.sources?.[name]?.area_ha!=null&&
          Number(i.sources[name].area_ha)<area*.7)result.missing.push(name+' (Rasterabdeckung <70 %)');
    }
    if(i.scan_year!=null)result.warnings.push('Bestandskennzahlen überwiegend historische Laserdaten ('+i.scan_year+'); Eingriffe und Zuwachs danach prüfen.');
    // Barrdominerat >50%: no legal conifer age classification from unknown,
    // coarse species-volume percentages alone. All references are conditional.
    const share=i.species_pct||{},pine=num(share.pine),spruce=num(share.spruce);
    const coniferShare=pine!=null&&spruce!=null?pine+spruce:null;
    const otherMajority=coniferShare!=null&&coniferShare<=50;
    if(otherMajority){
      return {...result,status:'needs-review',coniferShare,
        reason:'Weniger als die Hälfte des Vorrats ist laut Baumartenraster Kiefer/Fichte. Die Nadelholz-Alterstabelle ist hier nicht anwendbar. Mindestalter für Laubbestände und tatsächliche Baumartenverteilung gesondert prüfen.'};
    }
    if(coniferShare==null)result.warnings.push('Baumartenanteile fehlen: die Nadelholz-Alterstabelle ist nur ein bedingter Orientierungswert.');
    const candidates=[];
    if(typeof i.site_index==='string'&&i.site_index.trim()){
      candidates.push({index:i.site_index.trim().toUpperCase(),type:'erfasst',key:'site_index'});
    }else{
      for(const [kind,prefix,label] of [['pine','T','Kiefer'],['spruce','G','Fichte']]){
        const key='site_index_'+kind,value=num(i[key]);
        if(value==null||value<=0)continue;
        const covered=i.sources?.[key]?.area_ha;
        const coverageOk=!(area>0&&covered!=null&&Number(covered)<area*.7);
        candidates.push({index:prefix+Math.round(value),type:'unbestätigte '+label+'-SIS-Referenz',
          key,coverageOk});
      }
    }
    for(const candidate of candidates){
      const ageRule=minAgeNorth(candidate.index);
      result.references.push({site_index:candidate.index,type:candidate.type,
        min_age_years:ageRule?.years??null,
        reference_index:ageRule?.referenceIndex??null,
        age_gap_years:age!=null&&ageRule?Math.round((ageRule.years-age)*10)/10:null,
        coverage_ok:candidate.coverageOk!==false,
        reached:age!=null&&ageRule?age>=ageRule.years:null});
    }
    const valid=result.references.filter(r=>r.min_age_years!=null&&r.coverage_ok);
    const hasReference=valid.length>0;
    if(!hasReference&&candidates.length){
      return {...result,status:'needs-review',missing:[...result.missing,'site_index'],
        reason:'Die vorhandenen Standortindex-Referenzen sind nicht ausreichend abgedeckt oder außerhalb der nordschwedischen Nadelholz-Alterstabelle. Keine automatische Endnutzungsreife ableiten.'};
    }
    if(!hasReference){
      // 100 years is an internal cautious search filter, NEVER a legal-age
      // judgement. This lets mature stands without a species diagnosis surface
      // for a site visit instead of vanishing from planning.
      result.references.push({site_index:null,type:'Lignum-Prüfrichtwert ohne Standortklassifizierung',
        min_age_years:100,age_gap_years:age==null?null:Math.round((100-age)*10)/10,
        reached:age==null?null:age>=100,coverage_ok:null,legal_reference:false});
      result.warnings.push('100 Jahre ist ein vorsichtiger Lignum-Suchwert, keine gesetzliche Altersfreigabe.');
    }
    const refs=hasReference?valid:result.references.filter(r=>r.type.startsWith('Lignum-'));
    const structure={basal:basal!=null&&basal>=16,height:height!=null&&height>=12,
      diameter:diameter!=null&&diameter>=18,volume:volume!=null&&volume>=120};
    result.structure=structure;
    const mature=refs.filter(r=>r.reached===true);
    const near=refs.some(r=>r.age_gap_years!=null&&r.age_gap_years>0&&r.age_gap_years<=15);
    const inRange=refs.every(r=>r.reached===true);
    const goodStructure=Object.values(structure).every(Boolean);
    if(result.missing.length||age==null){
      return {...result,status:'needs-review',
        reason:'Für eine Endnutzungsprüfung fehlen ausreichend abgedeckte Alters-, Vorrats-, Grundflächen-, Höhen- oder Durchmesserwerte. Die Standort-Altersvergleiche sind nur Hinweise.'};
    }
    if(mature.length&&goodStructure){
      return {...result,status:'candidate',candidate:true,
        reason:hasReference
          ?(inRange?'Der geschätzte Bestand liegt unter beiden betrachteten Standortannahmen mindestens beim tabellarischen Altersrichtwert.':'Der Altersrichtwert ist nur unter einer der unbestätigten Standortannahmen erreicht.')+
            ' Der Bestand erfüllt die zusätzlichen vorsichtigen Lignum-Strukturkriterien; Endnutzung gegenüber Weiterwachsen und Durchforstung vor Ort vergleichen.'
          :'Der Bestand überschreitet den vorsichtigen 100-Jahre-Suchwert und erfüllt die Lignum-Strukturkriterien. Endnutzung vor Ort auf Eignung prüfen; das gesetzliche Mindestalter ist nicht bestätigt.'};
    }
    if(near){
      return {...result,status:'approaching',
        reason:'Der geschätzte Bestand nähert sich unter mindestens einer Standortannahme dem tabellarischen Mindestalter. Jetzt Endnutzung, Wertezuwachs und weitere Pflege als Alternativen vergleichen; daraus folgt noch kein Erntetermin.'};
    }
    if(mature.length){
      return {...result,status:'structure-review',
        reason:'Ein tabellarischer Altersorientierungswert ist erreicht, aber mindestens eines der vorsichtigen Strukturkriterien von Lignum ist nicht erfüllt. Weiterwachsen, Baumqualität und Bestockung vor Ort beurteilen.'};
    }
    return {...result,status:'not-yet',
      reason:'Die geschätzte Bestandsalterung liegt unter allen verfügbaren Nadelholz-Altersorientierungswerten. Eine automatische Endnutzungsmaßnahme ist damit nicht begründbar.'};
  }
  return {minAgeNorth,harvestReview,endUseAssessment};
});
