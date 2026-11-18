import { PipelineError } from './provider.mjs';
import { owner } from './state.mjs';

export const PLUGIN_API = 'octoport.harness-plugin/v1';
export const HARNESS_VERSION = '0.2.2-rc.1';
export const ZERO_USAGE = Object.freeze({prompt_tokens:0,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:0,completion_tokens:0});

export function pluginScope(input, chatId) {
  const scope=owner(input);
  const capabilities=input.capabilities??[];
  if(!Array.isArray(capabilities)||capabilities.length>32||capabilities.some(value=>typeof value!=='string'||!/^[a-z][a-z0-9_:.-]{0,79}$/.test(value))) {
    throw new PipelineError('INVALID_CAPABILITIES','Некорректные права запроса.');
  }
  return Object.freeze({...scope,capabilities:Object.freeze([...new Set(capabilities)]),...(chatId?{session_id:chatId}:{})});
}

export const normalizeName=value=>String(value).normalize('NFKC').toLowerCase().replace(/ё/g,'е').trim().replace(/\s+/g,' ');

export function pluginAllowed(manifest, scope) {
  return !manifest.capability||scope.capabilities?.includes(manifest.capability)===true;
}

export function publicMetadata(metadata) {
  const result={};
  for(const key of ['state','result_expires_at','clarification','template_ids','catalog_hash','plugin_control']) {
    if(metadata?.[key]!==undefined) result[key]=structuredClone(metadata[key]);
  }
  return result;
}

export function assertManifest(value) {
  const fail=()=>{throw new Error('Invalid installed Harness plugin manifest');};
  if(!value||typeof value!=='object'||Array.isArray(value)||value.api_version!==PLUGIN_API||value.harness_version!==HARNESS_VERSION)fail();
  if(typeof value.id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(value.id)||value.id==='plugin-manager')fail();
  for(const key of ['name','description','version'])if(typeof value[key]!=='string'||!value[key]||value[key].length>600)fail();
  if(typeof value.default_enabled!=='boolean'||typeof value.required!=='boolean'||!Number.isInteger(value.priority)||value.priority<0||value.priority>10000)fail();
  if(value.capability!==null&&(typeof value.capability!=='string'||!/^[a-z][a-z0-9_:.-]{0,79}$/.test(value.capability)))fail();
  if(typeof value.entry!=='string'||!/^[A-Za-z0-9_.-]+\.mjs$/.test(value.entry)||! /^[a-f0-9]{64}$/.test(value.sha256))fail();
  if(!Array.isArray(value.aliases)||value.aliases.length>30||value.aliases.some(x=>typeof x!=='string'||!x.trim()||x.length>100))fail();
  if(!value.actions||typeof value.actions!=='object'||Array.isArray(value.actions)||Object.keys(value.actions).length>30)fail();
  for(const [action,info]of Object.entries(value.actions)){
    if(!/^[a-z][a-z0-9_-]{0,47}$/.test(action)||!info||typeof info!=='object'||typeof info.title!=='string'||!Array.isArray(info.aliases)||info.aliases.length>30||info.aliases.some(x=>typeof x!=='string'||!x.trim()||x.length>120))fail();
  }
  return Object.freeze(structuredClone(value));
}
