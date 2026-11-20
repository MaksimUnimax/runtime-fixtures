import crypto from 'node:crypto';
import { PipelineError } from '../provider.mjs';
import { ZERO_USAGE, normalizeName, pluginAllowed, publicMetadata } from '../plugin-contract.mjs';

const MANAGER=Object.freeze({id:'plugin-manager',name:'Менеджер плагинов',description:'Список и включение установленных плагинов для аккаунта или диалога.',version:'1.0.0',required:true,default_enabled:true,capability:null,priority:0,aliases:[],actions:{}});
const HELP='Команды: «плагины», «включи плагин <название>», «отключи плагин <название>», /plugins enable <id>, /plugins disable <id>. Настройка аккаунта: /plugins account enable <id>. Действие плагина: /plugin <id> <action> [JSON]. Установка нового кода доступна администратору сервера.';
const unavailable=()=>new PipelineError('PLUGIN_UNAVAILABLE','Плагин не найден или недоступен.',403);
const ownerKey=scope=>crypto.createHash('sha256').update(JSON.stringify([scope.actor_id,scope.tenant_id])).digest('hex');

/** A real Cordis Service. Installed modules register reversible effects here. */
export function managerPluginClass(Service) {
  return class ScopedPluginManager extends Service {
    static provide='octoportPlugins';
    constructor(ctx,config){
      super(ctx,'octoportPlugins');
      this.store=config.store;
      this.readJobs=config.readJobs;
      this.records=new Map([['plugin-manager',{manifest:MANAGER,extension:{}}]]);
    }

    register(ctx,manifest,extension){
      if(this.records.has(manifest.id))throw new Error('Duplicate installed plugin ID');
      if(!extension||typeof extension!=='object')throw new Error('Invalid plugin registration');
      for(const action of Object.keys(manifest.actions))if(typeof extension.actions?.[action]!=='function')throw new Error('Missing declared plugin action');
      return ctx.effect(()=>{
        this.records.set(manifest.id,{manifest,extension});
        return()=>this.records.delete(manifest.id);
      },`octoportPlugins.register(${manifest.id})`);
    }

    settings(scope){
      return this.store.data.plugin_preferences?.[ownerKey(scope)]??{account:{},chats:{}};
    }

    selection(manifest,scope){
      if(manifest.required)return{enabled:true,setting_source:'required'};
      if(scope.feature_snapshot&&Object.hasOwn(scope.feature_snapshot.enabled,manifest.id))return{enabled:scope.feature_snapshot.enabled[manifest.id],setting_source:'request_snapshot'};
      const saved=this.settings(scope),chat=saved.chats?.[scope.session_id];
      if(chat&&Object.hasOwn(chat,manifest.id))return{enabled:chat[manifest.id],setting_source:'chat'};
      if(Object.hasOwn(saved.account??{},manifest.id))return{enabled:saved.account[manifest.id],setting_source:'account'};
      return{enabled:manifest.default_enabled,setting_source:'default'};
    }

    snapshot(scope){
      return Object.freeze({revision:this.settings(scope).revision??0,enabled:Object.freeze(Object.fromEntries(
        [...this.records.values()].map(({manifest})=>[manifest.id,pluginAllowed(manifest,scope)&&this.selection(manifest,scope).enabled])))});
    }

    intent(scope,text){
      const command=this.parse(text),capabilities=new Set();
      if(command?.kind==='plugin'){
        const capability=this.records.get(command.id)?.manifest.capability;
        if(capability)capabilities.add(capability);
      }else if(!command){
        for(const {manifest,extension}of this.records.values())if(manifest.capability&&pluginAllowed(manifest,scope)&&this.selection(manifest,scope).enabled&&typeof extension.process==='function')capabilities.add(manifest.capability);
      }
      return{version:1,required_capabilities:[...capabilities]};
    }

    permitted(id,scope,enabled=false){
      const record=this.records.get(id);
      if(!record||!pluginAllowed(record.manifest,scope)||(enabled&&!this.selection(record.manifest,scope).enabled))throw unavailable();
      return record;
    }

    list(scope){
      return{scope:scope.session_id?'chat':'account',...(scope.session_id?{chat_id:scope.session_id}:{}),plugins:[...this.records.values()]
        .filter(({manifest})=>pluginAllowed(manifest,scope)).sort((a,b)=>a.manifest.priority-b.manifest.priority||a.manifest.id.localeCompare(b.manifest.id))
        .map(({manifest})=>({id:manifest.id,name:manifest.name,description:manifest.description,version:manifest.version,required:manifest.required,
          default_enabled:manifest.default_enabled,...this.selection(manifest,scope),actions:Object.entries(manifest.actions).map(([id,value])=>({id,title:value.title}))}))};
    }

    set(scope,id,enabled,target){
      const {manifest}=this.permitted(id,scope);
      if(typeof enabled!=='boolean'||!['chat','account'].includes(target)||(target==='chat'&&!scope.session_id))throw new PipelineError('INVALID_PLUGIN_SETTING','Укажите плагин, состояние и область настройки.');
      if(manifest.required&&!enabled)throw new PipelineError('PLUGIN_REQUIRED','Менеджер плагинов всегда включён.',409);
      if(!manifest.required){
        const values=this.store.data.plugin_preferences??={};
        const saved=values[ownerKey(scope)]??={account:{},chats:{},revision:0};
        const dest=target==='account'?saved.account:(saved.chats[scope.session_id]??={});
        dest[id]=enabled;
        saved.revision=(saved.revision??0)+1;
        this.store.save();
      }
      return{ok:true,...this.list({...scope,feature_snapshot:undefined,...(target==='account'?{session_id:undefined}:{})})};
    }

    resolveName(name){
      const wanted=normalizeName(name);
      const ids=[...this.records.values()].filter(({manifest})=>[manifest.id,manifest.name,...manifest.aliases].some(alias=>normalizeName(alias)===wanted)).map(x=>x.manifest.id);
      return ids.length===1?ids[0]:null;
    }

    parse(text){
      const value=String(text).trim(),normalized=normalizeName(value);
      if(['плагины','покажи плагины','список плагинов'].includes(normalized))return{kind:'manager',operation:'list'};
      if(/^\/plugins(?:\s|$)/i.test(value)){
        const matched=value.match(/^\/plugins(?:\s+(account|chat))?(?:\s+(list|enable|disable|help)(?:\s+(.+))?)?$/i);
        if(!matched)return{kind:'manager',operation:'help'};
        const operation=(matched[2]??'list').toLowerCase();
        return{kind:'manager',operation,target:matched[1]?.toLowerCase()??'chat',id:matched[3]?this.resolveName(matched[3]):null};
      }
      const natural=value.match(/^(включи|отключи|выключи)(?:\s+плагин)?\s+(.+)$/iu);
      if(natural)return{kind:'manager',operation:normalizeName(natural[1])==='включи'?'enable':'disable',target:'chat',id:this.resolveName(natural[2])};
      if(/^\/plugin(?:\s|$)/i.test(value)){
        const matched=value.match(/^\/plugin\s+([a-z][a-z0-9-]*)\s+([a-z][a-z0-9_-]*)(?:\s+([\s\S]+))?$/i);
        if(!matched)return{kind:'manager',operation:'help'};
        let args={};
        try{args=matched[3]?JSON.parse(matched[3]):{};}catch{return{kind:'manager',operation:'help'};}
        if(!args||typeof args!=='object'||Array.isArray(args))return{kind:'manager',operation:'help'};
        return{kind:'plugin',id:matched[1].toLowerCase(),action:matched[2].toLowerCase(),args};
      }
      const matches=[];
      for(const {manifest}of this.records.values())for(const [action,info]of Object.entries(manifest.actions)){
        if(info.aliases.some(alias=>normalizeName(alias)===normalized))matches.push({kind:'plugin',id:manifest.id,action,args:{}});
      }
      if(matches.length===1)return matches[0];
      if(matches.length>1)return{kind:'manager',operation:'help'};
      return null;
    }

    result(manifest,result,local=false){
      if(!result||typeof result.text!=='string'||!result.text.trim())throw new PipelineError('PLUGIN_EMPTY_RESULT','Плагин не вернул ответ.',502);
      return{...result,...(local?{usage:{...ZERO_USAGE}}:{}),metadata:{...result.metadata,
        plugin:{id:manifest.id,version:manifest.version,capability:manifest.capability},...(local?{plugin_control:true,local_only:true}:{})}};
    }

    async action(scope,id,action,args){
      const {manifest,extension}=this.permitted(id,scope,true);
      if(!Object.hasOwn(manifest.actions,action)||typeof extension.actions?.[action]!=='function')throw new PipelineError('PLUGIN_ACTION_UNAVAILABLE','Действие плагина не найдено.',404);
      if(!args||typeof args!=='object'||Array.isArray(args)||JSON.stringify(args).length>10000)throw new PipelineError('INVALID_PLUGIN_ARGUMENTS','Некорректные аргументы плагина.');
      return this.result(manifest,await extension.actions[action]({scope,args:structuredClone(args),readJobs:()=>this.readJobs(scope)}));
    }

    async call(scope,id,action,args){
      const result=await this.action(scope,id,action,args??{});
      return result.data??{text:result.text};
    }

    async execute(scope,text,signal){
      const command=this.parse(text);
      if(command){
        try{
          if(command.kind==='plugin')return await this.action(scope,command.id,command.action,command.args);
          const targetScope=command.target==='account'?{...scope,session_id:undefined}:scope;
          if(command.operation==='list'){
            const list=this.list(targetScope);
            return this.result(MANAGER,{text:list.plugins.map(p=>`${p.enabled?'Включён':'Выключен'}: ${p.name} (${p.id})${p.required?' — всегда включён':''}.`).join('\n')+'\n\n'+HELP,data:list},true);
          }
          if(['enable','disable'].includes(command.operation)&&command.id){
            const manifest=this.permitted(command.id,scope).manifest;
            const enabled=command.operation==='enable';
            this.set(scope,command.id,enabled,command.target??'chat');
            return this.result(MANAGER,{text:`${manifest.name}: ${enabled?'включён':'выключен'} ${command.target==='account'?'для аккаунта (диалоги с собственной настройкой сохраняют её)':'в этом диалоге'}.`},true);
          }
          return this.result(MANAGER,{text:(command.operation==='help'?'':'Плагин не найден или название неоднозначно. ')+HELP},true);
        }catch(error){
          if(!(error instanceof PipelineError))throw error;
          return this.result(MANAGER,{text:error.message+'\n\n'+HELP},true);
        }
      }
      for(const {manifest,extension}of [...this.records.values()].sort((a,b)=>a.manifest.priority-b.manifest.priority||a.manifest.id.localeCompare(b.manifest.id))){
        if(!pluginAllowed(manifest,scope)||!this.selection(manifest,scope).enabled||typeof extension.process!=='function')continue;
        signal?.throwIfAborted();
        const result=await extension.process({scope,text,signal});
        if(result!==null&&result!==undefined)return this.result(manifest,result);
      }
      return this.result(MANAGER,{text:'Для этого сообщения не включён обработчик. Напишите «плагины» и включите нужный плагин.'},true);
    }

    project(scope,result){
      if(!result)return{text:null,presentation:null,metadata:{},usage:null};
      const execution=result.metadata?.plugin;
      if(execution?.capability&&!scope.capabilities?.includes(execution.capability))return{text:'Ответ плагина доступен только авторизованному разработчику.',presentation:null,metadata:{},usage:null};
      const projected={text:result.text??null,presentation:result.presentation?structuredClone(result.presentation):null,metadata:publicMetadata(result.metadata),usage:null};
      for(const {manifest,extension}of this.records.values()){
        if(!pluginAllowed(manifest,scope)||!this.selection(manifest,scope).enabled||typeof extension.project!=='function')continue;
        extension.project({scope,result,projected});
      }
      return projected;
    }
  };
}
