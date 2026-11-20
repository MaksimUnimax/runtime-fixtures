import { createTrajectoryProps } from './trajectory.js';

const noop = () => {};
const none = () => null;
const value = snapshot => selector => selector(snapshot);
const noMenu = { getTriggerProps: () => ({}) };
const noPositions = { read: none, save: noop };
const presentation = { mode: 'standard', collapseTiming: 'completion', foldedReplies: 'all' };
const chatSession = { openState: 'open', openError: null, running: false, pendingSubmissions: [], hasMore: false };
const unknownFile = async () => { throw new Error('Просмотр файлов недоступен'); };

// Register only the conversation views and message seats used by this embedding.
// These services have no filesystem, settings writer, host RPC or account lookup.
function viewRegistration(plugin, conversation) {
  const seats = new Map();
  const dictionaries = new Map();
  const noSettings = { getSnapshot: () => ({}), subscribe: () => noop };
  const lifetime = { effect: fn => fn() ?? noop };
  const eventsRegistry = new conversation.ConversationEventRegistry(lifetime);
  const viewsRegistry = new conversation.ConversationViewRegistry(lifetime);
  const save = (slot, component) => {
    seats.set([slot.name, slot.key ?? slot.id].filter(Boolean).join('/'), component);
    return noop;
  };
  const locale = {
    register(name, languages) { dictionaries.set(name, languages.ru); return noop; },
    bind(name) { return (key, args = {}) => {
      const text = dictionaries.get(name)?.[key] ?? key;
      return typeof text === 'string' ? text.replace(/\{(\w+)\}/g, (_, k) => args[k] ?? '') : key;
    }; },
  };
  const ctx = {
    ...lifetime, locale, inject: noop,
    get: key => key === 'connection' ? { state: noSettings } : undefined,
    configForms: { get: () => noSettings }, uiSession: { provide: noop },
    uiConversation: {
      events: eventsRegistry, views: viewsRegistry, groups: { register: noop },
      inspectSystemPrompt: conversation.UiConversation.prototype.inspectSystemPrompt,
      inspectRequestPrompt: conversation.inspectRequestPrompt,
    },
    slots: {
      register: save, registerFactory: save,
      inject(name, fn) {
        if (name === 'conversation.view' || name === 'conversation.chat.node') fn();
      },
    },
  };
  plugin.apply(ctx);
  return { seats, eventsRegistry, viewsRegistry, t: locale.bind([...dictionaries.keys()][0]) };
}

function costLabel({ rub, usd }) {
  if (typeof rub === 'string') return 'Оценка стоимости · ' + rub.replace('.', ',') + ' ₽';
  if (typeof usd === 'string') return 'Оценка стоимости · ' + usd.replace('.', ',') + ' USD';
  return 'Оценка стоимости пока недоступна';
}

export function installWidgetHost({ require, plugin }) {
  const React = require('react');
  const h = React.createElement;
  const { createRoot } = require('react-dom/client');
  const { flushSync } = require('react-dom');
  const conversation = plugin('dsh-client-ui-conversation');
  const chat = viewRegistration(plugin('dsh-client-ui-chat'), conversation);
  const trajectory = viewRegistration(plugin('dsh-client-ui-trajectory'), conversation);
  const trajectoryProps = createTrajectoryProps({ React, conversation, ...trajectory });
  const roots = new WeakMap();

  function chatView({ messages, events, chatId }) {
    const { seats, t } = chat;
    const messageEvents = events.filter(event => ['user/message', 'assistant/message'].includes(event.type));
    const nodes = messages.map((message, index) => {
      const event = messageEvents[index];
      const base = { key: message.requestId + '/' + message.role, anchorSeq: event?.seq ?? index,
        location: { kind: 'session' } };
      if (message.role === 'user') return { ...base, kind: 'user', data: {
        source: { kind: 'user' }, time: event?.time, content: [{ type: 'text', text: message.text }],
      } };
      return { ...base, kind: 'assistant-step', data: {
        status: 'settled', blocks: [{ kind: 'text', text: message.text }],
      } };
    });
    const byKey = new Map(nodes.map(n => [n.key, n]));
    const snapshot = { order: [...byKey.keys()], nodes: byKey, navigation: { items: () => [] } };
    function renderFactorySlot(name, props) {
      if (name === 'conversation.user.text') return props.text;
      if (name === 'conversation.chat.user.content') return h(seats.get(name), {
        ...props, renderFactorySlot, renderSlot: none, t,
      });
      return null;
    }
    const renderFlow = name => name === 'conversation.chat.flow' && nodes.map((node, index) =>
      h('div', { key: node.key, 'data-event-seq': node.anchorSeq, 'data-role': node.kind === 'user' ? 'user' : 'assistant' },
        h(seats.get('conversation.chat.node/' + node.kind), { node, t, sessionId: chatId, renderFactorySlot,
          renderSlotChain: none, renderSlot: none, usePresentation: value(presentation), useTurnData: none,
          useContextMenu: () => noMenu, resolveFilePath: path => path, loadImage: unknownFile }),
        node.kind === 'assistant-step' && messages[index].modelCost
          ? h('small', { className: 'model-cost' }, costLabel(messages[index].modelCost)) : null));
    return h(seats.get('conversation.view/chat'), {
      key: chatId, sessionId: chatId, t, useChat: value(snapshot), useSession: value(chatSession),
      useConversation: value({ views: { grouped: none } }), useSessions: value({ byId: {} }),
      usePresentation: value(presentation), useInteractionIds: value([]), dispatchInteraction: none,
      useProjection: none, useContextMenu: () => noMenu, resolveFilePath: path => path,
      chatScroll: noPositions, loadOlder: async () => false, loadThrough: async () => false,
      loadImage: unknownFile, openFile: unknownFile, openExternalLink: url => {
        const target = new URL(url, location.origin);
        if (['https:', 'http:'].includes(target.protocol)) window.open(target.href, '_blank', 'noopener,noreferrer');
      }, renderSlot: renderFlow,
    });
  }

  return (container, state) => {
    let root = roots.get(container);
    if (!root) { root = createRoot(container); roots.set(container, root); }
    const view = state.view === 'trajectory' ?
      h(trajectory.seats.get('conversation.view/trajectory'), trajectoryProps(state.events, state.chatId, trajectory.t)) :
      chatView(state);
    flushSync(() => root.render(view));
  };
}
