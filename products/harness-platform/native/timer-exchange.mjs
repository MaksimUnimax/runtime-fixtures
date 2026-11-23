// Append a finished setup exchange or a scheduled assistant reply through the native session.
export async function appendTimerExchange({req,key,ctx,load,mount,dispatch,previous,deleted,all,insert,visible,fail}) {
  if (typeof req.answer !== 'string' || !req.answer.trim() || typeof req.text !== 'string'
      || !/^[\w.-]{1,128}$/.test(req.requestId)) fail('invalid_request');
  req.inputKey = JSON.stringify([req.text,req.answer]);
  await mount(ctx,'dsh-session');
  const {createUserMessage,createAssistantMessage} = await load('dsh-llm');
  return dispatch.atomic(() => {
    if (deleted.get(key)) fail('unavailable');
    const cached = previous(key,req);
    if (cached) return cached;
    dispatch.check(key,req);
    const rows=all.all(key);
    const seed=rows.flatMap(row=>JSON.parse(row.events));
    const createdAt=rows[0]?.created_at ?? Date.now();
    const session=ctx.sessions.create(key,{seed,meta:{createdAt}});
    const turn=(seed.findLast(e=>e.type==='turn/start')?.data?.turn ?? 0)+1;
    const step={turn,step:1};
    session.append('turn/start',{turn});
    session.append('step/start',step);
    if (req.text) session.append('user/message',createUserMessage({
      source:{kind:'user',rpcId:req.requestId},content:[{type:'text',text:req.text}]
    }),{surfaceOp:'append'});
    const message=createAssistantMessage({source:{provider:'octoport',model:'timer'},
      content:[{type:'text',text:req.answer}]});
    session.append('assistant/message',{...step,message,stream:[]},{surfaceOp:'append'});
    session.append('step/end',step);
    session.append('turn/end',{turn,reason:{kind:'completed'}});
    const delta=session.snapshotEvents(seed.length);
    insert.run(key,rows.length,req.requestId,req.action,req.inputKey,createdAt,JSON.stringify(delta));
    return visible(delta,req.requestId).at(-1);
  });
}
