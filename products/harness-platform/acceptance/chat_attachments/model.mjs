export function createAdapter({LlmAdapter}) {
  return new class extends LlmAdapter {
    async *stream({messages}) {
      const result = messages.findLast(message=>message.role==='toolResult' || message.role==='tool');
      if (!result) {
        const block = {type:'tool-call', id:'list-files', name:'read_chat_file', arguments:{}};
        yield {type:'block-start',index:0,blockType:block.type};
        yield {type:'block-end',index:0,block};
        yield {type:'finish',reason:{kind:'tool-use'}};
        return;
      }
      const text = result.content.find(block=>block.type==='text')?.text ?? '';
      if (result.toolCallId === 'list-files') {
        const files = JSON.parse(text);
        const block = {type:'tool-call', id:'read-file', name:'read_chat_file', arguments:{id:files.at(-1).attachmentId}};
        yield {type:'block-start',index:0,blockType:block.type};
        yield {type:'block-end',index:0,block};
        yield {type:'finish',reason:{kind:'tool-use'}};
        return;
      }
      yield {type:'block-start',index:0,blockType:'text'};
      yield {type:'text-delta',index:0,text};
      yield {type:'block-end',index:0,block:{type:'text',text}};
      yield {type:'finish',reason:{kind:'stop'}};
    }
  }();
}
