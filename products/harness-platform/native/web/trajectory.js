// Bind the official TrajectoryView to the product's public native event window.
// The upstream assembler owns turn grouping, input records and request timing.
export function createTrajectoryProps({ React, conversation, eventsRegistry, viewsRegistry }) {
  const snapshots = new WeakMap();
  const listeners = new Set();
  let actualDuration = false;
  const subscribe = listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const readDuration = () => actualDuration;
  const setActualDuration = value => {
    if (value === actualDuration) return;
    actualDuration = value;
    for (const listener of listeners) listener();
  };

  return function trajectoryProps(events, chatId, t) {
    let snapshot = snapshots.get(events);
    if (!snapshot) {
      const assembler = new conversation.ConversationNodeAssembler(eventsRegistry, viewsRegistry);
      const entries = events.map(event => {
        // Public transcripts have terminal text, but deliberately omit token streams.
        // An empty stream preserves the native renderer's "unknown first token" value.
        if (event.type === 'assistant/message') {
          event = { ...event, data: { ...event.data, stream: [] } };
        }
        return { type: 'event', event };
      });
      assembler.replaceWindow(entries, false);
      assembler.activateTarget('trajectory');
      snapshot = assembler.get('trajectory');
      if (!snapshot) throw new Error('Native trajectory view was not registered');
      snapshots.set(events, snapshot);
    }
    const session = { id: chatId, openState: 'ready', hasMore: false, loadingOlder: false };
    return {
      t,
      useSession: select => select(session),
      useTrajectory: select => select(snapshot),
      useDuration: select => select(React.useSyncExternalStore(subscribe, readDuration)),
      setActualDuration,
      loadOlder: async () => false,
      renderSlot: () => null,
    };
  };
}
