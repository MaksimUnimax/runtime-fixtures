'use client';
import {useEffect, useState} from 'react';

type Policy={window_days:number;min_contributions:number;min_clients:number;paid_window_days:number;paid_min_contributions:number;paid_min_clients:number;tenant_daily_cap:number};
type Counts={from:string;to:string;raw:number;contributions:number;clients:number;daily?:{day:string;raw:number;contributions:number;clients:number}[]};
type Candidate={id:string;revision:number;state:string;priority:string;assignee_id:string|null;assignee_name:string|null;policy_revision:number;evidence:{trigger:string}};
type Cluster={id:string;revision:number;example:string;platform:string;date_axis:string;general:Counts;paid:Counts;threshold:string|null;candidate:Candidate|null;episodes?:{id:string;source_revision:number;example:string|null;at:string;internal_test:boolean;eligible:boolean}[];episodes_more?:boolean;decisions?:{action:string;actor_id:string|null;actor_name:string|null;at:string;facts:Record<string,unknown>}[]};
type Queue={policy:Policy;policy_revision:number;items:Cluster[];next_cursor:string|null;pending_events:boolean;can_manage:boolean;assignees:{id:string;name:string}[]};
const states:Record<string,string>={CANDIDATE:'Кандидат',IN_REVIEW:'В работе',WAITING_FOR_PROVIDER:'Ожидает провайдера',ACCEPTED:'Принят',REJECTED:'Отклонён'};
const reasons:Record<string,string>={CONFIRMED_FINANCIAL_ERROR:'Подтверждённая финансовая ошибка',CONFIRMED_DEFECT:'Подтверждённый дефект',PROVIDER_DEPENDENCY:'Зависимость от провайдера',ASSIGNMENT:'Назначение ответственного',REVIEW_COMPLETE:'Рассмотрение завершено'};
const policyFields:[keyof Policy,string][]=[['window_days','Период, дней'],['min_contributions','Минимум вкладов'],['min_clients','Минимум клиентов'],['paid_window_days','Период для оплаченного доступа, дней'],['paid_min_contributions','Минимум вкладов с оплаченным доступом'],['paid_min_clients','Минимум оплативших клиентов'],['tenant_daily_cap','Вклад одного клиента за день']];
const errors:Record<string,string>={DEMAND_REVISION_CONFLICT:'Карточка изменилась. Обновите очередь перед повторным действием.',DEMAND_CLUSTER_CHANGED:'Состав группы изменился. Обновите очередь.',DEMAND_INCOMPATIBLE_MEANING:'Эти вопросы различаются по смыслу, периоду данных или исключениям. Объединение не выполнено.',DEMAND_NO_CUSTOMER_EPISODES:'Для этой карточки пока нет клиентских эпизодов.',DEMAND_POLICY_INVALID:'Проверьте пороги: положительные целые числа, число клиентов не больше числа вкладов.'};

