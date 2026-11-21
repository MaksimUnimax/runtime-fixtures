import assert from 'node:assert/strict';
import {SESSION_COOKIE,SESSION_MAX_AGE_SECONDS,cookie} from '../../apps/web/src/server/session-cookie.ts';
let count=0;function c(fn){fn();count++;}
const value=cookie(SESSION_COOKIE,'SYNTHETIC_SESSION',SESSION_MAX_AGE_SECONDS);
c(()=>assert.equal(SESSION_MAX_AGE_SECONDS,2592000));
c(()=>assert.equal(SESSION_COOKIE,'__Host-alisa_session'));
for(const token of ['Path=/','HttpOnly','Secure','SameSite=Lax','Max-Age=2592000'])c(()=>assert.ok(value.includes(token)));
c(()=>assert.equal(value.includes('Domain='),false));
c(()=>assert.ok(cookie(SESSION_COOKIE,'',0).includes('Max-Age=0')));
c(()=>assert.ok(cookie('__Host-alisa_login','FLOW',600).includes('Max-Age=600')));
console.log(JSON.stringify({status:'PASS',tests:count,synthetic_cookie:value}));
