(function(root){
 "use strict";
 function Simulator(){this.connected=true;}
 Simulator.prototype.status=function(){return {mode:"simulator",connected:this.connected,message:"Simulator – keine TimberMatic-Dateien werden verändert"};};
 Simulator.prototype.simulatePiece=function(job,assortment){
   var lengths=assortment.lengthsMm||[4300], length=lengths[Math.floor(Math.random()*lengths.length)];
   var min=assortment.minDiameterMm||140,max=Math.min(assortment.maxDiameterMm||450,450);
   var d=Math.round(min+Math.random()*Math.max(1,max-min));
   var r=d/2000, volume=Math.PI*r*r*(length/1000);
   return LignumHarvesterModel.createProductionEvent({jobId:job.id,species:assortment.species,assortment:assortment.name,lengthMm:length,diameterMm:d,volumeM3:Number(volume.toFixed(3))});
 };
 root.LignumTimberMatic={Simulator:Simulator};
})(window);
