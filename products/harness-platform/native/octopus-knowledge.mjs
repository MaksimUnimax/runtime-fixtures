const reportTools = new Set(['mcp__platform__find_marketplace_reports', 'mcp__platform__marketplace_report', 'octoport_help', 'octoport_use']);

// Apply this projection at dispatch only. Historical journal sequence numbers,
// restore checkpoints, and active tool calls remain valid on either transport.
export function projectCompletedKnowledge(seed) {
  const oldAssistants = new Set(), oldResults = new Set(), settledBatches = new Set();
  const callsByTurn = new Map(), redact = new Map();
  for (const {type,data} of seed) {
    if (type !== 'assistant/message' && type !== 'tool/result') continue;
    let turn = callsByTurn.get(data.turn);
    if (!turn) {
      turn = {messages: [], results: new Map()};
      callsByTurn.set(data.turn, turn);
    }
    if (type === 'tool/result') turn.results.set(data.message.toolCallId, data.message);
    else turn.messages.push(data.message);
  }
  for (const {messages, results} of callsByTurn.values()) {
    const privateActions = new Set(), ids = new Set();
    let hasPrivateData = false;
    for (const msg of messages) {
      for (const call of msg.content) {
        if (call.type !== 'tool-call') continue;
        if (call.name === 'octoport_help') hasPrivateData = true;
        if (call.name !== 'octoport_use') continue;
        const result = results.get(call.id);
        if (!result || result.isError) continue;
        try {
          const record = JSON.parse(result.content.find(b => b.type === 'text').text);
          if (typeof record.opened === 'string' && Object.hasOwn(record, 'details')) {
            privateActions.add(record.opened);
            hasPrivateData = true;
          }
        } catch { /* Invalid activation results grant no access. */ }
      }
    }
    for (const msg of messages) {
      const calls = msg.content.filter(b => b.type === 'tool-call');
      if (!calls.some(call => reportTools.has(call.name) || privateActions.has(call.name))) continue;
      // The provider signs a whole batch. Keep calls and results paired.
      settledBatches.add(msg.id);
      for (const call of calls) {
        const result = results.get(call.id);
        if (result) oldResults.add(result.id);
        if (call.name !== 'mcp__platform__marketplace_report' &&
            call.name !== 'mcp__platform__find_marketplace_reports') continue;
        hasPrivateData = true;
        try {
          for (const item of JSON.parse(call.arguments).selections ?? []) {
            if (typeof item.templateId === 'string') ids.add(item.templateId);
          }
        } catch { /* A past invocation may have failed validation. */ }
      }
    }
    if (hasPrivateData) for (const msg of messages) {
      if (msg.content.some(b => b.type === 'tool-call')) continue;
      oldAssistants.add(msg.id);
      redact.set(msg.id, ids);
    }
  }
  return messages => {
    const latest = messages.findLast(message => message.source?.kind === 'runtime-context' &&
      message.source.form === 'snapshot');
    const projected = messages.flatMap(msg => {
      if (latest && msg !== latest && msg.source?.kind === 'runtime-context' && msg.source.form === 'snapshot') return [];
      if (msg.role === 'tool' && oldResults.has(msg.id)) return [];
      // A progress preamble belongs to the removed tool batch. Keeping it as a
      // standalone assistant reply teaches the model that a promise ends a turn.
      if (msg.role === 'assistant' && settledBatches.has(msg.id)) return [];
      if (msg.role !== 'assistant' || !oldAssistants.has(msg.id)) return [msg];
      const content = msg.content.filter(block => block.type !== 'reasoning' &&
        block.type !== 'tool-call').map(block => {
          if (block.type !== 'text') return block;
          let text = block.text;
          for (const id of redact.get(msg.id) ?? []) text = text.replaceAll(id,'отчёт');
          return {...block, text};
        });
      if (!content.length) return [];
      const {replayState, ...source} = msg.source;
      return [{...msg, content, source}];
    });
    // Harness can append a context update after the user request. For models
    // reading the final user message as the task, put metadata before that task.
    const position = projected.indexOf(latest);
    if (position > 0 && projected[position-1].role === 'user' &&
        projected[position-1].source?.kind === 'user') {
      [projected[position-1],projected[position]] = [latest,projected[position-1]];
    }
    return projected;
  };
}

