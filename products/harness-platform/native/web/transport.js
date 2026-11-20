// The native client talks to the product's cookie-bound routes. No Host RPC is published.
async function api(path, options) {
  const res = await fetch(path, {credentials:'same-origin', cache:'no-store', ...options});
  if (!res.ok) {
    if (res.status === 401 && !document.body.dataset.panel) location.replace('/login');
    const detail = await res.json().catch(() => ({}));
    const reason = {
      400: 'Проверьте введённые данные', 401: 'Требуется вход', 402: 'Недостаточно монет',
      403: 'Доступ запрещён', 404: detail.error === 'unavailable' ? 'Действие недоступно' : 'Чат недоступен',
      409: 'Запрос требует сверки', 413: 'Сообщение слишком длинное',
    };
    const error = new Error(reason[res.status] ?? 'Запрос не выполнен (' + res.status + ')');
    error.status = res.status;
    throw error;
  }
  return res.json();
}
const workspace = 'personal';
const label = id => 'Чат · ' + id.slice(-8);
function authorized(ids, guest) {
  const actions = ['session/list', 'session/follow', 'session/page', 'session/prompt', 'session/projections'];
  if (!guest) actions.push('session/create');
  return {type:'baseline', owner:false, grants:[
    {resource:{kind:'global'}, actions},
    {resource:{kind:'workspace', id:workspace}, actions},
    ...ids.map(id => ({resource:{kind:'session',id}, actions}))
  ]};
}
function guestWire(turn, index) {
  const time = turn.at, n = index + 1, step = {turn:n, step:1};
  const msg = (role, text) => ({id:turn.requestId + role, role,
    source:role==='user' ? {kind:'user',rpcId:turn.requestId} : {kind:'model', provider:'harness', model:'help'},
    content:[{type:'text',text}]});
  return [
    ['turn/start',{turn:n}], ['step/start',step], ['user/message',msg('user',turn.text)],
    ['assistant/message',{...step, message:msg('assistant',turn.answer),stream:[]}],
    ['step/end',step], ['turn/end',{turn:n,reason:{kind:'completed'}}]
  ].map(([type,data], ordinal) => ({seq:index*6+ordinal,time,type,data,
    ...(type.endsWith('/message') ? {surfaceOp:'append'} : {})}));
}
// Each consumer gets its own cursor. Register before yielding the opening view so
// a committed turn cannot fall between the snapshot and the next notification.
class Changes {
  listeners = new Set();
  next(signal) {
    let finish;
    const promise = new Promise(resolve => { finish = () => { this.listeners.delete(finish);
      signal.removeEventListener('abort',finish); resolve(); }; });
    this.listeners.add(finish);
    signal.addEventListener('abort',finish,{once:true});
    if (signal.aborted) finish();
    return promise;
  }
  notify() { for (const finish of [...this.listeners]) finish(); }
}
export async function createTransport(data) {
  const guest = data.mode === 'guest';
  const ids = guest ? (data.chat ? [data.chat] : []) : await api('/api/chats');
  const selected = data.chat || ids.at(-1);
  const changes = new Changes();
  const cuts = new Map();
  const running = new Set();
  const pending = new Map();
  const nonempty = new Set(ids.filter(id=>id!==selected));
  const opening = new Map();
  const titles = new Map(), updated = new Map();
  const openedAt = Date.now();
  const account = {guest, selected, panel:data.panel, error:data.error, recovery:data.recovery,
    wallet:guest ? null : await api('/api/wallet'), api, changes, costs:new Map()};
  const access = () => authorized(ids, guest);
  const view = () => ({items:[{workspaceId:workspace, path:'/personal', title:guest?'Справка Harness':'Мои чаты',
    sessionIds:[...ids], createdAt:'1970-01-01T00:00:00Z', updatedAt:'1970-01-01T00:00:00Z'}],
    archivedSessionIds:[], pinnedSessionIds:[]});
  const projection = (id,seq=-1) => ({asOfSeq:seq, values:{title:titles.get(id) ?? (guest?'Справка Harness':label(id)), cwd:'/personal'}});
  const failure = (message) => ({ok:false,error:{code:'gateway/method-unavailable',message,details:{}}});
  function check(id) { if (!ids.includes(id)) throw new Error('Чат недоступен'); }
  async function page(id, before, signal) {
    check(id);
    const path = (guest?'/guest':'/api') + '/chats/' + encodeURIComponent(id) + '/events';
    const result = await api(path + (before==null?'':'?before=' + encodeURIComponent(before)), {signal});
    const events = guest ? result.turns.flatMap((t,i) => guestWire(t,result.offset+i)) : result.events;
    const records = [];
    const visibleUsers = guest ? [] : result.messages.filter(msg => msg.role === 'user');
    const assistants=guest ? [] : result.messages.filter(msg=>msg.role==='assistant');
    let userIndex = 0, assistantIndex = 0;
    for (const event of events) {
      for (let seq=(records.at(-1)?.event.seq ?? event.seq-1)+1;seq<event.seq;seq++)
        records.push({type:'event',event:{seq,type:'harness/omitted',time:event.time,data:{},ignorable:true}});
      if (event.type==='assistant/message') {
        const cost=assistants[assistantIndex++]?.modelCost;
        if(result.adminCosts && cost) account.costs.set(id+'|'+event.seq,cost);
        event.data.stream ??= [];
        // The public journal strips model routing and usage. Native Chat accepts an empty route.
        event.data.message.source = {kind:'model',provider:'',model:''};
      }
      if (!guest && event.type==='user/message') {
        const message=visibleUsers[userIndex++];
        if (message) event.data.source = {...event.data.source,rpcId:message.requestId};
      }
      records.push({type:'event',event});
    }
    if (records.length) {
      nonempty.add(id);
      const last = records.at(-1).event.time;
      updated.set(id,Math.max(updated.get(id) ?? 0,last));
    }
    const first = records[0]?.event.seq;
    if (result.nextBefore!=null && first!=null) cuts.set(id+'|'+(first-1),result.nextBefore);
    const firstUser=events.find(e => e.type==='user/message');
    if (!guest && result.nextBefore==null && firstUser) titles.set(id,firstUser.data.content[0].text.slice(0,64));
    return {records,hasMore:result.nextBefore!=null};
  }
  if (selected) opening.set(selected,await page(selected,null));
  const params = payload => payload.args.request ?? payload.args.input ?? payload.args;
  function summary(id) { return {agentAvailable:true,sessionId:id,updatedAt:updated.get(id) ?? openedAt,running:running.has(id),
    blank:!nonempty.has(id),cwd:'/personal',projections:{kind:'cached',...projection(id)}}; }
  async function call(channel, endpoint, payload, signal) {
    if (channel !== '/api') return failure('Действие недоступно');
    const p=params(payload);
    try {
      let value;
      switch(endpoint) {
        case 'session/list': value={items:ids.map(summary)}; break;
        case 'settings/describe': {
          // The pinned native settings schema enables the sanitized Trajectory view.
          const schema={uid:2,refs:{1:{type:'boolean',meta:{default:true}},
            2:{type:'object',meta:{default:{}},dict:{enabled:1}}}};
          value={writable:false,hasDocument:false,namespaces:[{ns:'ui-settings',schema,autoGenerate:false,
            value:{enabled:!guest},base:{enabled:!guest},user:{},applies:'live',secrets:[],revision:0}]}; break;
        }
        case 'session/create': {
          if(guest){ if(!ids.length) throw new Error('Требуется вход'); value={sessionId:ids[0]}; break;}
          if(p.sessionId && ids.includes(p.sessionId) && !nonempty.has(p.sessionId)) {value={sessionId:p.sessionId};break;}
          const {chatId}=await api('/api/chats',{method:'POST',signal});
          ids.push(chatId); changes.notify(); value={sessionId:chatId}; break;
        }
        case 'session/projections': check(p.sessionId); value={kind:'sequenced',...projection(p.sessionId)}; break;
        case 'session/page': {
          const id=p.address.sessionId; check(id);
          const before=cuts.get(id+'|'+p.throughSeq);
          value=before==null ? {records:[],hasMore:false} : await page(id,before,signal); break;
        }
        case 'session/prompt': {
          const id=p.sessionId; check(id);
          if (!Array.isArray(p.content)||!p.content.length||p.content.some(part=>part.type!=='text'))
            throw new Error('Доступны текстовые сообщения');
          const text=p.content.map(part=>part.text).join('\n');
          const limit = account.limit || account.wallet?.turnLimit;
          let turn = pending.get(id);
          if (!turn || turn.text !== text || turn.limit !== limit) {
            turn = {text, limit, requestId:p.requestId};
            pending.set(id, turn);
          }
          running.add(id);
          try {
            if(guest) await api('/guest/chats/'+encodeURIComponent(id)+'/turns',{method:'POST',signal,
              headers:{'Accept':'application/json'}, body:new URLSearchParams({text,request_id:turn.requestId})});
            else await api('/api/chats/'+encodeURIComponent(id)+'/turns',{method:'POST',signal,
              headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:turn.requestId,text,maxCoins:limit})});
            nonempty.add(id);
            if(!guest) api('/api/wallet').then(w=>{account.wallet=w;}).catch(()=>{});
            pending.delete(id);
            value={accepted:true};
          } catch (error) {
            // Keep the request identity when a paid request may already have reached the provider.
            if ([400,401,402,403,404,413].includes(error.status)) pending.delete(id);
            throw error;
          } finally { running.delete(id); changes.notify(); }
          break;
        }
        default: return failure('Действие недоступно');
      }
      return {ok:true,value};
    } catch(error) {return failure(error.message);}
  }
  async function* open(channel,endpoint,payload,signal) {
    if(channel!=='/api') throw new Error('Канал недоступен');
    const p=params(payload);
    let next = changes.next(signal);
    if(endpoint==='session/follow') {
      const id=p.address.sessionId; check(id);
      let window=opening.get(id) ?? await page(id,null,signal);
      opening.delete(id);
      let seq=window.records.at(-1)?.event.seq ?? -1;
      yield {type:'snapshot',header:{version:3,id,createdAt:0,cwd:'/personal',isSeeded:false},
        cursor:seq,...window,projections:projection(id,seq),assistantStream:{revision:0}};
      while(!signal.aborted) {
        await next; if(signal.aborted) return; next=changes.next(signal);
        window=await page(id,null,signal);
        while(window.hasMore && window.records[0].event.seq>seq+1){
          const older=await page(id,cuts.get(id+'|'+(window.records[0].event.seq-1)),signal);
          window={records:[...older.records,...window.records],hasMore:older.hasMore};
        }
        for(const record of window.records) if(record.event.seq>seq){seq=record.event.seq;yield record;}
      }
      return;
    }
    if(endpoint==='$events') yield {type:'ready',clientId:crypto.randomUUID(),host:{home:'/personal'}};
    else if(endpoint==='session/control') yield {type:'baseline',value:{projections:{}}};
    else if(endpoint==='workspace/follow') yield {type:'baseline',value:view()};
    else if(endpoint==='remoteAccess/follow') yield access();
    else throw new Error('Подписка недоступна');
    while(!signal.aborted) {
      await next; if(signal.aborted)return; next=changes.next(signal);
      if(endpoint==='workspace/follow') yield {type:'replace',value:view()};
      if(endpoint==='remoteAccess/follow') for(const grant of access().grants) yield {type:'upsert',grant};
    }
  }
  return {account,rpc:{call,open},access};
}
