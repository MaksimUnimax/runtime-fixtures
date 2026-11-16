// Execute the actual TypeScript BFF route with synthetic auth/upstream boundaries.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..'),out=path.resolve(process.argv[2]);
const dir=path.dirname(out),st=fs.lstatSync(dir);
if(path.dirname(dir)!=='/dev/shm'||!path.basename(dir).startsWith('alisa-r5-bound-period-')
 ||fs.realpathSync(dir)!==dir||!st.isDirectory()||st.uid!==process.getuid()||(st.mode&0o022)
 ||path.extname(out)!=='.json'||fs.existsSync(out))throw Error('OWNED_TEST_OUTPUT_REQUIRED');
const req=createRequire(path.join(root,'apps/web/package.json')),swc=req('next/dist/build/swc');
const checks=[],calls=[];let browserAllowed=true,authChecks=0;
async function compiled(file,imports={}){
 const code=(await swc.transform(fs.readFileSync(file,'utf8'),{filename:file,
  jsc:{parser:{syntax:'typescript'}},module:{type:'commonjs'},isModule:true})).code;
 const mod={exports:{}};
 vm.runInNewContext(code,{module:mod,exports:mod.exports,URL,Request,Response,
  process:{env:{ALISA_OWNER_DATA_ENABLED:'1',ALISA_OWNER_PARAMETERS_ENABLED:'1'}},
  require:name=>{if(Object.hasOwn(imports,name))return imports[name];throw Error('UNEXPECTED_IMPORT');}},
  {filename:file,timeout:3000});return mod.exports;
}
(async()=>{
 await swc.loadBindings();
 const strict=await compiled(path.join(root,'apps/web/src/server/strict-json.ts'));
 const route=await compiled(path.join(root,'apps/web/src/app/api/account/parameters/route.ts'),{
  '../../../../server/strict-json':strict,
  '../../../../server/auth':{authEnabled:()=>true,validBrowserRequest:()=>{authChecks++;return browserAllowed;},
   readCookie:()=> 'a'.repeat(43),SESSION_COOKIE:'synthetic',
   response:(body,status)=>({body,status}),boundedBody:async request=>request.text()},
  '../../../../server/parameters':{parameterApi:async(token,cmd)=>{calls.push(cmd);return{body:{ok:true},status:200};}},
 });
 const base={action:'start_calculation',store_id:'11111111-1111-4111-8111-111111111111',
  parameter:'loss_rate',scope:{kind:'store',sku:''},sku_reference:null,period:null,mode:'preview',
  command_id:'22222222-2222-4222-8222-222222222222',expected_revision:0,confirmed:true,not_after:1800000000};
 async function check(name,cmd,expected){
  const before=calls.length,prior=authChecks;
  const result=await route.POST(new Request('https://fixture.invalid/api/account/parameters',
   {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(cmd)}));
  if(result.status!==expected||authChecks!==prior+1
    ||calls.length!==before+(expected===200?1:0))throw Error(name);
  if(expected===200&&JSON.stringify(calls.at(-1))!==JSON.stringify(cmd))throw Error('BFF_CHANGED_COMMAND');
  checks.push(name);
 }
 await check('legacy_start_unchanged',base,200);
 await check('prepared_reference_forwarded',{...base,period_reference:'synthetic-signed-reference'},200);
 await check('reference_size_boundary',{...base,period_reference:'x'.repeat(4096)},200);
 for(const [name,value]of [['null',null],['empty',''],['object',{}],['array',[]],['number',1],['oversized','x'.repeat(4097)]]){
  await check('reject_'+name+'_reference',{...base,period_reference:value},422);
 }
 await check('reject_client_actual_period',{...base,actual:{from:'2026-08-01',to:'2026-10-31'}},422);
 await check('reject_reference_on_read',{action:'read',store_id:base.store_id,parameter:base.parameter,
  scope:base.scope,sku_reference:null,period_reference:'foreign'},422);
 browserAllowed=false;await check('origin_guard_still_applies',{...base,period_reference:'synthetic'},403);
 const result={status:'PASS',checks,scope:'actual BFF route and strict JSON; synthetic auth/upstream, no DB/provider'};
 fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});process.stdout.write(JSON.stringify(result)+'\n');
})().catch(e=>{process.stderr.write(String(e)+'\n');process.exitCode=1;});
