import assert from 'node:assert/strict';
import {boundary} from '../../apps/web/src/server/engineering.ts';

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
console.log('ENGINEERING_HOST_ORIGIN_AUTH_BOUNDARIES_PASS');
