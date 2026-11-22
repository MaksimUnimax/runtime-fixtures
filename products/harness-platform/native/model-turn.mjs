import { projectCompletedKnowledge } from './octopus-knowledge.mjs';

/** Run the same native Session, Agent, tool executor and loop for both transports. */
export async function runNativeTurn({ load, ctx, chatId, seed, text, requestId, provider, model, reasoningEffort, adapter, signal, progress, restore, capture }) {
  const llm = await load('dsh-llm');
  // The worker supplies a fresh Context with sessions, tools and system prompt.
  for (const name of ['dsh-llm', 'dsh-session-projection', 'dsh-tool-executor-native', 'dsh-agent', 'dsh-agent-loop']) {
    const plugin = name === 'dsh-llm' ? llm : await load(name);
    const fiber = ctx.plugin(plugin.default ?? plugin, {});
    await fiber.await();
    if (fiber._error) throw fiber._error;
  }
  {
    const project = projectCompletedKnowledge(seed);
    const prepare=adapter.prepareCall.bind(adapter);
    adapter.prepareCall=async (...args)=>{
      const call=await prepare(...args);
      return {...call,stream:options=>{
        const chunks=call.stream({...options,messages:project(options.messages)});
        return progress ? observe(chunks) : chunks;
      }};
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
    const selection = {provider, model, ...(reasoningEffort ? {reasoningEffort} : {})};
    const handle = await ctx.agents.create({
      sessionId: chatId, seed: restore ? [...seed,...restore.events] : seed, agentOptions: selection,
    });
    try {
      const { agent } = handle;
      if(capture) capture.snapshot=()=>agent.session.snapshotEvents(seed.length);
      // A restored Harness session remembers its previous model in its event log.
      const previous = agent.model.current();
      if (previous?.provider !== provider || previous?.model !== model ||
          previous?.reasoningEffort !== reasoningEffort) {
        agent.model.select(selection);
      }
      const cancel = () => agent.cancel({ kind: 'user' });
      signal?.throwIfAborted();
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        agent.followup({
          role:'user', id:restore ? 'resume-'+restore.attempt : requestId,
          content:[{type:'text',text:restore ? '' : text}],
          source:{kind:restore ? 'runtime-context' : 'user'},
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
