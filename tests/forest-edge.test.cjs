const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const proj4=require('../vendor/proj4-2.11.0');
let adapter;
test.before(async()=>{adapter=await import('../supabase/functions/forest-data/skogs-adapter.mjs');});
const source=fs.readFileSync(path.join(__dirname,'../supabase/functions/forest-data/index.ts'),'utf8').replace(/^import .*;\n/gm,'');
const code=stripTypeScriptTypes(source,{disableExperimentalWarning:true});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function harness({role='admin',company='company-a',configured=false,authenticated=true}={}){
  let handler;const calls=[];
  const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'publishable',...(configured?{SKOGS_CLIENT_ID:'server-id',SKOGS_CLIENT_SECRET:'server-secret'}:{})};
  const context=vm.createContext({Request,Response,URLSearchParams,AbortSignal,proj4,...adapter,
    Deno:{env:{get:k=>env[k]},serve:fn=>handler=fn},
    fetch:async(url,options)=>{
      calls.push({url,options});
      if(url.endsWith('/auth/v1/user'))return json({id:'user-a'},authenticated?200:401);
      if(url.includes('/rest/v1/profiles?'))return json(company?[{id:'user-a',company_id:company,role,is_admin:role==='admin'}]:[]);
      if(url.includes('/connect/token'))return json({access_token:'private-upstream-token',expires_in:3600});
      return json({data:{AllSkogsmark:{arealHa:1,medel:url.endsWith('/Volym')?200:20}},metadata:{minDatum:'2022-01-01',maxDatum:'2022-06-01',omdrev:2,pixelstorlek:2}});
    }});
  vm.runInContext(code,context,{filename:'forest-data/index.ts'});
  return {calls,request:(body,headers={Authorization:'Bearer signed-in-session'},method='POST')=>handler(new Request('https://test/forest-data',{method,headers,body:method==='POST'?JSON.stringify(body):undefined}))};
}
const geometry={type:'Polygon',coordinates:[[[22,67],[22.001,67],[22.001,67.001],[22,67.001],[22,67]]]};
test('forest endpoint rejects anonymous or expired sessions and missing company profiles',async()=>{
  let h=harness();assert.equal((await h.request({operation:'status'},{})).status,401);assert.equal(h.calls.length,0);
  h=harness({authenticated:false});assert.equal((await h.request({operation:'status'})).status,401);
  h=harness({company:null});assert.equal((await h.request({operation:'status'})).status,403);
});
test('drivers can inspect connection status but cannot consume the inventory API',async()=>{
  const h=harness({role:'harvester',configured:true});assert.equal((await h.request({operation:'status'})).status,200);
  assert.equal((await h.request({operation:'inventory',geometry})).status,403);assert.ok(!h.calls.some(c=>c.url.includes('skogsstyrelsen')));
});
test('missing source credentials are reported explicitly without returning data or credentials',async()=>{
  const h=harness(),status=await(await h.request({operation:'status'})).json();assert.equal(status.configured,false);
  const r=await h.request({operation:'inventory',geometry});assert.equal(r.status,503);assert.equal((await r.json()).code,'SOURCE_NOT_CONFIGURED');
});
test('configured inventory transforms the polygon and maps four official v1.1 responses',async()=>{
  const h=harness({configured:true}),r=await h.request({operation:'inventory',geometry});assert.equal(r.status,200);const data=await r.json();
  assert.equal(data.inventory.volume_m3sk_ha,200);assert.equal(data.inventory.mean_height_m,20);assert.equal(data.inventory.scan_year,2022);
  const queries=h.calls.filter(c=>c.url.includes('/sksapi/'));assert.equal(queries.length,4);
  for(const c of queries){assert.match(c.url,/\/v1\.1\//);const p=JSON.parse(c.options.body);assert.match(p.geometri,/^POLYGON/);assert.deepEqual(p.marktyper,['AllSkogsmark']);assert.equal(c.options.headers.Authorization,'Bearer private-upstream-token');}
  const body=JSON.stringify(data);for(const secret of ['server-secret','server-id','private-upstream-token'])assert.ok(!body.includes(secret));
});
test('invalid or oversized geometry is rejected before any source request',async()=>{
  const h=harness({configured:true}),r=await h.request({operation:'inventory',geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]}});assert.equal(r.status,400);
  assert.ok(!h.calls.some(c=>c.url.includes('skogsstyrelsen')));
});
