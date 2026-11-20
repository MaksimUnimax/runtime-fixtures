// Offline acceptance model. Its reply is the current turn's actual MCP result.
import { randomUUID } from 'node:crypto';

function plainText(message) {
  return message.content.filter(block => block.type === 'text').map(block => block.text).join('');
}

function requestedDay(text) {
  const dates = text.match(/(?<![\d-])\d{4}-\d{2}-\d{2}(?![\d-])/g) ?? [];
  const parsed = dates.length === 1 && new Date(dates[0] + 'T00:00:00Z');
  if (!parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dates[0]) {
    throw new Error('Provide one calendar date in YYYY-MM-DD format');
  }
  return dates[0];
}

function toolReport(message, callId) {
  if (message?.role !== 'tool' || message.toolCallId !== callId || message.isError) {
    throw new Error('The report tool did not return a successful result');
  }
  const { result } = JSON.parse(plainText(message));
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('The report tool returned an invalid response');
  }
  return result;
}

export function createAdapter(llm) {
  const callId = randomUUID();
  return new class extends llm.LlmAdapter {
    steps = 0;
    error;

    async *stream({ messages, tools, signal }) {
      try {
        signal?.throwIfAborted();
        this.steps++;
        if (this.steps === 1) {
          const user = messages.findLast(message => message.role === 'user' && message.source?.kind === 'user');
          const [tool] = tools ?? [];
          if (!user || tools?.length !== 1 || tool.parameters?.properties?.date?.type !== 'string') {
            throw new Error('This chat requires one available tool accepting a date');
          }
          const args = JSON.stringify({ date: requestedDay(plainText(user)) });
          yield { type: 'block-start', index: 0, blockType: 'tool-call' };
          yield { type: 'tool-call-delta', index: 0, id: callId, name: tool.name, argumentsDelta: args };
          yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name: tool.name, arguments: args } };
          yield { type: 'finish', reason: { kind: 'tool-calls' } };
          return;
        }
        if (this.steps !== 2) throw new Error('Unexpected extra model step');
        const reply = JSON.stringify(toolReport(messages.findLast(message => message.role === 'tool'), callId));
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text: reply };
        yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      } catch (error) {
        this.error = error;
        throw error;
      }
    }

    validateTurn({ events, reply }) {
      if (this.error) throw this.error;
      const calls = events.filter(event => event.type === 'tool/call');
      const results = events.filter(event => event.type === 'tool/result');
      if (this.steps !== 2 || calls.length !== 1 || results.length !== 1 ||
          calls[0].data.callId !== callId || calls[0].seq >= results[0].seq) {
        throw new Error('The native Session did not record one complete tool call');
      }
      const report = toolReport(results[0].data.message, callId);
      if (reply?.role !== 'assistant' || plainText(reply) !== JSON.stringify(report)) {
        throw new Error('The final assistant message differs from the tool result');
      }
    }
  }();
}
