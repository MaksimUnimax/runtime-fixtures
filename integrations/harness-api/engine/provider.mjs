/** Native DeepSeek Harness adapter for the existing Alisa template pipeline. */
export const PROVIDER = 'octoport-templates';
export const MODEL = 'alisa-matrix';

export class PipelineError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function latestHumanMessage(options) {
  if (options.purpose !== undefined) {
    throw new PipelineError('AUXILIARY_CALL_REFUSED', 'Вызов шаблонов разрешён только для сообщения пользователя.');
  }
  if (typeof options.sessionId !== 'string' || !options.sessionId) {
    throw new PipelineError('SESSION_SCOPE_REQUIRED', 'Не определён владелец разговора.');
  }
  const message = [...(options.messages || [])].reverse().find(item =>
    item.role === 'user' && item.source?.kind === 'user' && typeof item.id === 'string');
  if (!message) throw new PipelineError('USER_MESSAGE_REQUIRED', 'Отсутствует сообщение пользователя.');
  if (!Array.isArray(message.content) || message.content.some(block => block.type !== 'text')) {
    throw new PipelineError('TEXT_ONLY', 'В этом чате поддерживаются текстовые вопросы.');
  }
  return { id: message.id, text: message.content.map(block => block.text).join('\n') };
}

/** Harness rc.1 counts cache hits separately from uncached input tokens. */
export function harnessUsage(usage) {
  if (usage === undefined || usage === null) return undefined;
  const integer = (value, label) => {
    if (!Number.isSafeInteger(value) || value < 0) throw new PipelineError('INVALID_USAGE', `Некорректный счётчик ${label}.`, 502);
    return value;
  };
  const prompt = integer(usage.prompt_tokens, 'prompt_tokens');
  const output = integer(usage.completion_tokens, 'completion_tokens');
  const hit = integer(usage.prompt_cache_hit_tokens ?? 0, 'prompt_cache_hit_tokens');
  const miss = integer(usage.prompt_cache_miss_tokens ?? prompt - hit, 'prompt_cache_miss_tokens');
  if (miss + hit !== prompt) throw new PipelineError('INVALID_USAGE', 'Счётчики кэша не совпадают с общим числом входных токенов.', 502);
  const mapped = { inputTokens: miss, outputTokens: output, totalTokens: prompt + output };
  if (usage.prompt_cache_hit_tokens !== undefined) mapped.cacheReadTokens = hit;
  return mapped;
}

/** Dependencies are supplied by the installed Harness, not a copied agent loop. */
export function templateAdapterClass({ LlmAdapter, LlmError }) {
  return class TemplatePipelineAdapter extends LlmAdapter {
    constructor({ resolveScope, execute, recordResult, recordFailure, route }) {
      super();
      this.resolveScope = resolveScope;
      this.execute = execute;
      this.recordResult = recordResult;
      this.recordFailure = recordFailure;
      this.route = route;
    }

    providerInfo() { return { id: PROVIDER, name: 'Octoport · матрица Алисы' }; }

    async listModels() {
      return [{ provider: PROVIDER, id: MODEL, name: 'DeepSeek API · шаблоны', inputModalities: ['text'] }];
    }

    async resolveModel(provider, model) {
      if (provider !== PROVIDER || model !== MODEL) {
        throw new LlmError('Этот режим чата не поддерживается.', 'MODEL_UNSUPPORTED');
      }
      return { provider, id: model, name: 'DeepSeek API · шаблоны', inputModalities: ['text'] };
    }

    async *stream(options) {
      let scope;
      try {
        options.signal?.throwIfAborted();
        const message = latestHumanMessage(options);
        scope = this.resolveScope(options.sessionId, message);
        if (!scope || scope.session_id !== options.sessionId || scope.message_id !== message.id || scope.text !== message.text) {
          throw new PipelineError('REQUEST_SCOPE_MISMATCH', 'Сообщение не соответствует авторизованному запросу.', 403);
        }
        const result = this.route ? await this.route(scope,message.text,options.signal) : await this.execute({
          actor_id: scope.actor_id,
          tenant_id: scope.tenant_id,
          session_id: scope.session_id,
          request_id: scope.request_id,
          text: message.text,
        }, options.signal);
        options.signal?.throwIfAborted();
        if (!result || typeof result.text !== 'string' || !result.text.trim()) {
          throw new PipelineError('EMPTY_PIPELINE_RESULT', 'Обработчик не вернул текст ответа.', 502);
        }
        const usage = harnessUsage(result.usage);
        this.recordResult(scope, result);
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text: result.text };
        yield { type: 'block-end', index: 0, block: { type: 'text', text: result.text } };
        if (usage) yield { type: 'usage', usage };
        yield { type: 'finish', reason: { kind: 'stop' } };
      } catch (error) {
        if (scope) this.recordFailure(scope, error);
        if (options.signal?.aborted) throw error;
        if (error instanceof LlmError) throw error;
        throw new LlmError(error instanceof PipelineError ? error.message : 'Обработчик запроса временно недоступен.',
          error instanceof PipelineError ? error.code : 'PIPELINE_UNAVAILABLE');
      }
    }
  };
}