const words = text => new Set(text.toLocaleLowerCase('ru').replaceAll('ё','е')
  .match(/[а-яa-z0-9]+/g)?.filter(w => w.length > 1).map(w => w.slice(0, 5)) ?? []);
const describe = card => [card.id, card.group, card.title, card.keywords, card.purpose, ...(card.triggers ?? []), ...Object.keys(Array.isArray(card.steps) ? {} : card.steps ?? {}),
  ...(card.operations ?? []).flatMap(o => [o.task,o.access])].join(' ');

export function lookup(knowledge, query, page = 1) {
  if (!Number.isSafeInteger(page) || page < 1) return {error:'Укажите номер страницы от 1.'};
  const {cards, states} = knowledge;
  const triggers = cards.flatMap(card => (card.triggers ?? []).map(event => ({event, plugin:card.id})));
  const automation = triggers.length ? {triggers:triggers.slice(0,16),total:triggers.length} : {triggers:[], status:'Запуск задач по событию или расписанию пока недоступен.'};
  const terms = words(query);
  const scored = cards.map(card => {
    const vocabulary = words(describe(card));
    const score = Number(query === card.id) * 100 + [...terms].filter(term => vocabulary.has(term)).length;
    return {card, score};
  }).filter(row => !query.trim() || row.score).sort((a,b) => b.score-a.score || a.card.id.localeCompare(b.card.id));
  const state = card => states[card.id] ?? (card.id.startsWith('integration/')?'не подключено':'не установлено');
  if (!query.trim()) {
    const summaries = scored.slice((page-1)*16,page*16).map(({card}) => ({id:card.id,title:card.title,purpose:card.purpose,state:state(card)}));
    return {automation,total:scored.length, nextPage:page*16<scored.length?page+1:null, cards:summaries};
  }
  const rows = scored.slice((page-1)*5, page*5).map(r => r.card);
  const byId = new Map(cards.map(card=>[card.id,card]));
  const selected = new Set(rows);
  for (const card of selected) {
    for (const op of card.operations ?? []) {
      if (byId.has(op.requires)) selected.add(byId.get(op.requires));
    }
  }
  return {automation,total:scored.length, nextPage:page*5<scored.length?page+1:null,
    cards:[...selected].map(({keywords,...card}) => ({...card,state:state(card)}))};
}

export function directory(cards) {
  const groups = Map.groupBy(cards, card => card.group);
  const titles = [...groups].map(([group,items]) => group+': '+items.map(c=>c.title).join(', ')).join('. ');
  return titles.length <= 170 ? titles : [...new Set(cards.map(c => c.group))].sort().slice(0,12).join(', ').slice(0,170);
}

export async function registerKnowledge(ctx, load, knowledge) {
  const {defineTool} = await load('dsh-tools');
  ctx.systemPrompt.section({name:'octopus',order:25,interpolate:false,
    text:'Ты Октопус, осьминог Октопорта. Помогай вести магазины из одного места. Говори от первого лица, понятно. Статус подключения проверь в справке. В плане проверь каждый шаг. Автозапуск — только по triggers. Сохрани канал из последнего запроса. Выполнение подтверждай по результату.'});
  const {address,tone,detail} = knowledge.style;
  ctx.systemPrompt.context({name:'octopus-settings',order:75,required:true,interpolate:false,
    text:'Стиль: '+[address,tone,detail].join(', ')+'. Опубликовано: '+directory(knowledge.cards)+'.'});
  ctx.tools.register(defineTool({
    name:'octoport_help',description:'Возможности, зависимости, доступ и подключение. Пустой запрос перечисляет каталог.',
    parameters:{query:{type:'string',required:true},page:{type:'integer',description:'Номер страницы от 1'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    execute:async ({query,page})=>JSON.stringify(lookup(knowledge,query,page))
  }));
}
