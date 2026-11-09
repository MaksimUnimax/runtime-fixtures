import assert from 'node:assert/strict';
import {boundary, platform} from '../../apps/web/src/server/engineering.ts';

const origin='https://alisa-stage.example.invalid';
const basic=Buffer.from('engineer:synthetic-test-only').toString('base64');
Object.assign(process.env,{ALISA_ENV:'stage',FOUNDATION_PROBE_ENABLED:'1',ALISA_WEB_ORIGIN:origin,ALISA_ENGINEERING_AUTH:basic});
function request(overrides={}) {
  return new Request('http://localhost:18100/api/engineering/probes', {
    method:'POST',headers:{host:'alisa-stage.example.invalid',origin,authorization:`Basic ${basic}`,...overrides},
  });
}
assert.equal(boundary(request(),true),null,'Ingress Host must work despite Next internal origin');
assert.equal(boundary(request({host:'foreign.invalid'}),true)?.status,403);
assert.equal(boundary(request({'x-forwarded-host':'alisa-stage.example.invalid',host:'foreign.invalid'}),true)?.status,403);
assert.equal(boundary(request({origin:'https://foreign.invalid'}),true)?.status,403);
assert.equal(boundary(request({authorization:'Basic forged'}),true)?.status,401);
process.env.ALISA_ENV='prod';
assert.equal(boundary(request(),true)?.status,404);
const originalFetch=globalThis.fetch, originalInfo=console.info;
const audit=[];
const probe='710ed1a4-2fde-44a1-a607-93d26d64c5a5', correlation='6ce7dfed-c71f-4b06-9110-af31e6355e12';
try {
  Object.assign(process.env,{ALISA_ENV:'stage',ALISA_SERVICE_TOKEN:'synthetic-service-token-only-'.repeat(2),ALISA_PLATFORM_URL:'http://127.0.0.1:18102'});
  console.info=(message)=>audit.push(message);
  globalThis.fetch=async()=>Response.json({probe_id:probe,correlation_id:correlation,state:'ACCEPTED',secret:'private-upstream-marker'},{status:202});
  const response=await platform('/internal/foundation/probes','POST',{probe_id:probe,kind:'foundation-v1'});
  assert.equal(response.status,202);
  assert.deepEqual(audit.map(x=>JSON.parse(x)),[{event:'foundation_bff_accepted',probe_id:probe,correlation_id:correlation}]);
  assert.equal('secret' in await response.json(),false);
  globalThis.fetch=async()=>Response.json({probe_id:'private-invalid-id-marker',correlation_id:correlation},{status:202});
  await platform('/internal/foundation/probes','POST',{});
  assert.equal(audit.length,1,'Unvalidated upstream IDs must not reach logs');
  globalThis.fetch=async()=>Response.json({probe_id:probe,correlation_id:correlation},{status:503});
  await platform('/internal/foundation/probes','POST',{});
  assert.equal(audit.length,1,'Failed requests must not emit acceptance');
} finally {globalThis.fetch=originalFetch;console.info=originalInfo;}
console.log('ENGINEERING_HOST_ORIGIN_AUTH_BOUNDARIES_PASS');
