import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {collectDocumentation, checkDocumentation} from './docs-check.mjs';

function fixture(t, markdown) {
  const root=mkdtempSync(join(tmpdir(),'alisa-doc-links-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  writeFileSync(join(root,'README.md'),markdown);
  return root;
}
function errors(root) {
  const {files,repositoryPaths}=collectDocumentation(root);
  return checkDocumentation(files,repositoryPaths).errors;
}
const broken=(root)=>errors(root).filter(e=>e.startsWith('Broken relative link:'));

test('existing Python, patch and binary Word targets are indexed without reading binary content',t=>{
  const root=fixture(t,'[script](run.py) [patch](change.patch) [Word](guide.docx)\n');
  writeFileSync(join(root,'run.py'),'print("fixture")\n');
  writeFileSync(join(root,'change.patch'),'diff --git fixture\n');
  writeFileSync(join(root,'guide.docx'),Buffer.from([0x50,0x4b,0xff,0x00]));
  assert.deepEqual(broken(root),[]);
  assert.equal('guide.docx' in collectDocumentation(root).files,false);
});
test('missing targets remain errors for every extension',t=>{
  const root=fixture(t,'[script](absent.py) [patch](absent.patch) [Word](absent.docx)\n');
  assert.equal(broken(root).length,3);
});
test('directories containing only non-documentation assets are valid link targets',t=>{
  const root=fixture(t,'[assets](assets/)\n');
  mkdirSync(join(root,'assets'));writeFileSync(join(root,'assets','binary.png'),Buffer.from([0xff]));
  assert.deepEqual(broken(root),[]);
});
test('ignored dependency trees and symlinks do not satisfy repository links',t=>{
  const root=fixture(t,'[dependency](node_modules/private.py) [Python environment](.venv/private.py) [link](linked.py)\n');
  mkdirSync(join(root,'node_modules'));writeFileSync(join(root,'node_modules','private.py'),'fixture');
  mkdirSync(join(root,'.venv'));writeFileSync(join(root,'.venv','private.py'),'fixture');
  symlinkSync(join(root,'node_modules','private.py'),join(root,'linked.py'));
  assert.equal(broken(root).length,3);
});
test('strict newline and required-document checks still fail',t=>{
  const root=fixture(t,'missing final newline');
  assert.ok(errors(root).includes('Missing final newline: README.md'));
  assert.ok(errors(root).includes('Missing required file: AGENTS.md'));
});
test('explicitly tracked documents inside generated Python trees remain checked',t=>{
  const root=fixture(t,'[tracked](.venv/README.md) [cache](__pycache__/README.md) [untracked](.venv/private.py)\n');
  execFileSync('git',['init','-q',root]);
  writeFileSync(join(root,'.gitignore'),'.venv/\n__pycache__/\n');
  for(const dir of ['.venv','__pycache__']) {
    mkdirSync(join(root,dir));writeFileSync(join(root,dir,'README.md'),'missing final newline');
    execFileSync('git',['-C',root,'add','-f','--',dir+'/README.md']);
  }
  writeFileSync(join(root,'.venv','private.py'),'fixture');
  assert.equal(broken(root).length,1);
  assert.ok(errors(root).includes('Missing final newline: .venv/README.md'));
  assert.ok(errors(root).includes('Missing final newline: __pycache__/README.md'));
});
