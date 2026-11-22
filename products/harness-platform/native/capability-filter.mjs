// Each Context belongs to one turn. The provider and native executor use the
// same admitted set, including after an interrupted operation is restored.
const filters = new WeakMap();
export const activate = 'octoport_use';
function splitName(name) {
  const parts = /^(mcp__.+?__)(.+)$/.exec(name);
  return parts ? [parts[1], parts[2]] : ['', name];
}
function companion(name) {
  const [prefix, localName] = splitName(name);
  return prefix + 'describe__' + localName;
}
const internal = name => splitName(name)[1].startsWith('describe__');

export function turnFilter(ctx) { return filters.get(ctx); }

function previousArguments(seed, name) {
  const results = new Set();
  for (const event of seed) {
    if (event.type === 'tool/result' && !event.data.message.isError)
      results.add(JSON.stringify([event.data.turn,event.data.message.toolCallId]));
  }
  const args = [];
  let turn;
  for (let i = seed.length - 1; i >= 0; i--) {
    const event = seed[i];
    if (event.type !== 'assistant/message') continue;
    if (turn !== undefined && turn !== event.data.turn) break;
    for (const call of event.data.message.content) {
      if (call.type !== 'tool-call' || call.name !== name ||
          !results.has(JSON.stringify([event.data.turn,call.id]))) continue;
      try {
        const input = JSON.parse(call.arguments);
        if (call.arguments.length <= 8192 && args.length < 8) args.push(input);
        turn = event.data.turn;
      } catch { /* Malformed requests carry no reusable selection. */ }
    }
  }
  return args;
}

export function installFilter(ctx, defineTool, restored = [], history = []) {
  const available = new Map(ctx.tools.definitions().filter(t => !internal(t.name) && t.name !== 'octoport_help')
    .map(t => [t.name, t]));
  if (!available.size) return;
  const selected = new Set();
  for (const event of restored) {
    if (event.type !== 'tool/result' || event.data.message.isError) continue;
    const call = restored.find(e => e.type === 'assistant/message' && e.data.message.content.some(
      b => b.type === 'tool-call' && b.id === event.data.message.toolCallId && b.name === activate));
    if (!call) continue;
    try {
      const record=JSON.parse(event.data.message.content.find(b=>b.type==='text').text);
      if (available.has(record.opened)) selected.add(record.opened);
    } catch { /* An unsuccessful activation grants nothing. */ }
  }
  let visible = new Set();
  const filter = {
    project(tools) {
      visible = new Set(selected);
      return tools?.filter(t => t.name===activate || t.name==='octoport_help' || visible.has(t.name));
    },
  };
  filters.set(ctx, filter);
  ctx.tools.guard(exec => (exec.name===activate || exec.name==='octoport_help' || visible.has(exec.name))
    ? undefined : 'Это действие закрыто для текущего шага.');
  const names = [...available.keys()].sort();
  const menu = names.join(', ').length <= 230 ? names.join(', ') : 'Получите указатель пустым action.';

  ctx.tools.register(defineTool({
    name:activate, description:'Открой действие только для выполнения сейчас. '+menu,
    parameters:{action:{type:'string',required:true},query:{type:'string',required:true,
      description:'Предмет действия и показатель из беседы'},reuse:{type:'boolean',description:'Тот же показатель за другой период'},offset:{type:'integer',description:'Следующая страница при необходимости'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    async execute({action,query,offset=0,reuse=false},exec) {
      if (!action) {
        if (!Number.isSafeInteger(offset) || offset<0) return JSON.stringify({error:'Неверная страница.'});
        const terms=query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
        const matches=names.filter(name=>!terms.length || terms.some(term=>
          (name+' '+available.get(name).description.slice(0,140)).toLocaleLowerCase().includes(term)));
        const actions = matches.slice(offset,offset+16).map(name => ({name, purpose: available.get(name).description.slice(0,140)}));
        return JSON.stringify({actions,nextOffset:offset+16<matches.length?offset+16:null});
      }
      if (!available.has(action) || !query.trim() || query.length>256 || !Number.isSafeInteger(offset) || offset<0)
        return JSON.stringify({error:'Выберите доступное действие и укажите его предмет.'});
      const provider=ctx.tools.get(companion(action));
      let details;
      if (provider) {
        const args = {query,offset};
        if (provider.parameters?.properties?.previous) {
          args.previous = JSON.stringify(previousArguments(history,action));
          args.reuse = reuse;
        }
        const response=await provider.execute(args,exec);
        details=response.structuredContent?.result ?? response.content;
      }
      selected.add(action);
      return JSON.stringify({opened:action,...(details===undefined?{}:{details})});
    },
  }));
  ctx.systemPrompt.section({name:'capability-filter',order:26,interpolate:false,
    text:'Справка и планы — octoport_help. Для пересказа используй историю. Открывай действие только по просьбе выполнить его сейчас. В смешанном запросе выполни обе части.'});
}
