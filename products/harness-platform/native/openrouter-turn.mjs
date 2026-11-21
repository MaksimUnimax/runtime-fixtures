import { runNativeTurn } from './model-turn.mjs';

export function project(messages, tools, system, model) {
  const rows = system ? [{role:'system',content:system}] : [];
  for (const msg of messages) {
    const text = msg.content.filter(b=>b.type==='text').map(b=>b.text).join('\n');
    if (msg.role==='tool') {
      rows.push({role:'tool',tool_call_id:msg.toolCallId,content:text});
    } else {
      const calls = msg.content.filter(b=>b.type==='tool-call').map(b=>({
        id:b.id,type:'function',function:{name:b.name,arguments:b.arguments}
      }));
      if (text || calls.length) rows.push({role:msg.role==='developer'?'system':msg.role,content:text,
        ...(calls.length ? {tool_calls:calls} : {}),
        ...(msg.role==='assistant' && msg.source?.provider==='platform-openrouter' && msg.source.model===model
          && Array.isArray(msg.source.replayState?.response?.reasoning_details)
          ? {reasoning_details:msg.source.replayState.response.reasoning_details} : {})});
    }
  }
  return {messages:rows,...(tools?.length ? {tools:tools.map(({name,description,parameters})=>({
    type:'function',function:{name,description,parameters}
  }))} : {})};
}
export async function runRouterTurn({gatewayUrl,model,grant,onTransport,onWaitCancelled,signal,...turn}) {
  const llm=await turn.load('dsh-llm');
  let callsStarted = 0;
  class Adapter extends llm.LlmAdapter {
    async *stream(options) {
      options.signal?.throwIfAborted();
      const firstCall = ++callsStarted === 1;
      onTransport();
      const res=await fetch(gatewayUrl+'/complete',{method:'POST',signal:options.signal,
        headers:{'Content-Type':'application/json','x-operation':grant.token},
        body:JSON.stringify(project(options.messages,options.tools,options.system,model))});
      if(!res.ok) {
        // Only the first model call can be cancelled without losing a previous tool result.
        if(firstCall && res.status===409 && res.headers.get('x-octoport-wait')==='cancelled') onWaitCancelled();
        throw new Error('Model request failed');
      }
      const {message,finish_reason:reason}=await res.json();
      if(!['stop','length','tool_calls'].includes(reason))throw new Error('Incomplete model response');
      let index=0;
      if(message.content) {
        yield {type:'block-start',index,blockType:'text'};
        yield {type:'text-delta',index,text:message.content};
        yield {type:'block-end',index,block:{type:'text',text:message.content}};
        index++;
      }
      for(const call of message.tool_calls||[]) {
        const block={type:'tool-call',id:call.id,name:call.function.name,arguments:call.function.arguments};
        yield {type:'block-start',index,blockType:'tool-call'};
        yield {type:'tool-call-delta',index,id:block.id,name:block.name,argumentsDelta:block.arguments};
        yield {type:'block-end',index,block};
        index++;
      }
      if(!index)throw new Error('Empty model response');
      yield {type:'finish',...(message.reasoning_details?.length ? {replayState:{response:{reasoning_details:message.reasoning_details}}} : {}),reason:{kind:reason==='length'?'max-tokens':reason==='tool_calls'?'tool-calls':'stop'}};
    }
  }
  return runNativeTurn({...turn,provider:'platform-openrouter',model,adapter:new Adapter(),signal});
}
