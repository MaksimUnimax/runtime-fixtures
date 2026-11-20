import { runNativeTurn } from './model-turn.mjs';

/** The credential belongs to this adapter instance and is never set on the process. */
export async function runGatewayTurn({ gatewayUrl, model, grant, signal, onTransport, ...turn }) {
  const { DeepSeekAdapter, resolveAdapterOptions } = await turn.load('dsh-llm-deepseek');
  const options = resolveAdapterOptions({
    baseURL: gatewayUrl, models: [{ id: model }], maxTokens: 4096,
  });
  const adapter = new DeepSeekAdapter({
    options: () => options,
    resolveAuth: async () => {
      onTransport();
      return { headers: { 'x-api-key': grant.token } };
    },
    resolveUserId: () => 'platform-chat-service',
    prepareExtensions: async () => ({ fields: {}, accept() {} }),
  });
  return runNativeTurn({ ...turn, provider: 'platform-gateway', model, adapter, signal });
}
