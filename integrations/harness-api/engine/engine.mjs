import crypto from 'node:crypto';
import { PipelineError, PROVIDER, MODEL } from './provider.mjs';
import { StateStore, owner, identity, jobKey, fingerprint } from './state.mjs';
import { createHarnessRuntime } from './runtime.mjs';
import { pluginScope } from './plugin-contract.mjs';

const messageText = message => (message.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
const publicChat = chat => ({ chat_id: chat.chat_id, session_id: chat.chat_id, title: chat.title, created_at: chat.created_at });
const publicError = error => ({ code: error instanceof PipelineError ? error.code : 'ENGINE_ERROR', message: error instanceof PipelineError ? error.message : 'Не удалось завершить запрос. Повторная отправка автоматически не выполнялась.' });

export class HarnessEngine {
  constructor({ stateDirectory, execute, deepseekKey, runtimeFactory = createHarnessRuntime, timeoutMs = 610000, pluginsDirectory }) {
    this.stateDirectory = stateDirectory;
    this.execute = execute;
    this.deepseekKey = deepseekKey;
    this.runtimeFactory = runtimeFactory;
    this.pluginsDirectory = pluginsDirectory;
    this.timeoutMs = timeoutMs;
    this.store = new StateStore(stateDirectory);
    this.handles = new Map();
    this.loading = new Map();
    this.pending = new Map();
    this.active = new Map();
    this.runs = new Set();
    this.closing = false;
  }

  async start() {
    this.store.interruptedJobs();
    this.runtime = await this.runtimeFactory({
      stateDirectory: this.stateDirectory,
      execute: this.execute,
      deepseekKey: this.deepseekKey,
      store: this.store,
      pluginsDirectory: this.pluginsDirectory,
      readJobs: scope => structuredClone(Object.values(this.store.data.jobs).filter(job=>job.actor_id===scope.actor_id&&job.tenant_id===scope.tenant_id&&(!scope.session_id||job.chat_id===scope.session_id))),
      resolveScope: (sessionId, message) => {
        const pending = this.pending.get(sessionId);
        if (!pending || pending.message_id !== message.id) throw new PipelineError('REQUEST_SCOPE_MISMATCH', 'Авторизованный запрос не найден.', 403);
        const chat = this.store.chat(pending, sessionId);
        if (chat.chat_id !== pending.session_id) throw new PipelineError('REQUEST_SCOPE_MISMATCH', 'Разговор не соответствует запросу.', 403);
        return Object.freeze({ ...pending,capabilities:Object.freeze([...pending.capabilities]),feature_snapshot:Object.freeze({...pending.feature_snapshot,enabled:Object.freeze({...pending.feature_snapshot.enabled})}) });
      },
      recordResult: (scope, result) => {
        const pending = this.pending.get(scope.session_id);
        if (!pending || pending.request_id !== scope.request_id) throw new PipelineError('REQUEST_SCOPE_EXPIRED', 'Запрос уже завершён.', 409);
        pending.result = structuredClone(result);
      },
      recordFailure: (scope, error) => {
        const pending = this.pending.get(scope.session_id);
        if (pending && pending.request_id === scope.request_id){
          if(!pending.failure)pending.failure = publicError(error);
          if(error.meter?.schema==='octoport-request-meter/v1'&&error.meter.request_id===scope.request_id)pending.failureMeter=structuredClone(error.meter);
        }
      },
    });
    this.deepseekKey = undefined;
    return this;
  }

  async handle(chat, create = false) {
    if (this.handles.has(chat.chat_id)) return this.handles.get(chat.chat_id);
    if (this.loading.has(chat.chat_id)) return this.loading.get(chat.chat_id);
    const loading = (async () => {
      const handle = create ? await this.runtime.create(chat.chat_id) : await this.runtime.resume(chat.chat_id);
      // A crash may leave an inbox item. There is deliberately no pending binding
      // while rehydrating, so such input cannot dispatch the business pipeline.
      if (!create) {
        handle.agent.cancel({ kind: 'hook', reason: 'recovery-no-automatic-replay' });
        await handle.agent.whenIdle();
        handle.agent.inbox.clear();
      }
      handle.agent.model.select({ provider: PROVIDER, model: MODEL });
      this.handles.set(chat.chat_id, handle);
      return handle;
    })().finally(() => this.loading.delete(chat.chat_id));
    this.loading.set(chat.chat_id, loading);
    return loading;
  }

  async create(input) {
    if (this.closing) throw new PipelineError('SHUTTING_DOWN', 'Сервис перезапускается.', 503);
    const scope = owner(input);
    const chat = { ...scope, chat_id: crypto.randomUUID(), title: 'Новый разговор', created_at: Date.now() };
    await this.handle(chat, true);
    await this.runtime.flush();
    this.store.data.chats[chat.chat_id] = chat;
    this.store.save();
    return publicChat(chat);
  }

  list(input) {
    const scope = owner(input);
    return { chats: Object.values(this.store.data.chats).filter(chat => chat.actor_id === scope.actor_id && chat.tenant_id === scope.tenant_id).sort((a,b) => b.created_at-a.created_at).map(publicChat) };
  }

  async history(input) {
    const scope = pluginScope(input,input.chat_id), chat = this.store.chat(scope, input.chat_id);
    const { agent } = await this.handle(chat);
    const receipts=new Map(Object.values(this.store.data.jobs).filter(job=>job.chat_id===chat.chat_id&&job.actor_id===scope.actor_id&&job.tenant_id===scope.tenant_id&&job.assistant_message_id).map(job=>[job.assistant_message_id,job]));
    const humans=new Map(Object.values(this.store.data.jobs).filter(job=>job.chat_id===chat.chat_id&&job.actor_id===scope.actor_id&&job.tenant_id===scope.tenant_id).map(job=>[job.message_id,job]));
    let precedingJob;
    return { messages: agent.session.deriveMessages().filter(message => message.role === 'assistant' || (message.role === 'user' && message.source?.kind === 'user')).map(message => {
      if(message.role==='user')precedingJob=humans.get(message.id);
      const job=message.role==='assistant'?(receipts.get(message.id)??precedingJob):undefined;
      if(job&&typeof job.result?.text!=='string'&&job.plugin_intent?.required_capabilities.some(capability=>!scope.capabilities.includes(capability)))return{id:message.id,role:message.role,text:'Ответ плагина доступен только авторизованному разработчику.'};
      const view=job?this.runtime.ctx.octoportPlugins.project({...scope,request_id:job.job_id},job.result):null;
      return {id:message.id,role:message.role,text:view?.text??messageText(message),...(view?.presentation?{presentation:view.presentation}:{}),...(view?{metadata:view.metadata,usage:view.usage}:{})};
    }) };
  }

  pluginOwner(input){
    const scope=pluginScope(input,input.chat_id);
    if(input.chat_id!==undefined)this.store.chat(scope,input.chat_id);
    return scope;
  }

  pluginList(input){return this.runtime.ctx.octoportPlugins.list(this.pluginOwner(input));}
  pluginSet(input){return this.runtime.ctx.octoportPlugins.set(this.pluginOwner(input),input.plugin_id,input.enabled,input.scope);}
  pluginCall(input){return this.runtime.ctx.octoportPlugins.call(this.pluginOwner(input),input.plugin_id,input.action,input.arguments??{});}
  pluginParse(input){
    this.pluginOwner(input);
    if(typeof input.text!=='string'||input.text.length>20000)throw new PipelineError('BAD_MESSAGE','Некорректное сообщение.');
    const command=this.runtime.ctx.octoportPlugins.parse(input.text);
    return{handled:Boolean(command),kind:command?.kind??null};
  }

  send(input) {
    if (this.closing) throw new PipelineError('SHUTTING_DOWN', 'Сервис перезапускается.', 503);
    const scope = pluginScope(input,input.chat_id), chat = this.store.chat(scope, input.chat_id);
    const requestId = identity(input.request_id, 'request_id');
    if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 20000) throw new PipelineError('BAD_MESSAGE', 'Сообщение пустое или превышает 20 000 символов.');
    const key = jobKey(scope, requestId), hash = fingerprint(chat.chat_id, input.text);
    const existing = this.store.data.jobs[key];
    if (existing) {
      if (existing.fingerprint !== hash) throw new PipelineError('REQUEST_CONFLICT', 'Этот идентификатор уже использован для другого сообщения.', 409);
      return { job_id: requestId, accepted: true, chat_id: chat.chat_id, duplicate: true };
    }
    if (this.active.has(chat.chat_id)) throw new PipelineError('BUSY', 'Дождитесь завершения текущего запроса.', 409);
    const feature_snapshot=this.runtime.ctx.octoportPlugins.snapshot(scope);
    const job = { ...scope, feature_snapshot,plugin_intent:this.runtime.ctx.octoportPlugins.intent({...scope,feature_snapshot},input.text),job_id: requestId, key, fingerprint: hash, chat_id: chat.chat_id, text: input.text, message_id: `request-${key}`, started_at: Date.now(), state: 'queued', finished: false, error: null };
    this.store.data.jobs[key] = job;
    this.active.set(chat.chat_id, key);
    this.store.save();
    const run = this.run(job, chat).finally(() => this.runs.delete(run));
    this.runs.add(run);
    return { job_id: requestId, accepted: true, chat_id: chat.chat_id };
  }

  async run(job, chat) {
    let timer;
    try {
      const { agent } = await this.handle(chat);
      if (job.finished) return;
      job.state = 'running';
      this.store.save();
      const pending = { actor_id: job.actor_id, tenant_id: job.tenant_id, capabilities:job.capabilities,feature_snapshot:job.feature_snapshot,session_id: chat.chat_id, request_id: job.job_id, message_id: job.message_id, text: job.text };
      this.pending.set(chat.chat_id, pending);
      timer = setTimeout(() => {
        pending.failure = { code: 'REQUEST_TIMEOUT', message: 'Запрос не завершился вовремя. Повторная отправка автоматически не выполнялась.' };
        agent.cancel({ kind: 'hook', reason: 'request-timeout' });
      }, this.timeoutMs);
      timer.unref();
      agent.followup({ id: job.message_id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: job.text }] });
      await agent.whenIdle();
      await this.runtime.flush();
      if (pending.failure) {
        job.error = pending.failure;
        job.state = pending.failure.code === 'CANCELED' ? 'cancelled' : 'failed';
        if(pending.failureMeter)job.result={text:null,metadata:{state:job.state,meter:pending.failureMeter}};
      } else if (!pending.result) {
        job.error = { code: 'NO_RESULT', message: 'Harness не завершил обработку сообщения. Автоматического повтора не было.' };
        job.state = 'failed';
      } else {
        const last = agent.session.deriveMessages().at(-1);
        if (last?.role !== 'assistant' || messageText(last) !== pending.result.text) throw new Error('Harness did not commit the pipeline response');
        job.result = pending.result;
        job.assistant_message_id = last.id;
        job.state = 'completed';
      }
      if (chat.title === 'Новый разговор') chat.title = job.text.trim().slice(0,70);
    } catch (error) {
      job.error = publicError(error);
      job.state = 'failed';
    } finally {
      clearTimeout(timer);
      this.pending.delete(chat.chat_id);
      this.active.delete(chat.chat_id);
      job.finished = true;
      job.finished_at = Date.now();
      this.store.save();
    }
  }

  async status(input) {
    const scope = pluginScope(input), requestId = identity(input.job_id, 'job_id');
    const job = this.store.data.jobs[jobKey(scope, requestId)];
    if (!job) throw new PipelineError('JOB_NOT_FOUND', 'Запрос не найден.', 404);
    this.store.chat(scope, job.chat_id);
    const { messages } = await this.history({ ...scope, chat_id: job.chat_id });
    const view=this.runtime.ctx.octoportPlugins.project({...scope,session_id:job.chat_id,request_id:job.job_id},job.result);
    const hidden=job.plugin_intent?.required_capabilities.some(capability=>!scope.capabilities.includes(capability));
    // A later turn may already exist in history. Correlate this receipt with its
    // committed native message instead of selecting the latest assistant.
    const message = job.assistant_message_id && job.result ? { id: job.assistant_message_id, role: 'assistant', text: view.text,metadata:view.metadata,usage:view.usage,...(view.presentation?{presentation:view.presentation}:{}) } : null;
    return { job_id: job.job_id, chat_id: job.chat_id, finished: job.finished, state: job.state, messages, message, assistant_message_id: job.assistant_message_id ?? null, text:view.text,presentation:view.presentation,error:hidden&&job.error?{code:'PLUGIN_UNAVAILABLE',message:'Ответ плагина доступен только авторизованному разработчику.'}:job.error,usage:view.usage,metadata:view.metadata };
  }

  async cancel(input) {
    const scope = owner(input), chat = this.store.chat(scope, input.chat_id);
    const key = this.active.get(chat.chat_id);
    if (!key) return { ok: true, canceled: false };
    const pending = this.pending.get(chat.chat_id);
    if (pending) pending.failure = { code: 'CANCELED', message: 'Запрос остановлен.' };
    else {
      const job = this.store.data.jobs[key];
      job.finished = true;
      job.state = 'cancelled';
      job.error = { code: 'CANCELED', message: 'Запрос остановлен до отправки.' };
    }
    this.handles.get(chat.chat_id)?.agent.cancel({ kind: 'user' });
    this.store.save();
    return { ok: true, canceled: true };
  }

  health() {
    return { ok: !this.closing, harness_version: this.runtime.version, provider: PROVIDER, model: MODEL, default_api_key_configured: this.runtime.officialProviderConfigured, active_jobs: this.active.size };
  }

  async close() {
    this.closing = true;
    for (const handle of this.handles.values()) handle.agent.cancel({ kind: 'disposed' });
    await Promise.allSettled([...this.runs]);
    for (const handle of this.handles.values()) await handle.dispose();
    await this.runtime.flush();
    await this.runtime.close();
  }
}
