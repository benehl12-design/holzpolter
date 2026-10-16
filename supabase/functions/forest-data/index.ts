import proj4 from 'npm:proj4@2.11.0';
import {API,ENDPOINTS,geometryParameters,mapResponses} from './skogs-adapter.mjs';

const SWEREF='+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const clientId=()=>Deno.env.get('SKOGS_CLIENT_ID');
const clientSecret=()=>Deno.env.get('SKOGS_CLIENT_SECRET');
let token='',expires=0;
async function skogsToken(){
  if(token&&Date.now()<expires)return token;
  const r=await fetch('https://auth.skogsstyrelsen.se/connect/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',scope:'sks_api',client_id:clientId()!,client_secret:clientSecret()!}),signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('Skogsstyrelsen-Zugang wurde abgewiesen. Zugang serverseitig prüfen.');
  const data=await r.json();if(!data.access_token)throw Error('Kein Zugriffstoken von Skogsstyrelsen erhalten.');
  token=data.access_token;expires=Date.now()+Math.max(0,(Number(data.expires_in)||300)-60)*1000;return token;
}
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return response({message:'Nur POST ist zulässig.'},405);
  try{
    const authorization=req.headers.get('authorization')||'';
    if(!/^Bearer\s+\S+$/i.test(authorization))return response({message:'Bitte anmelden.'},401);
    const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_ANON_KEY')!;
    const headers={Authorization:authorization,apikey:key};
    const userResponse=await fetch(url+'/auth/v1/user',{headers,signal:AbortSignal.timeout(10000)});
    if(!userResponse.ok)return response({message:'Sitzung abgelaufen. Bitte neu anmelden.'},401);
    const user=await userResponse.json();
    const profileResponse=await fetch(url+'/rest/v1/profiles?id=eq.'+encodeURIComponent(user.id)+'&deleted_at=is.null&select=id,company_id,role,is_admin&limit=1',{headers,signal:AbortSignal.timeout(10000)});
    const profile=profileResponse.ok?(await profileResponse.json())[0]:null;
    if(!profile?.company_id)return response({message:'Kein aktives Betriebsprofil gefunden.'},403);
    const text=await req.text();if(text.length>100000)return response({message:'Flächengrenze zu groß.'},413);
    const body=JSON.parse(text);
    const configured=!!(clientId()&&clientSecret());
    if(body.operation==='status')return response({configured,api_version:'1.1',fields:Object.values(ENDPOINTS)});
    if(profile.role!=='admin'&&!profile.is_admin)return response({message:'Grunddatenabruf ist nur für Admins verfügbar.'},403);
    if(body.operation!=='inventory')return response({message:'Unbekannte Operation.'},400);
    if(!configured)return response({code:'SOURCE_NOT_CONFIGURED',message:'Für automatische Grunddaten fehlt noch der Skogsstyrelsen-API-Zugang. Bestände können bereits manuell oder per Datei erfasst werden.'},503);
    const {parameters,area_ha}=geometryParameters(body.geometry,p=>proj4('EPSG:4326',SWEREF,p));
    const access=await skogsToken();
    const results=await Promise.allSettled(Object.keys(ENDPOINTS).map(async endpoint=>{
      const r=await fetch(API+'/'+endpoint,{method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify(parameters),signal:AbortSignal.timeout(25000)});
      if(r.status===401){token='';expires=0;throw Error('SKOGS_AUTH');}if(!r.ok)throw Error('SKOGS_'+r.status);
      return [endpoint,await r.json()];
    }));
    const data=Object.fromEntries(results.filter(r=>r.status==='fulfilled').map(r=>r.status==='fulfilled'?r.value:[]));
    if(!Object.keys(data).length)return response({message:'Die Skogsstyrelsen-Abfrage ist derzeit nicht verfügbar. Vorhandene Bestandsdaten bleiben erhalten.'},502);
    return response(mapResponses(data,area_ha));
  }catch(e){
    const message=e instanceof Error?e.message:'Unbekannter Fehler';
    if(e instanceof SyntaxError)return response({message:'Ungültige Anfrage.'},400);
    // Never return upstream bodies or credentials to the browser.
    return response({message:message.startsWith('SKOGS_')?'Skogsstyrelsen-Abfrage fehlgeschlagen.':message},400);
  }
});
