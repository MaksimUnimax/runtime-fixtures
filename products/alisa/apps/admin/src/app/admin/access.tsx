'use client';
import {useEffect,useState} from 'react';

export type Recipient={id:string;label:string};
type Grant={id:string;source:string;starts_at:string;ends_at:string;effective_ends_at:string;days:number;revocable:boolean};
type Preview={preview_id:string;kind:'GIFT'|'REVOKE';expires_at:string;cutoff?:string;previous_end?:string;items?:{customer_id:string;starts_at:string;ends_at:string;has_gap:boolean}[]};
type Batch={batch_id:string;preview_id:string;state:string;can_continue:boolean;recoverable_by_owner:boolean;items:{customer_id:string;customer_name:string;state:string;outcome:string}[];unfinished_commands:Record<string,unknown>[]};
type Operation=Record<string,unknown>;
const dates=(value:string)=>new Date(value).toLocaleString('ru-RU',{timeZone:'UTC'})+' UTC';
const sources:Record<string,string>={GIFT:'Подарок',COMPENSATION:'Компенсация',PAYMENT:'Оплата'};
const pendingKey='alisa-access-pending-operation';
// Storage may be unavailable; the current tab still retains the exact operation.
function savePending(operation:Operation):boolean{
  try{localStorage.setItem(pendingKey,JSON.stringify(operation));return true;}catch{return false;}
}
function clearPending(){try{localStorage.removeItem(pendingKey);}catch{/* A stale replay keeps the same idempotency key. */}}
const messages:Record<string,string>={FORBIDDEN:'Нужны права выдачи доступа, просмотра клиентов и свежий вход с MFA.',STAFF_AUTHORITY_CHANGED:'Права инициатора изменились. Нужна новая выдача оставшимся клиентам.',PREVIEW_EXPIRED:'Предпросмотр истёк. Создайте новый.',REVISION_CONFLICT:'Срок клиента уже изменился. Создайте новый предпросмотр.',PREVIEW_ALREADY_USED:'Этот предпросмотр уже подтверждён. Проверьте журнал выдач.',IDEMPOTENCY_CONFLICT:'Ключ уже относится к другой операции. Состояние не изменено.',NOT_REVOCABLE:'У выбранного периода нет доступного для отзыва остатка.'};

