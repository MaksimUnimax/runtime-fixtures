import { PipelineError } from './provider.mjs';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export function createPipelineClient({ url, serviceKey, timeoutMs = 600000, fetchImpl = fetch }) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname)) {
    throw new Error('Pipeline endpoint must be loopback HTTP; external transports require an explicit deployment change.');
  }
  if (typeof serviceKey !== 'string' || serviceKey.trim().length < 32) throw new Error('Service credential is missing.');
  const key = serviceKey.trim();
  return async function execute(payload, signal) {
    const deadline = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: combined,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new PipelineError(deadline.aborted ? 'PIPELINE_TIMEOUT' : 'PIPELINE_UNAVAILABLE',
        deadline.aborted ? 'Запрос не завершился вовремя. Повторная отправка автоматически не выполнялась.' : 'Сервис шаблонов временно недоступен.', 503);
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) throw new PipelineError('PIPELINE_RESPONSE_TOO_LARGE', 'Ответ превышает допустимый размер.', 502);
      chunks.push(chunk);
    }
    let result;
    try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new PipelineError('INVALID_PIPELINE_RESPONSE', 'Сервис шаблонов вернул некорректный ответ.', 502); }
    if (!response.ok) {
      const code = typeof result.code === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/.test(result.code) ? result.code : 'PIPELINE_REJECTED';
      const message = typeof result.error === 'string' ? result.error : 'Запрос отклонён сервисом шаблонов.';
      const sanitized = message.replaceAll(key, '[скрыто]').replace(/(?:sk-[A-Za-z0-9_-]{10,}|Bearer\s+\S+)/g, '[скрыто]').slice(0,700);
      throw new PipelineError(code, sanitized, response.status);
    }
    return result;
  };
}
