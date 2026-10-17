/* Keep native-cell intersection calculations off the map/UI thread. */
importScripts('vendor/proj4-2.11.0.js','vendor/polygon-clipping-0.15.7.js','forest-raster-data.js');
self.onmessage=event=>{
  try{
    const {geometry,index,tiles,options}=event.data;
    self.postMessage({result:self.ForestRasterData.evaluate(geometry,index,tiles,options)});
  }catch(error){self.postMessage({error:String(error.message||error)});}
};
