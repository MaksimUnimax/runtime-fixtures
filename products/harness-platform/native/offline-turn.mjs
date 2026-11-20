// Explicit local acceptance route. No network client or paid provider is mounted.
export async function runOfflineTurn({ load, ctx, chatId, seed, text, requestId, toolUnavailable }) {
  if (process.env.HARNESS_OFFLINE_MODEL !== '1') {
    throw new Error('Offline acceptance model is disabled');
  }

  const llm = await load('dsh-llm');
  class OfflineAdapter extends llm.LlmAdapter {
    async *stream({ messages, signal }) {
      signal?.throwIfAborted();
      const inputs = messages.filter(message => message.role === 'user' && message.source?.kind === 'user');
      const last = inputs.at(-1);
      if (!last) throw new Error('The model received no user message');
      const prompt = plainText(last);
      const previous = inputs.at(-2);
      const reply = `Тестовая модель (ход ${inputs.length}): ${prompt}` +
        (previous ? `\nПредыдущее сообщение: ${plainText(previous)}` : '');
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: reply };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }

  // The worker supplies a fresh Context with sessions, tools and system prompt.
  for (const name of ['dsh-llm', 'dsh-session-projection', 'dsh-tool-executor-native', 'dsh-agent', 'dsh-agent-loop']) {
    const plugin = name === 'dsh-llm' ? llm : await load(name);
    const fiber = ctx.plugin(plugin.default ?? plugin, {});
    await fiber.await();
    if (fiber._error) throw fiber._error;
  }
  const provider = 'platform-offline';
  const fixture = process.env.HARNESS_OFFLINE_ADAPTER;
  let adapter;
  if (fixture) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(fixture)) throw new Error('Invalid offline adapter name');
    const { createAdapter } = await import(`../acceptance/${fixture}/model.mjs`);
    adapter = createAdapter(llm, { toolUnavailable });
  } else {
    adapter = new OfflineAdapter();
  }
  const unregister = ctx.llm.registerAdapter([provider], adapter);
  try {
    const handle = await ctx.agents.create({
      sessionId: chatId, seed, agentOptions: { provider, model: fixture || 'acceptance-echo' },
    });
    try {
      const { agent } = handle;
      agent.followup({
        role: 'user', id: requestId, content: [{ type: 'text', text }], source: { kind: 'user' },
      });
      await agent.whenIdle();
      const events = agent.session.snapshotEvents();
      const reply = agent.session.deriveMessages().at(-1);
      adapter.validateTurn?.({ events: events.slice(seed.length), reply });
      if (reply?.role !== 'assistant' ||
          !events.slice(seed.length).some(event => event.type === 'assistant/message')) {
        throw new Error('Native agent did not complete the offline turn');
      }
      return { reply: plainText(reply), events };
    } finally {
      await handle.dispose();
    }
  } finally {
    unregister();
  }
}

function plainText(message) {
  return message.content.filter(block => block.type === 'text').map(block => block.text).join('');
}
