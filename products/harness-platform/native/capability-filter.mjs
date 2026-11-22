// Each Context belongs to one turn. The provider and native executor use the
// same admitted set, including after an interrupted operation is restored.
const filters = new WeakMap();
export const activate = 'octoport_use';
const prefix = 'mcp__platform__';
const companion = name => name.startsWith(prefix)
  ? prefix+'describe__'+name.slice(prefix.length) : 'describe__'+name;
const internal = name => name.replace(prefix,'').startsWith('describe__');

export function turnFilter(ctx) { return filters.get(ctx); }

export function installFilter(ctx, defineTool, restored = []) {
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
  if (!available.size) return;
  const names = [...available.keys()].sort();
  const menu = names.join(', ').length <= 230 ? names.join(', ') : 'Получите указатель пустым action.';

  ctx.tools.register(defineTool({
    name:activate, description:'Открой действие только для выполнения сейчас. '+menu,
    parameters:{action:{type:'string',required:true},query:{type:'string',required:true,
      description:'Предмет действия и показатель из беседы'},offset:{type:'integer',description:'Следующая страница при необходимости'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    async execute({action,query,offset=0},exec) {
      if (!action) {
        if (!Number.isSafeInteger(offset) || offset<0) return JSON.stringify({error:'Неверная страница.'});
        const terms=query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
        const matches=names.filter(name=>!terms.length || terms.some(term=>
          (name+' '+available.get(name).description.slice(0,140)).toLocaleLowerCase().includes(term)));
        return JSON.stringify({actions:matches.slice(offset,offset+16),nextOffset:offset+16<matches.length?offset+16:null});
      }
      if (!available.has(action) || !query.trim() || query.length>256 || !Number.isSafeInteger(offset) || offset<0)
        return JSON.stringify({error:'Выберите доступное действие и укажите его предмет.'});
      const provider=ctx.tools.get(companion(action));
      let details;
      if (provider) {
        const response=await provider.execute({query,offset},exec);
        details=response.structuredContent?.result ?? response.content;
      }
      selected.add(action);
      return JSON.stringify({opened:action,...(details===undefined?{}:{details})});
    },
  }));
  ctx.systemPrompt.section({name:'capability-filter',order:26,interpolate:false,
    text:'Справка и планы — octoport_help. Для пересказа используй историю. Открывай действие только по просьбе выполнить его сейчас. В смешанном запросе выполни обе части.'});
}
