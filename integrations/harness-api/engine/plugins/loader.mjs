import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { assertManifest } from '../plugin-contract.mjs';
import { PipelineError } from '../provider.mjs';

/** Only an operator-installed directory is read. Chat input never becomes code. */
export async function loadInstalledPlugins({directory,mount,manager,execute}){
  const root=fs.realpathSync(directory);
  if(fs.statSync(root).mode&0o022)throw new Error('Installed plugin directory must not be writable by group or others');
  for(const entry of fs.readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    if(entry.name.startsWith('.'))continue;
    if(!entry.isDirectory()||!/^[a-z][a-z0-9-]{0,63}$/.test(entry.name))throw new Error('Unexpected installed plugin entry');
    const folder=path.join(root,entry.name),manifestFile=path.join(folder,'manifest.json');
    for(const file of [folder,manifestFile]){
      const stat=fs.lstatSync(file);
      if(stat.isSymbolicLink()||(stat.mode&0o022))throw new Error('Installed plugins must not be writable by group or others');
    }
    const manifest=assertManifest(JSON.parse(fs.readFileSync(manifestFile,'utf8')));
    if(manifest.id!==entry.name)throw new Error('Plugin directory and manifest ID differ');
    const moduleFile=path.join(folder,manifest.entry),stat=fs.lstatSync(moduleFile);
    if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o022)||!fs.realpathSync(moduleFile).startsWith(root+path.sep))throw new Error('Invalid installed plugin module path');
    if(crypto.createHash('sha256').update(fs.readFileSync(moduleFile)).digest('hex')!==manifest.sha256)throw new Error('Installed plugin module hash mismatch');
    const module=await import(pathToFileURL(moduleFile).href);
    await mount(module.default,{manifest,execute,PipelineError});
    if(!manager.records.has(manifest.id))throw new Error('Installed plugin did not register its manifest');
  }
}
