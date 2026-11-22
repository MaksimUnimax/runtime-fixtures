import {turnFilter} from './capability-filter.mjs';

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
function matchingCards(cards, query) {
  const key = query.trim().toLowerCase();
  const exact = cards.find(card => card.id.toLowerCase() === key);
  if (exact) return [exact];
  if (/^[\w-]+\/[\w.-]+$/u.test(key)) return [];
  const terms = [...words(query)];
  const rows = cards.map(card => {
    // Names, operations and aliases describe the subject. Generic prose (e.g.
    // "Подключение") should not pull unrelated setup guides into a named lookup.
    const subject = words([card.id.split('/').at(-1), card.title, card.keywords, ...(card.aliases ?? []),
      ...(card.triggers ?? []), ...(card.operations ?? []).flatMap(op => [op.task, op.access]),
      ...Object.keys(Array.isArray(card.steps) ? {} : card.steps ?? {})].join(' '));
    const prose = words(card.purpose+' '+card.group);
    return {card, subject:terms.filter(word => subject.has(word)).length,
      general:terms.filter(word => prose.has(word)).length};
  });
  const specific = rows.some(row => row.subject);
  return rows.filter(row => !key || (specific ? row.subject : row.general))
    .sort((a,b) => b.subject-a.subject || b.general-a.general || a.card.id.localeCompare(b.card.id))
    .map(row => row.card);
}

export function lookup(knowledge, query, page = 1) {
  if (!Number.isSafeInteger(page) || page < 1) return {error:'Укажите номер страницы от 1.'};
  const {cards, states, currentSteps = {}} = knowledge;
  const triggers = cards.flatMap(card => (card.triggers ?? []).map(event => ({event, plugin:card.id})));
  const automation = triggers.length ? {triggers:triggers.slice(0,16),total:triggers.length} : {triggers:[], status:'Запуск задач по событию или расписанию пока недоступен.'};
  const scored = matchingCards(cards, query);
  const state = card => states[card.id] ?? (card.id.startsWith('integration/')?'не подключено':'не установлено');
  if (!query.trim()) {
    const summaries = scored.slice((page-1)*16,page*16).map(card => ({id:card.id,title:card.title,purpose:card.purpose,state:state(card)}));
    return {automation,total:scored.length, nextPage:page*16<scored.length?page+1:null, cards:summaries};
  }
  const rows = scored.slice((page-1)*5, page*5);
  const byId = new Map(cards.map(card=>[card.id,card]));
  const selected = new Set(rows);
  for (const card of selected) {
    for (const op of card.operations ?? []) {
      if (byId.has(op.requires)) selected.add(byId.get(op.requires));
    }
  }
  if (!scored.length) return {automation,total:0,nextPage:null,cards:[],
    status:'Совпадений среди опубликованных возможностей нет. Уточни название через полный каталог.'};
  return {automation,total:scored.length, nextPage:page*5<scored.length?page+1:null,
    cards:[...selected].map(({keywords,briefSetup,...card}) => {
      const current = state(card);
      const detail = {...card,state:current};
      if (currentSteps[card.id]) detail.steps = currentSteps[card.id];
      else if (Array.isArray(current) && current.some(row => !row.attached)) {
        detail.steps = {saved:'Для сохранённого магазина в этом чате откройте «Настройки» → «Интеграции» и включите «Доступ в этом диалоге». Ключи уже сохранены.',
          newStoreOrNewAccess:card.steps};
      }
      return detail;
    })};
}

export function directory(cards) {
  const groups = Map.groupBy(cards, card => card.group);
  const titles = [...groups].map(([group,items]) => group+': '+items.map(c=>c.title).join(', ')).join('. ');
  return titles.length <= 170 ? titles : [...new Set(cards.map(c => c.group))].sort().slice(0,12).join(', ').slice(0,170);
}