async function api(data:Operation){
  const response=await fetch('/api/staff/access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  if(response.status>=500)throw new Error('UNKNOWN');
  let result;
  try{result=await response.json();}catch{throw new Error('UNKNOWN');}
  if(!response.ok)throw new Error(result.code||'REJECTED');
  return result;
}

export function AccessPanel({recipients,onApplied}:{recipients:Recipient[];onApplied?:()=>void}){
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[preview,setPreview]=useState<Preview|null>(null);
  const [pending,setPending]=useState<Operation|null>(null),[batch,setBatch]=useState<Batch|null>(null);
  const [history,setHistory]=useState<Grant[]>([]),[maxDays,setMaxDays]=useState(30);
  async function load(){
    if(recipients.length!==1){setHistory([]);const result=await api({action:'batches'});setMaxDays(result.limits.days);return;}
    const result=await api({action:'customer',customer_id:recipients[0].id});
    setHistory(result.access.history);setMaxDays(result.limits.days);
  }
  useEffect(()=>{
    try{const saved=localStorage.getItem(pendingKey);if(saved)setPending(JSON.parse(saved));}catch{/* No credentials are persisted. */}
    void load().catch(()=>setMessage('Не удалось загрузить периоды. Обновите карточку.'));
  },[recipients.map(r=>r.id).join(',')]);
  async function readPreview(gift:Operation){
    if(busy||pending)return;setBusy(true);setMessage('');
    try{setPreview(await api({action:'preview',gift}));setBatch(null);}catch(error){setMessage(messages[(error as Error).message]||'Предпросмотр не создан. Проверьте параметры и права.');}finally{setBusy(false);}
  }
  async function submit(operation:Operation){
    if(busy)return;setBusy(true);setMessage('');setPending(operation);
    // Persist only opaque operation identifiers, never tokens, factors or contacts.
    const persisted=savePending(operation);
    try{
      const result=await api(operation);clearPending();setPending(null);setPreview(null);
      if(operation.action==='execute'){
        setBatch(result);setMessage(result.state==='COMPLETED'?'Выдача завершена. Результат каждого клиента показан ниже.':'Часть выдачи выполнена. Продолжите тем же списком.');
      }else{setBatch(null);setMessage('Оставшийся срок выбранного периода отозван.');}
      try{await load();onApplied?.();}catch{setMessage('Операция подтверждена. Не удалось обновить список периодов — обновите карточку.');}
    }catch(error){
      const code=(error as Error).message;
      if(code==='UNKNOWN'||error instanceof TypeError){setMessage('Ответ не получен. Повторите эту же операцию кнопкой ниже.'+(persisted?'':' Не закрывайте эту вкладку до получения результата.'));}
      else{clearPending();setPending(null);setMessage(messages[code]||'Операция отклонена. Проверьте журнал и создайте новый предпросмотр.');}
    }finally{setBusy(false);}
  }
  function confirm(){
    if(!preview||pending||busy)return;
    const command_id=crypto.randomUUID();
    void submit(preview.kind==='GIFT'?{action:'execute',command_id,batch_id:crypto.randomUUID(),preview_id:preview.preview_id,limit:5}:{action:'revoke',command_id,preview_id:preview.preview_id});
  }
  async function revokePreview(grant:Grant){
    if(busy||pending)return;setBusy(true);setMessage('');
    try{setPreview(await api({action:'revoke_preview',customer_id:recipients[0].id,grant_id:grant.id,notify:true}));}
    catch(error){setMessage(messages[(error as Error).message]||'Не удалось подготовить отзыв.');}finally{setBusy(false);}
  }
  return <section aria-label="Управление доступом"><h2>Доступ к Алисе</h2>
    <p>Получатели: {recipients.map(r=>r.label).join(', ')}.</p>
    <form onChange={()=>setPreview(null)} onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);void readPreview({customer_ids:recipients.map(r=>r.id),days:Number(data.get('days')),source:data.get('source'),reason:data.get('reason'),comment:data.get('comment'),notify:data.get('notify')==='on',policy:'AFTER_LAST_SCHEDULED'});}}><fieldset disabled={busy||!!pending}>
      <label>Дней<input name="days" type="number" min={1} max={maxDays} step={1} defaultValue={7} required/></label>
      <label>Основание<select name="source"><option value="GIFT">Подарок</option><option value="COMPENSATION">Компенсация</option></select></label>
      <label>Причина<select name="reason"><option value="PILOT_ACCESS">Пилотный доступ</option><option value="SUPPORT_REQUEST">По обращению в поддержку</option></select></label>
      <label>Комментарий<input name="comment" maxLength={280}/></label>
      <label><input name="notify" type="checkbox" defaultChecked/>Уведомить в кабинете клиента</label>
      <p>Новый срок добавляется после последнего запланированного периода. Существующие перерывы сохраняются.</p>
      <button disabled={busy||!!pending||!recipients.length}>Предварительный просмотр</button>
    </fieldset></form>
    <p role="status">{message}</p>
    {pending&&<button disabled={busy} onClick={()=>void submit(pending)}>Повторить ту же операцию</button>}
    {preview&&<section aria-label="Предпросмотр доступа"><h3>{preview.kind==='GIFT'?'Проверьте выдачу':'Проверьте отзыв'}</h3>
      <p>Предпросмотр действителен до {dates(preview.expires_at)}.</p>
      {preview.kind==='GIFT'?<ul>{preview.items?.map(item=><li key={item.customer_id}>
        {recipients.find(r=>r.id===item.customer_id)?.label||'Клиент'}: {dates(item.starts_at)} — {dates(item.ends_at)}
        {item.has_gap&&<p>До нового периода сохранится перерыв в доступе.</p>}
      </li>)}</ul>:<p>Отозвать оставшуюся часть при подтверждении, не раньше {dates(preview.cutoff!)}. Уже использованная часть сохранится. Прежнее окончание: {dates(preview.previous_end!)}. Остальные периоды сохранятся.</p>}
      <button disabled={busy||!!pending} onClick={confirm}>{preview.kind==='GIFT'?'Подтвердить выдачу':'Подтвердить отзыв'}</button>
      <button disabled={busy||!!pending} onClick={()=>setPreview(null)}>Отменить предпросмотр</button>
    </section>}
    {batch&&<section aria-label="Результат выдачи"><h3>Результат выдачи</h3><BatchRows batch={batch}/>
      {batch.state==='PARTIAL'&&batch.can_continue&&<button disabled={busy||!!pending} onClick={()=>void submit(batch.unfinished_commands[0]||{action:'execute',command_id:crypto.randomUUID(),batch_id:batch.batch_id,preview_id:batch.preview_id,limit:5})}>Продолжить выдачу</button>}
    </section>}
    {recipients.length===1&&<section aria-label="Выданные периоды"><h3>Выданные периоды</h3>
      {!history.length?<p>Периоды пока не выдавались.</p>:<ul>{history.map(grant=><li key={grant.id}>
        {sources[grant.source]} · {grant.days} дн. · {dates(grant.starts_at)} — {dates(grant.effective_ends_at)}
        {grant.revocable&&<button disabled={busy||!!pending} onClick={()=>void revokePreview(grant)}>Отозвать оставшийся срок</button>}
      </li>)}</ul>}
    </section>}
  </section>;
}

