(function(root){
 "use strict";
 var KEY="lignum-harvester-v0.1";
 function defaults(){return {version:1,activeJobId:null,jobs:[],production:[],syncQueue:[]};}
 function load(){try{return Object.assign(defaults(),JSON.parse(localStorage.getItem(KEY)||"{}"));}catch(e){return defaults();}}
 function save(state){localStorage.setItem(KEY,JSON.stringify(state));return state;}
 function reset(){localStorage.removeItem(KEY);return defaults();}
 root.LignumHarvesterStorage={load:load,save:save,reset:reset,key:KEY};
})(window);
