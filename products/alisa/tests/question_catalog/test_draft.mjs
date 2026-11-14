import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../apps/web/package.json',import.meta.url));
const folder=mkdtempSync(join(tmpdir(),'alisa-catalog-draft-'));
try{
  const compiler=join(dirname(require.resolve('typescript/package.json')),'bin','tsc');
  const source=fileURLToPath(new URL('../../apps/web/src/app/app/queries/catalog-draft.ts',import.meta.url));
  execFileSync(compiler,[source,'--module','commonjs','--target','ES2022','--skipLibCheck','--outDir',folder],
    {cwd:folder,env:{...process.env,PATH:dirname(process.execPath)+':'+process.env.PATH},timeout:30000});
  const choose=require(join(folder,'catalog-draft.js')).initialQueryStores;
  const stores=[{id:'A',name:'Первый',provider:'OZON'},{id:'B',name:'Второй',provider:'OZON'}];
  assert.deepEqual(choose(stores,'B'),['B']);
  assert.deepEqual(choose(stores,'not-on-this-page'),[]);
  assert.deepEqual(choose(stores,'invalid'),[]);
  assert.deepEqual(choose(stores,''),['A']);
  assert.deepEqual(choose([],''),[]);
  assert.equal(stores.length,2);
  console.log('PASS 6 catalogue draft selection checks');
}finally{rmSync(folder,{recursive:true,force:true});}
