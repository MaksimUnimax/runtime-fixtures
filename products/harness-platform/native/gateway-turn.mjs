import { runNativeTurn } from './model-turn.mjs';

/** The credential belongs to this adapter instance and is never set on the process. */
export async function runGatewayTurn({ gatewayUrl, model, grant, signal, onTransport, ...turn }) {
  const { DeepSeekAdapter, resolveAdapterOptions } = await turn.load('dsh-llm-deepseek');
  // Preserve chronological system updates from the provider profile. Send the full
  // active tool list each time: the first attachment to an empty chat cannot
  // use deferred additions because DeepSeek requires an immediately active tool.
  const profile = resolveAdapterOptions({}).models.find(entry => entry.id === model);
  const options = resolveAdapterOptions({
    baseURL: gatewayUrl, maxTokens: 4096,
    models: [{id: model, systemPromptUpdate: profile?.systemPromptUpdate}],
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
