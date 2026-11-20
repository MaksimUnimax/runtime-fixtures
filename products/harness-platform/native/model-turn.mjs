/** Run the same native Session, Agent, tool executor and loop for both transports. */
export async function runNativeTurn({ load, ctx, chatId, seed, text, requestId, provider, model, adapter, signal, progress }) {
  const llm = await load('dsh-llm');
  // The worker supplies a fresh Context with sessions, tools and system prompt.
  for (const name of ['dsh-llm', 'dsh-session-projection', 'dsh-tool-executor-native', 'dsh-agent', 'dsh-agent-loop']) {
    const plugin = name === 'dsh-llm' ? llm : await load(name);
    const fiber = ctx.plugin(plugin.default ?? plugin, {});
    await fiber.await();
    if (fiber._error) throw fiber._error;
  }
  if (progress) {
    const prepare=adapter.prepareCall.bind(adapter);
    adapter.prepareCall=async (...args)=>{
      const call=await prepare(...args);
      return {...call,stream:options=>observe(call.stream(options))};
    };
    async function* observe(chunks) {
      progress({stage:'model'});
      let state='model', buffer='', last=0;
      const flush=()=>{if(buffer){progress({stage:'writing',text:buffer});buffer='';last=Date.now();}};
      try {
        for await(const chunk of chunks) {
          if(chunk.type==='reasoning-delta' && state!=='thinking'){state='thinking';progress({stage:'thinking'});}
          if(chunk.type==='text-delta'){state='writing';buffer+=chunk.text;if(Date.now()-last>=65)flush();}
          if(chunk.type==='block-start' && chunk.blockType==='tool-call'){flush();progress({stage:'tool'});}
          yield chunk;
        }
      } finally {flush();}
    };
  }
  const unregister = ctx.llm.registerAdapter([provider], adapter);
  try {
    const handle = await ctx.agents.create({
      sessionId: chatId, seed, agentOptions: { provider, model },
    });
    try {
      const { agent } = handle;
      // A restored Harness session remembers its previous model in its event log.
      const previous = agent.model.current();
      if (previous?.provider !== provider || previous?.model !== model) {
        agent.model.select({ provider, model });
      }
      const cancel = () => agent.cancel({ kind: 'user' });
      signal?.throwIfAborted();
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        agent.followup({
          role: 'user', id: requestId, content: [{ type: 'text', text }], source: { kind: 'user' },
        });
        await agent.whenIdle();
        signal?.throwIfAborted();
      } finally {
        signal?.removeEventListener('abort', cancel);
      }
      const events = agent.session.snapshotEvents();
      const reply = agent.session.deriveMessages().at(-1);
      const delta = events.slice(seed.length);
      adapter.validateTurn?.({ events: delta, reply });
      const terminal = delta.findLast(event => event.type === 'turn/end');
      if (!['completed', 'max-tokens'].includes(terminal?.data.reason?.kind) || reply?.role !== 'assistant' ||
          !delta.some(event => event.type === 'assistant/message')) {
        throw new Error('Native agent did not complete the turn');
      }
      return { reply: reply.content.filter(b => b.type === 'text').map(b => b.text).join(''), events };
    } finally {
      await handle.dispose();
    }
  } finally {
    unregister();
  }
}
