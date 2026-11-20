import test from 'node:test';
import assert from 'node:assert/strict';
import { publicEvents } from './public-events.mjs';

test('the browser receives visible text and lifecycle without private event payloads', () => {
  const message = { role: 'assistant', id: 'reply', content: [
    { type: 'reasoning', text: 'private' }, { type: 'text', text: 'public', metadata: 'private' },
  ], source: { kind: 'model', private: true } };
  const entries = ['system/message', 'request/header', 'assistant/message', 'turn/end']
    .map((type, seq) => ({ type, seq, time: 42, data: { turn: 1, step: 1, message,
      reason: { kind: 'completed', diagnostic: 'private' }, stream: ['private'] } }));
  const exposed = publicEvents(entries);
  assert.deepEqual(exposed.map(e => e.type), ['assistant/message', 'turn/end']);
  assert.equal(exposed[0].seq, 2);
  assert.deepEqual(exposed[0].data.message.content, [{ type: 'text', text: 'public' }]);
  assert.ok(!JSON.stringify(exposed).includes('private'));
});
