// Projection for the browser's stock Chat and Trajectory views. Internal model
// requests, private prompts and unrecognized event data stay in the native log.
export function publicEvents(events) {
  const displayed = [];
  for (const event of events) {
    const { type, seq, time, data } = event;
    const output = {};
    if (Number.isInteger(data.turn)) output.turn = data.turn;
    if (Number.isInteger(data.step)) output.step = data.step;
    if (type === 'user/message' || type === 'assistant/message') {
      const assistant = type === 'assistant/message';
      const message = assistant ? data.message : data;
      if (message?.role !== (assistant ? 'assistant' : 'user')) continue;
      if (!assistant && message.source?.kind === 'runtime-context') continue;
      const content = message.content
        .filter(block => block.type === 'text' && typeof block.text === 'string')
        .map(block => ({ type: 'text', text: block.text }));
      if (!content.length) continue;
      const visible = { id: message.id, role: message.role, content,
        source: { kind: assistant ? 'model' : 'user' } };
      displayed.push({ type, seq, time, surfaceOp: 'append',
        data: assistant ? { ...output, message: visible } : visible });
    } else if (['session/end-seed', 'turn/start', 'step/start', 'step/end', 'turn/end'].includes(type)) {
      if (type === 'turn/end' && typeof data.reason?.kind === 'string') {
        output.reason = { kind: data.reason.kind };
      }
      displayed.push({ type, seq, time, data: output });
    }
  }
  return displayed;
}
