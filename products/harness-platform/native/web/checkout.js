(() => {
  const currency = new Intl.NumberFormat('ru-RU', {style:'currency', currency:'RUB'});
  const draftKey = 'octoport-checkout';
  let dialog;
  function saved() {
    try { return JSON.parse(sessionStorage.getItem(draftKey)) || {}; } catch { return {}; }
  }
  function save(data) {
    try { sessionStorage.setItem(draftKey, JSON.stringify(data)); } catch { /* Storage may be disabled. */ }
  }
  function openCheckout(initial = '100') {
    if (dialog?.open) return;
    const box = document.createElement('dialog');
    dialog = box;
    box.className = 'octo-checkout';
    box.setAttribute('aria-labelledby', 'checkout-heading');
    box.innerHTML = '<header><h2 id="checkout-heading">Купить монеты</h2><button type="button" aria-label="Закрыть">×</button></header>'
      + '<form><label>Количество монет<input name="coins" type="number" min="1" max="8000000" step="1" inputmode="numeric" required></label>'
      + '<p class="octo-checkout-total">Итого <output aria-live="polite">—</output></p>'
      + '<button class="octo-checkout-pay" type="submit" disabled>Оплатить</button><p role="status"></p></form>';
    document.body.append(box);
    const form = box.querySelector('form'), input = form.elements.coins;
    const output = box.querySelector('output'), pay = form.querySelector('button'), note = form.querySelector('[role=status]');
    const launcher = document.activeElement;
    input.value = /^[1-9]\d{0,6}$/.test(initial) && Number(initial)<=8000000 ? initial : '100';
    let confirmed, timer, current, submitting = false, waitingQuote = false;
    const initialDraft = saved();
    let key = initialDraft.key || crypto.randomUUID();
    let signature = initialDraft.signature;
    box.querySelector('header button').onclick = () => box.close();
    box.addEventListener('close', () => {
      clearTimeout(timer);
      current?.abort();
      box.remove();
      if (launcher?.isConnected) launcher.focus();
    }, {once:true});
    async function refresh() {
      clearTimeout(timer);
      current?.abort();
      confirmed = null;
      pay.disabled = true;
      output.textContent = '—';
      note.textContent = '';
      if (!input.validity.valid || !/^[1-9]\d*$/.test(input.value)) {
        note.textContent = 'Введите целое число от 1 до 8 000 000.';
        return;
      }
      const count = input.value;
      const controller = new AbortController();
      current = controller;
      timer = setTimeout(async () => {
        try {
          const r = await fetch('/api/coins/quote?coins='+encodeURIComponent(count), {cache:'no-store', signal:controller.signal});
          if (!r.ok) throw Error();
          const data = await r.json();
          if (controller.signal.aborted) return;
          if (!/^\d+\.\d{2}$/.test(data.total) || typeof data.enabled !== 'boolean') throw Error();
          confirmed = {count, total:data.total};
          if (signature !== count+':'+data.total) {
            key = crypto.randomUUID();
            signature = count+':'+data.total;
          }
          output.textContent = currency.format(data.total);
          pay.disabled = !data.enabled;
          if (!data.enabled) note.textContent = 'Приём платежей пока недоступен.';
        } catch {
          if (!controller.signal.aborted) note.textContent = 'Не удалось загрузить сумму. Откройте форму ещё раз.';
        }
      }, 120);
    }
    input.addEventListener('input', refresh);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (submitting || pay.disabled || !confirmed || confirmed.count !== input.value) return;
      submitting = true;
      input.disabled = pay.disabled = true;
      note.textContent = 'Открываем оплату…';
      const draft = {count:confirmed.count, key, signature};
      save(draft);
      try {
        const r = await fetch('/api/coins/checkout', {method:'POST',
          body:new URLSearchParams({coins:confirmed.count, total:confirmed.total, key})});
        if (r.status === 401) {
          save({...draft, resume:true});
          location.assign('/login');
          return;
        }
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          if (r.status === 409) { input.disabled = false; waitingQuote = true; refresh(); }
          note.textContent = data.detail || 'Не удалось открыть оплату. Повторите попытку.';
          return;
        }
        if (data.url) { save({...draft, awaiting:true}); location.assign(data.url); return; }
        note.textContent = data.status === 'succeeded' ? 'Монеты зачислены.' : 'Платёж отменён.';
        save({});
        confirmed = null;
      } catch { note.textContent = 'Ошибка связи. Повторите попытку.'; }
      finally {
        submitting = false;
        input.disabled = false;
        if (!waitingQuote) pay.disabled = !confirmed;
        waitingQuote = false;
      }
    });
    box.showModal();
    refresh();
  }
  document.addEventListener('click', event => {
    const link = event.target.closest?.('[data-buy-coins]');
    if (!link) return;
    event.preventDefault();
    openCheckout();
  });
  // Hosted checkout may return before the webhook arrives. Recover the same paid
  // order by account-bound key; never create a second provider payment on return.
  async function reconcileOnReturn() {
    const draft = saved();
    if (!draft.awaiting || !draft.key || document.body.dataset.mode !== 'member') return;
    try {
      const r = await fetch('/api/coins/reconcile', {
        method:'POST', body:new URLSearchParams({key:draft.key}),
        credentials:'same-origin', cache:'no-store'
      });
      if (!r.ok) return;
      const state = await r.json();
      if (state.status === 'succeeded' || state.status === 'canceled') {
        save({});
        if (state.status === 'succeeded') {
          // Reload once so the existing wallet component reads the credited funds.
          location.reload();
        }
      }
    } catch { /* Keep pending order for a later verified retry. */ }
  }
  if (new URLSearchParams(location.search).get('account') === 'wallet') {
    reconcileOnReturn();
  }
  if (location.hash === '#buy-coins') {
    openCheckout(new URLSearchParams(location.search).get('coins') || '100');
  } else if (document.body.dataset.mode === 'member' && saved().resume) {
    const draft = saved();
    save({...draft, resume:false});
    openCheckout(draft.count);
  }
})();