function BatchRows({batch}:{batch:Batch}){
  return <><p>{batch.state==='BLOCKED'?'Выдача остановлена: права инициатора изменились.':batch.state==='PARTIAL'?'Остались необработанные клиенты.':'Все строки обработаны.'}</p>
    <ul>{batch.items.map(item=><li key={item.customer_id}>{item.customer_name} · {item.state==='APPLIED'?'Выдано':item.state==='PENDING'?'Ожидает':item.outcome==='REVISION_CONFLICT'?'Срок уже изменился: нужен новый предпросмотр':'Не выдано'}</li>)}</ul>
  </>;
}

export function AccessBatches({onSelectRemaining}:{onSelectRemaining:(recipients:Recipient[])=>void}){
  const [items,setItems]=useState<{batch_id:string;created_at:string}[]>([]),[batch,setBatch]=useState<Batch|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[unconfirmed,setUnconfirmed]=useState<Operation|null>(null);
  async function list(){const result=await api({action:'batches'});setItems(result.items);}
  useEffect(()=>{void list().catch(()=>setError('Не удалось загрузить выдачи.'));},[]);
  async function open(id:string){setBusy(true);setError('');try{setBatch(await api({action:'batch',batch_id:id}));}catch{setError('Не удалось прочитать выдачу.');}finally{setBusy(false);}}
  async function resume(){
    if(!batch||busy)return;setBusy(true);setError('');
    let operation:Operation=batch.unfinished_commands[0]||{action:'execute',command_id:crypto.randomUUID(),batch_id:batch.batch_id,preview_id:batch.preview_id,limit:5};
    try{
      let old=unconfirmed;
      if(!old){try{const saved=localStorage.getItem(pendingKey);if(saved)old=JSON.parse(saved);}catch{/* Retain the exact operation in this mounted journal. */}}
      if(old){if(old.batch_id!==batch.batch_id){setError('Сначала проверьте незавершённую операцию в карточке клиента.');return;}operation=old;}
      setUnconfirmed(operation);savePending(operation);
      const result=await api(operation);setBatch(result);clearPending();setUnconfirmed(null);
    }catch(error){
      const code=(error as Error).message;
      if(code!=='UNKNOWN'&&!(error instanceof TypeError)){clearPending();setUnconfirmed(null);}
      setError(messages[code]||'Ответ не получен. Не закрывайте вкладку; повторите продолжение той же выдачи.');
    }finally{setBusy(false);}
  }
  return <section aria-label="Журнал выдач"><h2>Выдачи доступа</h2><p role="status">{error}</p>
    <button disabled={busy} onClick={()=>void list().catch(()=>setError('Не удалось загрузить выдачи.'))}>Обновить список выдач</button>
    <ul>{items.map(item=><li key={item.batch_id}><button disabled={busy} onClick={()=>void open(item.batch_id)}>{dates(item.created_at)}</button></li>)}</ul>
    {batch&&<><BatchRows batch={batch}/>
      {batch.state==='PARTIAL'&&batch.can_continue&&<button disabled={busy} onClick={()=>void resume()}>Продолжить выдачу</button>}
      {batch.recoverable_by_owner&&(!batch.can_continue||batch.state==='COMPLETED')&&<button disabled={busy} onClick={()=>onSelectRemaining(batch.items.filter(i=>i.state!=='APPLIED').map(i=>({id:i.customer_id,label:i.customer_name})))}>Новый предпросмотр для оставшихся клиентов</button>}
    </>}
  </section>;
}
