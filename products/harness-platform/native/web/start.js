try {
  const {isPrivatePaste} = await import('./private-input.js');
  // The browser applies each stylesheet as it arrives. A missing stylesheet or
  // a lost load event must never gate the session and the chat renderer.
  for (const link of document.querySelectorAll('link[data-chat-style]')) {
    link.rel = 'stylesheet';
  }
  const data = document.body.dataset;
  const guest = data.mode === 'guest';
  const initial = data.account ? JSON.parse(data.account) : {};
  const chat = !data.panel && (data.chat || initial.chats?.at(-1));
  const initialHistory = chat ? fetch((guest ? '/guest' : '/api')+'/chats/'+encodeURIComponent(chat)+'/events', {
    credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(60_000)
  }).then(async response => {
    if (!response.ok) {
      if (response.status===401) location.replace('/login');
      throw Object.assign(new Error('Не удалось загрузить историю чата.'), {status:response.status});
    }
    return response.json();
  }) : undefined;
  const opening = document.getElementById('chat-opening');
  const draft = document.getElementById('opening-draft');
  let composing = false;
  if (chat && draft) {
    draft.addEventListener('paste', event => {
      if (isPrivatePaste(event.clipboardData?.getData('text/plain') || '')) {
        event.preventDefault();
        opening.querySelector('[role="status"]').textContent = 'Для вставки ключа дождитесь открытия подключений.';
      }
    });
    draft.hidden = false;
    opening.classList.add('with-draft');
    draft.addEventListener('input', () => {
      if (draft.value) opening.querySelector('[role="status"]').textContent = 'Отправка будет доступна после загрузки чата.';
    }, {once:true});
    draft.addEventListener('compositionstart', () => { composing = true; });
    draft.addEventListener('compositionend', () => { composing = false; setTimeout(() => opening.dispatchEvent(new Event('draft-ready')), 0); });
  }
  if (initialHistory) {
    initialHistory.then(result => {
      if (!opening?.querySelector('.opening-history') || !opening.isConnected) return;
      const messages = guest ? (result.turns || []).slice(-4).flatMap(turn => [
        {role:'user', text:turn.text}, {role:'assistant', text:turn.answer}
      ]) : (result.messages || []).slice(-8);
      const fragment = document.createDocumentFragment();
      for (const message of messages) {
        if (!['user','assistant'].includes(message.role) || !message.text) continue;
        const paragraph = document.createElement('p');
        paragraph.className = 'opening-message ' + message.role;
        paragraph.textContent = message.text;
        fragment.append(paragraph);
      }
      if (fragment.childElementCount) {
        const history = opening.querySelector('.opening-history');
        history.replaceChildren(fragment);
        opening.classList.add('has-history');
        history.scrollTop = history.scrollHeight;
      }
    }, () => {});
  }
  const {createTransport} = await import('./transport.js');
  const transport = await createTransport(data, initialHistory);
  window.harnessAccount = transport.account;
  window.__DSH_TRANSPORT__ = {rpc: transport.rpc};
  window.__DSH_FILE_UPLOAD__ = {fetch: (path, options) => fetch(new URL(path, document.baseURI), {
    ...options, credentials:'same-origin', cache:'no-store',
  })};
  window.__DSH_REMOTE_ACCESS__ = transport.access();
  window.__DSH_LOCALE__ = {read:async () => ({languages:['ru'], preference:'ru'}), onChange() {}};
  window.__DSH_SHORTCUTS_CONFIG__ = {stopSequenceMs:500};
  (window.__DSH_BOOT_READY__ ??= Promise.withResolvers()).resolve();
  await import(document.querySelector('[data-chat-entry]').href);
  // The entry resolves before Cordis has mounted the application. Keep readable
  // history on screen until the native renderer actually takes over.
  const root = document.getElementById('root');
  const observer = new MutationObserver(updateOpening);
  function updateOpening() {
    const editor = root.querySelector('[data-composer-input]');
    if (editor || (data.panel && root.querySelector('dialog[open],[role="dialog"]'))) {
      if (composing) return;
      if (draft?.value) {
        const visibleChat = location.pathname.match(/^\/app\/chats\/([^/]+)\/?$/)?.[1];
        const rootRoute = ['/', '/app/'].includes(location.pathname);
        const sameChat = visibleChat === chat || (rootRoute && transport.account.selected === chat);
        if (!sameChat || !editor?.isContentEditable) {
          opening.classList.add('draft-recovery');
          opening.querySelector('[role="status"]').textContent = 'Черновик сохранён в этом поле. Можно скопировать текст.';
          return;
        }
        // Let the native editor update its own model, preserving any restored draft.
        editor.focus({preventScroll:true});
        const end = document.createRange();
        end.selectNodeContents(editor);
        end.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(end);
        if (!document.execCommand('insertText', false, draft.value)) {
          opening.classList.add('draft-recovery');
          opening.querySelector('[role="status"]').textContent = 'Скопируйте черновик в поле сообщения.';
          return;
        }
        draft.value = '';
      }
      observer.disconnect();
      opening.remove();
      return;
    }
    const boot = root.querySelector('[data-dsh-boot]');
    if (boot && !boot.querySelector('[data-dsh-boot-spinner]')) {
      // The pinned renderer reports a bundle failure by replacing its spinner.
      opening.classList.add('failed');
      const retry = opening.querySelector('button');
      if (retry) {
        retry.hidden = false;
        if (draft?.value) retry.textContent = 'Открыть заново без черновика';
      }
      opening.querySelector('[role="status"]').textContent = 'Не удалось загрузить интерфейс чата.';
    }
  }
  opening.addEventListener('draft-ready', updateOpening);
  observer.observe(root, {childList:true, subtree:true, attributes:true, attributeFilter:['contenteditable']});
  updateOpening();
} catch (error) {
  const opening = document.getElementById('chat-opening');
  if (opening) {
    opening.classList.add('failed');
    const retry = opening.querySelector('button');
    if (retry) {
      retry.hidden = false;
      if (opening.querySelector('textarea')?.value) retry.textContent = 'Открыть заново без черновика';
    }
    opening.querySelector('[role="status"]').textContent = 'Не удалось открыть чат.';
  }
  console.error('Harness startup failed', error);
}