// Only named product subjects can contribute a short current-state note. This
// never selects an executable tool, expands setup instructions or reads a store.
export function serviceNotes(knowledge, question) {
  const terms = words(question);
  if (!terms.size) return {notes:[], replies:{}};
  const names = new Set();
  for (const card of knowledge.cards) {
    if (!card.id.startsWith('integration/')) continue;
    const aliases = words([card.id.split('/').at(-1),card.title,...(card.aliases ?? [])].join(' '));
    if ([...terms].some(t => aliases.has(t))) names.add(card.id);
  }
  const notes = [], replies = {};
  const titleTerms = knowledge.cards.map(card => words(card.title));
  const frequency = new Map();
  for (const title of titleTerms) for (const word of title) frequency.set(word,(frequency.get(word) ?? 0)+1);
  for (const [index,c] of knowledge.cards.entries()) {
    const directName = question.toLowerCase().includes(c.title.toLowerCase());
    const shortSetup = c.briefSetup && (directName || [...titleTerms[index]].some(word => terms.has(word) && frequency.get(word)===1));
    const named = names.has(c.id) || c.operations?.some(op => names.has(op.requires)) ||
      directName || shortSetup ||
      (c.usage && [...words(c.keywords ?? '')].some(term => terms.has(term)));
    if (!named || (!c.usage && !shortSetup && !knowledge.currentSteps?.[c.id])) continue;
    const note = [c.title,JSON.stringify(knowledge.states[c.id] ?? 'не установлено'),
      ...(knowledge.currentSteps?.[c.id] ?? []),shortSetup ? c.steps.join(' ') : '',c.usage].filter(Boolean).join(' · ');
    if (notes.join(' ').length + note.length > 800) continue;
    notes.push(note);
    if (knowledge.replies?.[c.id]) replies[c.id] = knowledge.replies[c.id];
  }
  return {notes,replies};
}

export async function registerKnowledge(ctx, load, knowledge, question = '') {
  const {defineTool} = await load('dsh-tools');
  ctx.systemPrompt.section({name:'octopus',order:25,interpolate:false,
    text:'Ты Октопус, осьминог Октопорта. От первого лица помогай вести магазины. Инструкции и статус сверяй через octoport_help. Без подтверждения исход неизвестен.'});
  const {address,tone,detail} = knowledge.style;
  const hasTriggers = knowledge.cards.some(card => card.triggers?.length);
  ctx.systemPrompt.context({name:'octopus-settings',order:75,required:true,interpolate:false,
    text:'Стиль: '+[address,tone,detail].join(', ')+'. Опубликовано: '+directory(knowledge.cards)+(hasTriggers ? '. Автозапуск: см. triggers.' : '. Автозапуск и напоминания недоступны.')});
  const {notes,replies} = serviceNotes(knowledge, question);
  const topics = Object.entries(replies).map(([id,r]) => id+' — '+r.topic);
  if (notes.length) ctx.systemPrompt.context({name:'product-status',order:76,required:true,interpolate:false,
    text:notes.join('\n')});
  if (topics.length) ctx.systemPrompt.section({name:'verified-help',order:82,interpolate:false,
    text:'Если вопрос целиком относится к одной из тем, единственный ответ — вызов octoport_help с reply равным ID темы, runNow=false. Готовую справку покажет Октопорт. При другом или составном поручении работай обычно.\n'+topics.join('\n')});
  ctx.tools.register(defineTool({
    name:'octoport_help',description:'Справка. Пустой запрос — список.',
    parameters:{query:{type:'string',required:true},runNow:{type:'boolean',required:true,description:'Пользователь просит выполнить поручение сейчас?'},page:{type:'integer'},
      ...(topics.length ? {reply:{type:'string',required:true,enum:['other',...Object.keys(replies)],description:'Для вопроса по одной теме выбери её ID. Для остальных задач — other.'}} : {})},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    execute:async ({query,page,runNow,reply})=>{
      if (reply && !runNow && Object.hasOwn(replies,reply)) {
        turnFilter(ctx)?.recordHelp(false);
        return JSON.stringify({verifiedReply:reply});
      }
      turnFilter(ctx)?.recordHelp(runNow);
      const details=lookup(knowledge,query,page);
      if (runNow) details.next='Для выполнения открой нужное действие через octoport_use.';
      return JSON.stringify(details);
    }
  }));
}

export function resolvedHelp(messages, replies) {
  if (!replies) return;
  const result = messages.at(-1), batch = messages.at(-2);
  if (result?.role !== 'tool' || result.isError || batch?.role !== 'assistant') return;
  const calls = batch.content.filter(b => b.type === 'tool-call');
  if (calls.length !== 1 || calls[0].name !== 'octoport_help' || calls[0].id !== result.toolCallId) return;
  try {
    const args = JSON.parse(calls[0].arguments);
    const record = JSON.parse(result.content.find(b => b.type === 'text').text);
    if (args.runNow === false && args.reply === record.verifiedReply && Object.hasOwn(replies,args.reply))
      return replies[args.reply].text;
  } catch { /* Other calls proceed through the ordinary agent loop. */ }
}