async function request(action:string, filters:Record<string,unknown>){
  const response=await fetch('/api/staff/query-insights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'demand.'+action,filters}),cache:'no-store',redirect:'error'});
  const body=await response.json() as Queue&{code?:string};
  if(!response.ok)throw new Error(response.status===401||response.status===403?'Подтвердите вход или проверьте права владельца.':errors[body.code||'']||'Не удалось подтвердить результат. Обновите очередь перед повторным действием.');
  return body;
}

export function Demand(){
  const [queue,setQueue]=useState<Queue|null>(null),[policy,setPolicy]=useState<Policy|null>(null);
  const [detail,setDetail]=useState<Cluster|null>(null),[cursor,setCursor]=useState<string|undefined>();
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[selected,setSelected]=useState<string[]>([]);
  const [target,setTarget]=useState(''),[state,setState]=useState('CANDIDATE'),[priority,setPriority]=useState('NORMAL'),[assignee,setAssignee]=useState(''),[reason,setReason]=useState('REVIEW_COMPLETE'),[createReason,setCreateReason]=useState('CONFIRMED_DEFECT');
  async function load(next?:string){
    setBusy(true);setMessage('');
    try{const value=await request('list',next?{cursor:next}:{});setQueue(value);setPolicy(value.policy);setCursor(next);setDetail(null);setSelected([]);}
    catch(error){setQueue(null);setMessage((error as Error).message);}finally{setBusy(false);}
  }
  async function open(id:string){
    setBusy(true);setMessage('');
    try{const value=await request('list',{cluster:id});const item=value.items[0];if(!item)throw new Error('Группа была объединена или изменилась. Обновите очередь.');setDetail(item);setSelected([]);setTarget('');setState(item.candidate?.state||'CANDIDATE');setPriority(item.candidate?.priority||'NORMAL');setAssignee(item.candidate?.assignee_id||'');}
    catch(error){setMessage((error as Error).message);}finally{setBusy(false);}
  }
  async function mutate(action:string, filters:Record<string,unknown>){
    setBusy(true);setMessage('');
    try{await request(action,filters);const value=await request('list',cursor?{cursor}:{});setQueue(value);setPolicy(value.policy);setDetail(null);setSelected([]);setMessage('Изменение сохранено.');}
    catch(error){setMessage((error as Error).message);}finally{setBusy(false);}
  }
  useEffect(()=>{void load();},[]);
  return <section aria-label="Спрос на новые шаблоны"><h2>Запросы на новые шаблоны</h2>
    <p>Повторные вопросы собираются в одну карточку. Внутренние проверки исключены; дневной вклад клиента ограничен. Оплаченный доступ учитывается на дату вопроса.</p>
    <p role="status">{message}</p>
    {!queue&&<button type="button" disabled={busy} onClick={()=>void load()}>Загрузить очередь</button>}
    {queue&&<>
      <p>Обычный порог: {queue.policy.min_contributions} вкладов от {queue.policy.min_clients} клиентов за {queue.policy.window_days} дней. Для оплаченного доступа: {queue.policy.paid_min_contributions} вкладов от {queue.policy.paid_min_clients} клиентов за {queue.policy.paid_window_days} дней. За день учитывается не более {queue.policy.tenant_daily_cap} вклада одного клиента.</p>
      {queue.pending_events&&<p>Есть ещё события для обработки. Обновление очереди включает следующую часть.</p>}
      <button type="button" disabled={busy} onClick={()=>void load()}>Обновить список</button>
      {queue.can_manage&&<button type="button" disabled={busy} onClick={()=>void mutate('refresh',cursor?{cursor}:{})}>Обработать события и пересчитать</button>}
      {queue.can_manage&&policy&&<details><summary>Настроить пороги</summary><form onSubmit={event=>{event.preventDefault();void mutate('policy',{expected_revision:queue.policy_revision,policy});}}>
        {policyFields.map(([key,label])=><label key={key}>{label}<input type="number" required min={1} max={key.endsWith('days')?365:key==='tenant_daily_cap'?5:100000} step={1} disabled={busy} value={policy[key]} onChange={event=>setPolicy({...policy,[key]:Number(event.target.value)})}/></label>)}
        <button disabled={busy}>Сохранить пороги</button></form></details>}
      {!queue.items.length&&<p>Клиентских вопросов для группировки пока нет.</p>}
      <ul>{queue.items.map(item=><li key={item.id}><h3>{item.example}</h3>
        <p>Эпизодов: {item.general.raw}; вкладов с дневным ограничением: {item.general.contributions}; клиентов: {item.general.clients}.</p>
        <p>С оплаченным доступом: {item.paid.contributions} вкладов от {item.paid.clients} клиентов.</p>
        <p>{item.candidate?`${states[item.candidate.state]||'Карточка'}${item.candidate.priority==='URGENT'?' · срочно':''}`:item.threshold?'Порог выполнен. Пересчёт создаст карточку.':'Порог ещё не достигнут.'}</p>
        {item.candidate&&<p>Ответственный: {item.candidate.assignee_name||'не назначен'}.</p>}
        <button type="button" disabled={busy} onClick={()=>void open(item.id)}>Открыть группу</button></li>)}</ul>
      {queue.next_cursor&&<button type="button" disabled={busy} onClick={()=>void load(queue.next_cursor!)}>Следующая страница</button>}
      {cursor&&<button type="button" disabled={busy} onClick={()=>void load()}>К началу очереди</button>}
      {detail&&<section aria-label="Карточка потребности"><h3>{detail.example}</h3>
        {detail.general.daily&&<details><summary>Динамика по дням</summary><table><thead><tr><th>Дата (UTC)</th><th>Эпизоды</th><th>Вклады</th><th>Клиенты</th></tr></thead><tbody>{detail.general.daily.map(day=><tr key={day.day}><td>{day.day}</td><td>{day.raw}</td><td>{day.contributions}</td><td>{day.clients}</td></tr>)}</tbody></table></details>}
        {detail.candidate&&<p>Карточка создана по версии порогов {detail.candidate.policy_revision}. Решение сохраняется при последующем снижении спроса.</p>}
        {queue.can_manage&&!detail.candidate&&<form onSubmit={event=>{event.preventDefault();void mutate('create',{cluster:detail.id,expected_revision:detail.revision,reason:createReason});}}>
          <label>Основание ручной карточки<select disabled={busy} value={createReason} onChange={event=>setCreateReason(event.target.value)}>{['CONFIRMED_FINANCIAL_ERROR','CONFIRMED_DEFECT','PROVIDER_DEPENDENCY'].map(code=><option key={code} value={code}>{reasons[code]}</option>)}</select></label><button disabled={busy}>Создать карточку без ожидания порога</button></form>}
        {queue.can_manage&&detail.candidate&&<form onSubmit={event=>{event.preventDefault();void mutate('update',{cluster:detail.id,expected_revision:detail.revision,candidate_revision:detail.candidate!.revision,state,priority,assignee_id:assignee||null,reason});}}>
          <label>Состояние<select disabled={busy} value={state} onChange={event=>setState(event.target.value)}>{Object.entries(states).map(([code,label])=><option key={code} value={code}>{label}</option>)}</select></label>
          <label>Приоритет<select disabled={busy} value={priority} onChange={event=>setPriority(event.target.value)}><option value="NORMAL">Обычный</option><option value="URGENT">Срочный</option></select></label>
          <label>Ответственный<select disabled={busy} value={assignee} onChange={event=>setAssignee(event.target.value)}><option value="">Не назначен</option>{queue.assignees.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label>Причина решения<select disabled={busy} value={reason} onChange={event=>setReason(event.target.value)}>{Object.entries(reasons).map(([code,label])=><option key={code} value={code}>{label}</option>)}</select></label><button disabled={busy}>Сохранить решение</button></form>}
        {queue.can_manage&&<details><summary>Объединить совместимые группы</summary><form onSubmit={event=>{event.preventDefault();const item=queue.items.find(row=>row.id===target);if(item)void mutate('merge',{source:detail.id,source_revision:detail.revision,target:item.id,target_revision:item.revision});}}>
          <p>Разные оси даты, исключения и смыслы не объединяются. Если у обеих групп уже есть карточки, состояние и ответственный целевой карточки сохраняются; история исходной остаётся доступна.</p><label>Добавить эту группу к<select required disabled={busy} value={target} onChange={event=>setTarget(event.target.value)}><option value="">Выберите группу</option>{queue.items.filter(item=>item.id!==detail.id).map(item=><option key={item.id} value={item.id}>{item.example}</option>)}</select></label><button disabled={busy||!target}>Объединить</button></form></details>}
        <details><summary>Эпизоды и разделение группы</summary>{detail.episodes_more&&<p>Показаны первые 30 эпизодов.</p>}
          <ul>{detail.episodes?.map(item=><li key={item.id}>{queue.can_manage&&<input type="checkbox" aria-label={`Выделить эпизод от ${new Date(item.at).toLocaleString('ru-RU')}`} disabled={busy} checked={selected.includes(item.id)} onChange={event=>setSelected(event.target.checked?[...selected,item.id]:selected.filter(id=>id!==item.id))}/>} {item.example||'Текст скрыт'} · {new Date(item.at).toLocaleString('ru-RU')} · {item.internal_test?'внутренняя проверка':item.eligible?'учитывается':'не влияет на порог'}</li>)}</ul>
          {queue.can_manage&&<button type="button" disabled={busy||!selected.length} onClick={()=>void mutate('split',{cluster:detail.id,expected_revision:detail.revision,episodes:selected})}>Выделить выбранные эпизоды в отдельную группу</button>}</details>
        <h4>История решения</h4><ul>{detail.decisions?.map((item,index)=><li key={`${item.at}-${index}`}>{new Date(item.at).toLocaleString('ru-RU')} · {item.actor_name||'Автоматически'} · {({CANDIDATE_CREATED:'Создана карточка',UPDATED:'Решение обновлено',MERGED:'Группа объединена',MERGED_FROM:'Добавлена совместимая группа',SPLIT:'Группа разделена',SPLIT_FROM:'Выделена отдельная группа',MERGE_PRIORITY:'Сохранён срочный приоритет'} as Record<string,string>)[item.action]||'Решение сохранено'}{typeof item.facts.state==='string'&&` · ${states[item.facts.state]||'Решение'}`}{typeof item.facts.reason==='string'&&` · ${reasons[item.facts.reason]||'Рассмотрено'}`}</li>)}</ul>
      </section>}
    </>}
  </section>;
}
