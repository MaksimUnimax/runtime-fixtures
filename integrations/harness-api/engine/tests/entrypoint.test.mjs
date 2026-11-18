import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { harnessRequire } from '../runtime.mjs';

let available=true;
try { harnessRequire().resolve('@deepseek-ai/dsh/package.json'); } catch { available=false; }

async function bounded(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([promise,new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error(message)),milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

test('real Harness entrypoint starts through current symlink and stops cleanly', {skip:!available,timeout:15000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'octoport-harness-entrypoint-'));
  // Spaces also exercise correct file-URL decoding rather than URL.pathname.
  const release=path.join(root,'release with spaces'),engine=path.join(release,'engine');
  fs.mkdirSync(engine,{recursive:true});
  const source=fileURLToPath(new URL('../',import.meta.url));
  for(const name of fs.readdirSync(source)) if(name.endsWith('.mjs')) fs.copyFileSync(path.join(source,name),path.join(engine,name));
  fs.symlinkSync(release,path.join(root,'current'),'dir');
  const credentials=path.join(root,'credentials');
  fs.mkdirSync(credentials,{mode:0o700});
  const bridge='fixture-service-key-never-used-in-production';
  const deepseek='sk-fixture-no-provider-inference-is-permitted';
  fs.writeFileSync(path.join(credentials,'bridge.key'),bridge,{mode:0o600});
  fs.writeFileSync(path.join(credentials,'deepseek.key'),deepseek,{mode:0o600});
  const guard=path.join(root,'network-guard.mjs');
  fs.writeFileSync(guard,"globalThis.fetch=async()=>{throw new Error('NETWORK_DISABLED_IN_ENTRYPOINT_TEST');};\n");
  let output='',errors='',exited=false,readyResolve;
  const ready=new Promise(resolve=>{readyResolve=resolve;});
  const child=spawn(process.execPath,['--import',pathToFileURL(guard).href,path.join(root,'current/engine/server.mjs')],{
    cwd:root,stdio:['ignore','pipe','pipe'],env:{...process.env,
      CREDENTIALS_DIRECTORY:credentials,
      OCTOPORT_BRIDGE_KEY_FILE:path.join(root,'missing-bridge-fallback'),
      DEEPSEEK_KEY_FILE:path.join(root,'missing-deepseek-fallback'),
      OCTOPORT_ENGINE_STATE:path.join(root,'state'),
      OCTOPORT_ENGINE_PORT:'0',
      OCTOPORT_PIPELINE_URL:'http://127.0.0.1:1/internal/harness/query',
    },
  });
  const closed=new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('exit',(code,signal)=>{exited=true;resolve({code,signal});});
  });
  t.after(async()=>{
    if(!exited){
      child.kill('SIGTERM');
      try { await bounded(closed,3000,'entrypoint cleanup timeout'); }
      catch { child.kill('SIGKILL');await bounded(closed,3000,'entrypoint did not terminate'); }
    }
    fs.rmSync(root,{recursive:true,force:true});
  });
  child.stdout.on('data',chunk=>{
    output+=chunk;
    for(const line of output.split('\n')){
      try { const value=JSON.parse(line);if(value.event==='harness_engine_ready')readyResolve(value); }
      catch { /* Other diagnostics are not readiness. */ }
    }
  });
  child.stderr.on('data',chunk=>{errors+=chunk;});
  const started=await bounded(Promise.race([ready,closed.then(value=>{
    throw new Error(`entrypoint exited before listen: ${JSON.stringify(value)} ${errors}`);
  })]),10000,'entrypoint never listened');
  assert.ok(Number.isInteger(started.port)&&started.port>0);
  assert.equal(started.harness_version,'0.2.2-rc.1');
  const response=await fetch(`http://127.0.0.1:${started.port}/health`,{signal:AbortSignal.timeout(3000)});
  assert.equal(response.status,200);
  const health=await response.json();
  assert.equal(health.ok,true);
  assert.equal(health.provider,'octoport-templates');
  assert.equal(health.default_api_key_configured,true);
  assert.equal(JSON.stringify(health).includes(deepseek),false);
  child.kill('SIGTERM');
  assert.deepEqual(await bounded(closed,3000,'entrypoint shutdown timeout'),{code:0,signal:null});
  assert.equal((output+errors).includes(bridge),false);
  assert.equal((output+errors).includes(deepseek),false);
});
