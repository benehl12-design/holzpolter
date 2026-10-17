(function(global){
  "use strict";
  var FIELD=/~(\d+)\s+(\d+)/g;
  function decode(bytes){
    var out="",i; for(i=0;i<bytes.length;i++) out+=String.fromCharCode(bytes[i]);
    return out;
  }
  function encode(text){
    var out=new Uint8Array(text.length),i,c;
    for(i=0;i<text.length;i++){c=text.charCodeAt(i);if(c>255)throw new Error("APT unterstützt hier nur ISO-8859-1.");out[i]=c;}
    return out;
  }
  function parse(text){
    var matches=[],m,last=0,fields=[],prefix="";
    FIELD.lastIndex=0; while((m=FIELD.exec(text))!==null)matches.push({i:m.index,end:FIELD.lastIndex,id:m[1]+"."+m[2]});
    if(matches.length)prefix=text.slice(0,matches[0].i);
    for(var i=0;i<matches.length;i++){last=i+1<matches.length?matches[i+1].i:text.length;fields.push({id:matches[i].id,value:text.slice(matches[i].end,last)});}
    return {prefix:prefix,fields:fields};
  }
  function field(doc,id){for(var i=0;i<doc.fields.length;i++)if(doc.fields[i].id===id)return doc.fields[i];return null;}
  function setField(doc,id,value){var f=field(doc,id);if(!f)throw new Error("APT-Feld "+id+" fehlt.");f.value=value;return doc;}
  function serialize(doc){var s=doc.prefix;for(var i=0;i<doc.fields.length;i++){var p=doc.fields[i].id.split(".");s+="~"+p[0]+" "+p[1]+doc.fields[i].value;}return s;}
  function lines(v){return v.replace(/^\s+|\s+$/g,"").split(/\r?\n/);}
  function numbers(v){var a=v.match(/-?\d+/g)||[];return a.map(function(x){return parseInt(x,10);});}
  function inspect(text){
    var d=parse(text), result={identity:null,species:[],qualityNames:[],productGroups:[],diameterValues:[],lengthValues:[],comment:null};
    var f;
    f=field(d,"2.1"); if(f)result.identity=f.value.trim();
    f=field(d,"120.1"); if(f)result.species=lines(f.value);
    f=field(d,"121.1"); if(f)result.qualityNames=lines(f.value);
    f=field(d,"127.1"); if(f)result.productGroups=lines(f.value);
    f=field(d,"131.1"); if(f)result.diameterValues=numbers(f.value);
    f=field(d,"132.1"); if(f)result.lengthValues=numbers(f.value);
    f=field(d,"200.1"); if(f)result.comment=f.value.trim();
    return result;
  }
  function cloneTemplate(text,identity,comment){
    var d=parse(text), f;
    f=field(d,"2.1"); if(f)f.value=" "+identity+" ";
    f=field(d,"200.1"); if(f)f.value="\r\n"+comment+"\r\n";
    return serialize(d);
  }
  global.LignumAPT={decode:decode,encode:encode,parse:parse,serialize:serialize,inspect:inspect,cloneTemplate:cloneTemplate};
})(this);
