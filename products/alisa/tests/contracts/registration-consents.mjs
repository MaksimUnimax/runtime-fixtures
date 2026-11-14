import assert from 'node:assert/strict';
import {registrationConsents} from '../../apps/web/src/server/registration-consents.ts';
const receipt={version:'identity-s02-open-1',accepted_at:'2026-01-01T12:34:56.123456+00:00'};
const pair={service:{...receipt},privacy:{...receipt}};
assert.equal(registrationConsents(undefined),undefined);
assert.deepEqual(registrationConsents({}),{});
assert.deepEqual(registrationConsents(pair),pair);
for(const value of [null,true,[],{service:receipt},{privacy:receipt},{...pair,marketing:receipt},
 {...pair,service:{...receipt,accepted:true}},{...pair,service:{...receipt,version:'invented'}},
 {...pair,service:{...receipt,version:['identity-s02-open-1']}},
 {...pair,service:{...receipt,accepted_at:'tomorrow'}},{...pair,service:{...receipt,accepted_at:'2026-01-01T12:00:00'}},
 {...pair,service:{...receipt,accepted_at:'2099-01-01T00:00:00+00:00'}},
 {...pair,service:{...receipt,accepted_at:'1999-01-01T00:00:00+00:00'}}]){
 assert.throws(()=>registrationConsents(value));
}
console.log('Signed registration consent boundary PASS');
