const reportTools = new Set(['mcp__platform__find_marketplace_reports', 'mcp__platform__marketplace_report', 'octoport_help', 'octoport_use']);

// Apply this projection at dispatch only. Historical journal sequence numbers,
// restore checkpoints, and active tool calls remain valid on either transport.
export function projectCompletedKnowledge(seed) {
  const oldAssistants = new Set(), oldResults = new Set(), oldCalls = new Set();
  const reportTurns = new Set(), idsByTurn = new Map();
  const activated = new Map();
  for (const {type,data} of seed) {
    if (type !== 'assistant/message') continue;
    for (const block of data.message.content) {
      if (block.type !== 'tool-call' || block.name !== 'octoport_use') continue;
      try {
        const {action}=JSON.parse(block.arguments);
        if (typeof action !== 'string') continue;
        const actions=activated.get(data.turn) ?? new Set();
        actions.add(action);activated.set(data.turn,actions);
      } catch { /* Invalid activations open no resource. */ }
    }
  }
  for (const {type,data} of seed) {
    if (type !== 'assistant/message') continue;
    for (const block of data.message.content) {
      if (block.type !== 'tool-call' || !(reportTools.has(block.name) || activated.get(data.turn)?.has(block.name))) continue;
      reportTurns.add(data.turn);
      oldCalls.add(block.id);
      if (block.name.endsWith('__marketplace_report')) {
        try {
          const selected = JSON.parse(block.arguments).selections;
          const ids = idsByTurn.get(data.turn) ?? new Set();
          for (const item of selected) if (typeof item.templateId === 'string') ids.add(item.templateId);
          idsByTurn.set(data.turn, ids);
        } catch { /* Protocol validation may have rejected a malformed past call. */ }
      }
    }
  }
  const redact = new Map();
  for (const {type,data} of seed) {
    if (!reportTurns.has(data.turn)) continue;
    if (type === 'tool/result' && oldCalls.has(data.message.toolCallId)) oldResults.add(data.message.id);
    if (type !== 'assistant/message') continue;
    const msg = data.message;
    // Unrelated historical tool exchanges carry provider-signed replay state.
    if (msg.content.some(b => b.type === 'tool-call' && !oldCalls.has(b.id)) &&
        !msg.content.some(b => b.type === 'tool-call' && oldCalls.has(b.id))) continue;
    oldAssistants.add(msg.id);
    redact.set(msg.id, idsByTurn.get(data.turn) ?? []);
  }
  return messages => {
    const latest = messages.findLast(message => message.source?.kind === 'runtime-context' &&
      message.source.form === 'snapshot');
    return messages.flatMap(msg => {
      if (latest && msg !== latest && msg.source?.kind === 'runtime-context' && msg.source.form === 'snapshot') return [];
      if (msg.role === 'tool' && oldResults.has(msg.id)) return [];
      if (msg.role !== 'assistant' || !oldAssistants.has(msg.id)) return [msg];
      const content = msg.content.filter(block => block.type !== 'reasoning' &&
        !(block.type === 'tool-call' && oldCalls.has(block.id))).map(block => {
          if (block.type !== 'text') return block;
          let text = block.text;
          for (const id of redact.get(msg.id)) text = text.replaceAll(id,'отчёт');
          return {...block, text};
        });
      if (!content.length) return [];
      const {replayState, ...source} = msg.source;
      return [{...msg, content, source}];
    });
  };
}

const words = text => new Set(text.toLocaleLowerCase('ru').replaceAll('ё','е')
  .match(/[а-яa-z0-9]+/g)?.filter(w => w.length > 1).map(w => w.slice(0, 5)) ?? []);
const describe = card => [card.id, card.group, card.title, card.keywords, card.purpose, ...Object.keys(Array.isArray(card.steps) ? {} : card.steps ?? {}),
  ...(card.operations ?? []).flatMap(o => [o.task,o.access])].join(' ');

export function lookup(knowledge, query, page = 1) {
  if (!Number.isSafeInteger(page) || page < 1) return {error:'Укажите номер страницы от 1.'};
  const {cards, states} = knowledge;
  const terms = words(query);
  const scored = cards.map(card => {
    const vocabulary = words(describe(card));
    const score = Number(query === card.id) * 100 + [...terms].filter(term => vocabulary.has(term)).length;
    return {card, score};
  }).filter(row => !query.trim() || row.score).sort((a,b) => b.score-a.score || a.card.id.localeCompare(b.card.id));
  if (!query.trim()) {
    const summaries = scored.slice((page-1)*16,page*16).map(({card}) => ({id:card.id,title:card.title,purpose:card.purpose}));
    return {total:scored.length, nextPage:page*16<scored.length?page+1:null, cards:summaries};
  }
  const rows = scored.slice((page-1)*5, page*5).map(r => r.card);
  const byId = new Map(cards.map(card=>[card.id,card]));
  const selected = new Set(rows);
  for (const card of selected) {
    for (const op of card.operations ?? []) {
      if (byId.has(op.requires)) selected.add(byId.get(op.requires));
    }
  }
  return {total:scored.length, nextPage:page*5<scored.length?page+1:null,
    cards:[...selected].map(({keywords,...card}) => ({...card,state:states[card.id] ??
      (card.id.startsWith('integration/')?'не подключено':'не установлено')}))};
}

export function directory(cards) {
  const groups = Map.groupBy(cards, card => card.group);
  const titles = [...groups].map(([group,items]) => group+': '+items.map(c=>c.title).join(', ')).join('. ');
  return titles.length <= 170 ? titles : [...new Set(cards.map(c => c.group))].sort().slice(0,12).join(', ').slice(0,170);
}

export async function registerKnowledge(ctx, load, knowledge) {
  const {defineTool} = await load('dsh-tools');
  ctx.systemPrompt.section({name:'octopus',order:25,interpolate:false,
    text:'Ты Октопус, осьминог Октопорта. Ясно говори от первого лица, помогай вести магазины из одного места. '+
      'Перечисляй названия из указателя. Для настройки и плана узнай подробности в octoport_help. Учитывай зависимости. '+
      'Предлагай только опубликованные возможности. О выполнении сообщай после подтверждения. Не обещай настроить то, чего нет в каталоге.'});
  const {address,tone,detail} = knowledge.style;
  ctx.systemPrompt.context({name:'octopus-settings',order:75,required:true,interpolate:false,
    text:'Стиль: '+[address,tone,detail].join(', ')+'. В каталоге: '+directory(knowledge.cards)+'.'});
  ctx.tools.register(defineTool({
    name:'octoport_help',description:'Возможности, зависимости, доступ и подключение. Пустой запрос перечисляет каталог.',
    parameters:{query:{type:'string',required:true},page:{type:'integer',description:'Номер страницы от 1'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    execute:async ({query,page})=>JSON.stringify(lookup(knowledge,query,page))
  }));
}
