(function(root){
  "use strict";
  function id(prefix){ return prefix+"-"+Date.now()+"-"+Math.floor(Math.random()*1000000); }
  function createAssortment(input){
    input=input||{};
    return {
      id: input.id||id("assortment"),
      species: input.species||"Kiefer",
      name: input.name||"Sägeholz",
      minDiameterMm: Number(input.minDiameterMm||140),
      maxDiameterMm: Number(input.maxDiameterMm||600),
      lengthsMm: (input.lengthsMm||[3700,4300,4900]).map(Number),
      qualityClass: input.qualityClass||"A/B",
      priority: Number(input.priority||1),
      valuePerM3: Number(input.valuePerM3||0),
      enabled: input.enabled!==false
    };
  }
  function createJob(input){
    input=input||{};
    return {id:input.id||id("job"),name:input.name||"Neuer Auftrag",area:input.area||"",status:input.status||"planned",assortments:(input.assortments||[]).map(createAssortment)};
  }
  function createProductionEvent(input){
    input=input||{};
    return {id:input.id||id("piece"),jobId:input.jobId||null,timestamp:input.timestamp||new Date().toISOString(),species:input.species||"",assortment:input.assortment||"",lengthMm:Number(input.lengthMm||0),diameterMm:Number(input.diameterMm||0),volumeM3:Number(input.volumeM3||0),syncState:input.syncState||"pending"};
  }
  root.LignumHarvesterModel={createAssortment:createAssortment,createJob:createJob,createProductionEvent:createProductionEvent};
})(typeof window!=="undefined"?window:globalThis);
