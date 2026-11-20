import { importRuntime } from './runtime-import.mjs';
import { DATA_TOOLS, explicitAnalysisIntent, freshTurn, historyDataEvidence, humanText, initialMode, isDataEvidence, lastSelectionEvent, referencesExistingData, sameSelection } from './routing-policy.mjs';

export const name = 'harness-native-lab-policy';
export const inject = ['agents', 'commands', 'tools', 'storageDomain'];

export async function apply(ctx, options = {}) {
  const { defineDomain, domainTable } = await importRuntime('@deepseek-ai/dsh-storage-domain');
  const { z } = await importRuntime('zod');
  const { ReasoningEffortId } = await importRuntime('@deepseek-ai/dsh-llm');
  const fast = Object.freeze({ provider: 'deepseek-official', model: options.fastModel ?? 'deepseek-flash', reasoningEffort: ReasoningEffortId('off') });
  const deep = Object.freeze({ provider: 'deepseek-official', model: options.deepModel ?? 'deepseek-v4-pro', reasoningEffort: ReasoningEffortId('high') });
  const maxSteps = options.maxSteps ?? 8;
  const fastMaxTokens = options.fastMaxTokens ?? 4096;
  const deepMaxTokens = options.deepMaxTokens ?? 8192;
  if (![maxSteps, fastMaxTokens, deepMaxTokens].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Invalid native lab limits');
  const domain = await ctx.storageDomain.open(defineDomain({
    name: 'harness_lab_routing', version: 1,
    tables: { sessions: domainTable(z.object({ mode: z.enum(['auto', 'manual']), lastSelectionSeq: z.number().int().nonnegative().nullable() })) },
  }));
  const table = domain.table('sessions');
  const states = new Map();
  const selecting = new Set();
  const pending = new Set();
  let stopping = false;
  ctx.effect(() => async () => {
    stopping = true;
    await Promise.allSettled([...pending]);
    await domain.close();
  });

  function stateFor(agent) {
    let state = states.get(agent.id);
    if (!state) {
      state = { agent, mode: initialMode(agent.session, table.get(agent.id), fast), turn: null, writeError: false };
      states.set(agent.id, state);
    }
    return state;
  }
  function save(state) {
    if (stopping) return Promise.resolve();
    const value = { mode: state.mode, lastSelectionSeq: lastSelectionEvent(state.agent.session)?.seq ?? null };
    const operation = table.put(state.agent.id, value);
    pending.add(operation);
    operation.then(() => pending.delete(operation), () => {
      pending.delete(operation);
      state.mode = 'manual'; state.writeError = true;
      console.error('[native-lab] Cannot persist routing preference; Auto disabled for this session');
    });
    return operation;
  }
  function select(state, selection, reason) {
    if (sameSelection(state.agent.model.current(), selection)) return;
    selecting.add(state.agent.id);
    try { state.agent.model.select(selection); }
    finally { selecting.delete(state.agent.id); }
    void save(state).catch(() => {});
    console.error(`[native-lab] route ${state.agent.id}: ${selection.model}/${selection.reasoningEffort}; ${reason}`);
  }
  function fastNext(state, reason) {
    if (state.mode === 'auto') select(state, fast, reason);
  }

  ctx.on('agent/created', async ({ agent }) => {
    const state = stateFor(agent);
    if (!table.get(agent.id)) await save(state);
  });
  ctx.on('agent/disposed', ({ agent }) => { states.delete(agent.id); });
  ctx.on('session/event', (session, event) => {
    const state = states.get(session.id);
    if (!state) return;
    if (event.type === 'model/selection' && !selecting.has(session.id)) {
      state.mode = 'manual'; state.turn = null;
      void save(state).catch(() => {});
    }
    if (event.type === 'turn/end') {
      state.turn = null;
    }
  });
  // Session observers must not append recursively. Status is emitted after the
  // driver finishes publishing its boundaries, so this is a safe failure reset.
  ctx.on('agent/status', ({ agent, status }) => {
    const state = states.get(agent.id);
    if (state && status === 'idle') {
      fastNext(state, 'agent became idle');
      state.turn = null;
    }
  });

  // rc.1 emits this synchronously BEFORE capturing model.current() for the step.
  ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
    const text = humanText(message);
    if (text === null) return;
    const state = stateFor(agent);
    if (state.mode !== 'auto') return;
    if (!state.turn || state.turn.turn !== turn) state.turn = freshTurn(turn, explicitAnalysisIntent(text));
    else state.turn.analysis = explicitAnalysisIntent(text);
    fastNext(state, 'new human input');
    if (state.turn.analysis && !state.turn.promoted && referencesExistingData(text) && historyDataEvidence(agent.session)) {
      state.turn.promoted = true;
      select(state, deep, 'explicit analysis of still-visible earlier MCP data');
    }
  });

  // tools/result is the final, frozen result, not a model-authored claim of success.
  ctx.on('tools/result', (execution, result) => {
    if (!isDataEvidence(execution, result, DATA_TOOLS)) return;
    const state = stateFor(execution.agent);
    const turn = state.turn;
    if (state.mode !== 'auto' || !turn?.analysis || turn.promoted || execution.agent.status !== 'running') return;
    const position = ctx.agents.turnBoundaryOf(execution.agent.session);
    if (position.lastTurn !== turn.turn || position.openTurnStartSeq === null) return;
    turn.dataCalls.add(execution.callId);
    turn.promoted = true; // Monotone across a parallel result batch.
    select(state, deep, 'explicit analysis with completed structured MCP data');
  });

  ctx.on('agent/pre-step', async (payload, next) => {
    const state = stateFor(payload.agent);
    if (payload.step > maxSteps) return { kind: 'reject' };
    // This step has ALREADY captured payload.modelSelection. Set only the NEXT
    // unprepared step back to Flash here, without changing this immutable choice.
    // model.select() from a session/event observer would be a forbidden append.
    if (state.mode === 'auto' && state.turn?.promoted && state.turn.turn === payload.turn && sameSelection(payload.modelSelection, deep)) {
      state.turn.highStep = payload.step;
      fastNext(state, 'one analysis step captured; following step returns to Flash');
    }
    return next();
  });
  ctx.on('agent/request', async (_payload, next) => {
    const config = await next();
    const cap = config.model === deep.model ? deepMaxTokens : fastMaxTokens;
    // Output controls may be capped here; provider/model/effort MUST be retained.
    return { ...config, maxTokens: cap };
  });

  ctx.tools.guard(execution => {
    const allowed = execution.name === 'ask_user_question' || execution.name.startsWith('mcp__business__');
    return allowed ? undefined : 'This test profile exposes only its business MCP and clarification tools.';
  });
  ctx.commands.register({
    definitionId: 'harness-native-lab/mode', name: 'lab-mode',
    description: 'Auto: Flash/off then one Pro/high analysis step after real data; manual: native model picker',
    input: { hint: 'auto | manual | status' },
    async handler({ agent, rawInput, signal }) {
      signal.throwIfAborted();
      const value = rawInput.trim().toLowerCase() || 'status';
      if (!['auto', 'manual', 'status'].includes(value)) return { kind: 'error', text: 'Используйте /lab-mode auto, /lab-mode manual или /lab-mode status.' };
      const state = stateFor(agent);
      if (value !== 'status') {
        state.mode = value; state.turn = null; state.writeError = false;
        if (value === 'auto') select(state, fast, 'human enabled Auto');
        await save(state);
      }
      const selected = agent.model.current();
      return { kind: 'success', text: `${state.mode === 'auto' ? 'Auto' : 'Ручной режим'}. Следующий шаг: ${selected?.model ?? 'не выбран'} / ${selected?.reasoningEffort ?? 'по умолчанию'}. ${state.mode === 'auto' ? 'После явно запрошенного анализа и успешных MCP-данных допускается один шаг Pro/high. Это простое правило, без LLM-классификатора.' : 'Используйте штатный выбор модели и reasoning в чате.'}${state.writeError ? ' Ошибка сохранения настройки: Auto отключён.' : ''}` };
    },
  });
  ctx.provide('labPolicy', true);
}
