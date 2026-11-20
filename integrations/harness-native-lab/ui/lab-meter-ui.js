/* Operator-only lab: model cost is a conservative estimate from actual DeepSeek usage. */
(() => {
  'use strict';
  if (document.getElementById('harness-lab-ruble-meter')) return;
  const root = document.createElement('aside');
  root.id = 'harness-lab-ruble-meter';
  root.setAttribute('role','status');
  root.setAttribute('aria-live','polite');
  root.style.cssText = 'position:fixed;right:12px;bottom:48px;z-index:300;background:rgba(25,25,28,.96);color:#ebedf1;border:1px solid rgba(255,255,255,.2);border-radius:10px;font:12px/1.5 system-ui,sans-serif;padding:7px 12px;min-width:180px;max-width:min(320px,75vw);box-shadow:0 2px 12px rgba(0,0,0,.18);pointer-events:auto';
  const current=document.createElement('div');current.style.cssText='font-weight:600;font-variant-numeric:tabular-nums';current.textContent='₽ · загрузка…';
  const detail=document.createElement('div');detail.style.cssText='opacity:.7;font-size:11px';detail.textContent='Все чаты тестового стенда';
  root.append(current,detail);
  const money=v=>Number.isFinite(v)&&v>=0 ? new Intl.NumberFormat('ru-RU',{minimumFractionDigits:4,maximumFractionDigits:4}).format(v) : '—';
  let pending=false;
  async function refresh() {
    if (pending || document.visibilityState==='hidden') return;
    pending=true;
    try {
      const r=await fetch('/lab-meter',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
      if (!r.ok || !(r.headers.get('content-type')||'').includes('application/json')) throw Error('unavailable');
      const data=await r.json();
      if (data.schema!=='harness-lab-meter/v1') throw Error('schema');
      current.textContent='DeepSeek · ≈ '+money(data.last_active_session?.rub_peak_estimate ?? data.total.rub_peak_estimate)+' ₽';
      detail.textContent=(data.last_active_session?'Последний активный чат':'Все чаты')
        +' · всего ≈ '+money(data.total.rub_peak_estimate)+' ₽';
      root.title='Последний активный чат (не всегда открытый); по фактическим токенам, пиковой цене и сохранённому курсу. Не банковское списание.'+(data.total.uncertain_attempts?' Вызовы с неизвестным расходом: '+data.total.uncertain_attempts:'');
    } catch {current.textContent='₽ · учёт временно недоступен';detail.textContent='Токены продолжают учитываться';}
    finally {pending=false;}
  }
  function start(){document.body.appendChild(root);void refresh();window.setInterval(refresh,7000);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
