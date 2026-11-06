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
  return {minAgeNorth,harvestReview};
});
