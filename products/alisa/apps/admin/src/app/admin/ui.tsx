'use client';
import {useEffect,useState} from 'react';
import type {Profile} from '../../server/auth';
import {AccessPanel,AccessBatches,type Recipient} from './access';
type Item={id:string;email?:string;name?:string;active?:boolean;revision?:number;tenant_id?:string;confirmed?:boolean;action?:string;reason?:string;outcome?:string;role?:string;staff_id?:string;revoked?:boolean};
const areas=[['customers','Клиенты','users.read'],['leads','Заявки','leads.read'],['staff','Сотрудники','staff.manage'],['sessions','Сессии','sessions.revoke'],['audit','Аудит','audit.read'],['access','Выдачи доступа','access.grant']];
export function Dashboard({staff}:{staff:Profile}){
  const available=areas.filter(([, , permission])=>staff.permissions.includes(permission)&&(permission!=='access.grant'||staff.permissions.includes('users.read')));
  const [area,setArea]=useState(available[0]?.[0]||''),[query,setQuery]=useState(''),[items,setItems]=useState<Item[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState<Item|null>(null);
  const [bulkRecipients,setBulkRecipients]=useState<Recipient[]>([]);
  const [pending,setPending]=useState<Record<string,unknown>|null>(null);
  async function load(resource=area,search=query,id?:string){
    if(resource==='access'){setItems([]);setSelected(null);return;}
    setBusy(true);setMessage('');
    try{const r=await fetch('/api/staff/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource,query:search,...(id?{id}:{})})});const data=await r.json();
      if(r.status===401||r.status===403){setItems([]);setMessage('Нужен новый вход с MFA или разрешение на просмотр.');return;}
      if(!r.ok)throw new Error();if(resource==='customer')setSelected(data.items[0]||null);else{setItems(data.items);setSelected(null);}
    }catch{setMessage('Данные пока недоступны. Повторите запрос.');}finally{setBusy(false);}
  }
  useEffect(()=>{void load(area,'');},[area]); // Data refresh always goes through server permissions.
  async function send(input:Record<string,unknown>){
    setBusy(true);setMessage('');
    try{const r=await fetch('/api/staff/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const data=await r.json();
      if(r.status>=500)throw new Error();setPending(null);
      if(!r.ok){setMessage(data.code==='FORBIDDEN'?'Для действия нужны права и свежая MFA.':data.code==='LAST_OWNER_PROTECTED'?'Последнего владельца нельзя отозвать.':'Действие отклонено. Обновите данные.');return;}
      await load();setMessage('Изменение сохранено.');
    }catch{setPending(input);setMessage('Ответ не получен. Повторите ту же команду кнопкой ниже.');}finally{setBusy(false);}
  }
  function command(action:string,payload:Record<string,unknown>){if(pending||busy)return;const input={command_id:crypto.randomUUID(),action,payload,reason:action==='staff.assign'?'OWNER_ASSIGNMENT':action.startsWith('staff.')||action==='session.revoke'?'STAFF_REVOCATION':'SUPPORT_REQUEST'};setPending(input);void send(input);}
  return <main><header><h1>Админка Алисы</h1><p>{staff.name} · {staff.role==='OWNER'?'Владелец':'Администратор'}</p><form method="post" action="/auth/logout"><button>Выйти</button></form></header>
    <nav aria-label="Разделы">{available.map(([key,title])=><button key={key} disabled={busy||!!pending} onClick={()=>{setQuery('');setArea(key);}}>{title}</button>)}</nav>
    <p role="status">{message}</p>{pending&&!busy&&<button onClick={()=>void send(pending)}>Повторить ту же команду</button>}
    {['customers','leads'].includes(area)&&<form onSubmit={e=>{e.preventDefault();void load();}}><label>Поиск по контакту или имени<input value={query} maxLength={80} onChange={e=>setQuery(e.target.value)}/></label><button disabled={busy}>Найти</button></form>}
    <section aria-label="Данные"><h2>{available.find(([key])=>key===area)?.[1]}</h2>{!items.length&&!busy&&<p>Записей нет.</p>}<ul>{items.map(item=><li key={item.id}>
      {area==='customers'?<>{staff.permissions.includes('access.grant')&&<label><input type="checkbox" aria-label={'Выбрать '+(item.name||item.email)} checked={bulkRecipients.some(r=>r.id===item.id)} disabled={!item.active} onChange={e=>setBulkRecipients(e.target.checked?[...bulkRecipients,{id:item.id,label:item.name||item.email||'Клиент'}]:bulkRecipients.filter(r=>r.id!==item.id))}/>Выбрать</label>}<button onClick={()=>void load('customer','',item.id)}>{item.name||item.email}</button> <span>{item.active?'Активен':'Заблокирован'}</span></>:null}
      {area==='leads'?<>{item.email} · {item.confirmed?'Контакт подтверждён':'Ожидает подтверждения'}</>:null}
      {area==='staff'?<>{item.name} · {item.role} · {item.active?'Активен':'Отозван'} <button disabled={busy||!!pending} onClick={()=>command('staff.revoke',{staff_id:item.id,revision:item.revision})}>Отозвать сотрудника</button></>:null}
      {area==='sessions'?<><span>{item.id} · {item.revoked?'Отозвана':'Действует'}</span> <button disabled={busy||!!pending||item.revoked} onClick={()=>command('session.revoke',{session_id:item.id})}>Отозвать сессию</button></>:null}
      {area==='audit'?<>{item.action} · {item.outcome} · {item.reason}</>:null}
    </li>)}</ul></section>
    {area==='access'&&<AccessBatches onSelectRemaining={recipients=>{setBulkRecipients(recipients);setArea('customers');}}/>}
    {area==='customers'&&bulkRecipients.length>0&&staff.permissions.includes('access.grant')&&<section aria-label="Групповая выдача"><button onClick={()=>setBulkRecipients([])}>Снять выбор клиентов</button><AccessPanel recipients={bulkRecipients}/></section>}
    {selected&&<section aria-label="Карточка клиента"><h2>Карточка клиента</h2><p>{selected.email}</p><p>{selected.name}</p><p>ID: {selected.id}</p><p>Tenant: {selected.tenant_id}</p><p>{selected.active?'Активен':'Заблокирован'}</p>
      {staff.permissions.includes(selected.active?'users.block':'users.unblock')&&<button disabled={busy||!!pending} onClick={()=>command(selected.active?'customer.block':'customer.unblock',{customer_id:selected.id,revision:selected.revision})}>{selected.active?'Заблокировать в Алисе':'Разблокировать в Алисе'}</button>}{staff.permissions.includes('access.grant')&&<AccessPanel recipients={[{id:selected.id,label:selected.name||selected.email||'Клиент'}]}/>}</section>}
    {area==='staff'&&staff.permissions.includes('staff.manage')&&<form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);command('staff.assign',{subject:f.get('subject'),name:f.get('name'),permissions:f.getAll('permissions')});}}><h2>Назначить администратора</h2><p>Для выдачи бесплатного доступа также нужен просмотр клиентов.</p><p>Используйте проверенный идентификатор сотрудника для входа в админку.</p><label>Идентификатор<input name="subject" required pattern="[0-9a-fA-F-]{36}"/></label><label>Имя<input name="name" required maxLength={80}/></label>{['users.read','users.block','users.unblock','leads.read','sessions.revoke','audit.read','access.grant'].map(p=><label key={p}><input type="checkbox" name="permissions" value={p}/>{({'users.read':'Просмотр клиентов','users.block':'Блокировка клиентов','users.unblock':'Разблокировка клиентов','leads.read':'Просмотр заявок','sessions.revoke':'Отзыв сессий','audit.read':'Просмотр аудита','access.grant':'Выдача бесплатного доступа'} as Record<string,string>)[p]}</label>)}<button disabled={busy||!!pending}>Назначить</button></form>}
    <p><a href="/login">Подтвердить вход с MFA заново</a></p>
  </main>;
}
