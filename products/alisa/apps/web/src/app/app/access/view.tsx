'use client';
import {useEffect,useState} from 'react';
import type {AccessState} from '../../../server/access';

const dates=(value:string)=>new Date(value).toLocaleString('ru-RU',{timeZone:'UTC'})+' UTC';
const sources={GIFT:'Подарок',COMPENSATION:'Компенсация',PAYMENT:'Оплата'};
const statuses={ACTIVE:'Доступ действует',SCHEDULED:'Доступ запланирован',EXPIRED:'Срок доступа истёк',REVOKED:'Доступ отозван',NOT_PROVISIONED:'Доступ ещё не выдан'};
const reasons:Record<string,string>={PILOT_ACCESS:'Пилотный доступ',SUPPORT_REQUEST:'По обращению в поддержку',ACCESS_REVOCATION:'Отзыв оставшегося срока'};

export function AccessView({initial}:{initial:AccessState}){
  const [access,setAccess]=useState(initial),[error,setError]=useState('');
  async function refresh(){
    try{
      const response=await fetch('/api/account/access',{cache:'no-store'});
      if(response.status===401){window.location.assign('/login');return;}
      if(!response.ok)throw new Error();
      const data=await response.json();setAccess(data.access);setError('');
    }catch{setError('Не удалось обновить статус. Показаны последние полученные данные.');}
  }
  useEffect(()=>{const timer=setInterval(()=>void refresh(),30000);return()=>clearInterval(timer);},[]);
  return <>
    <section aria-label="Текущий доступ"><h2>{statuses[access.status]}</h2>
      {access.active_until&&<p>Действует до <strong>{dates(access.active_until)}</strong>.</p>}
      <p>Эти периоды предоставляют доступ только к Алисе.</p>
      <button className="button" onClick={()=>void refresh()}>Обновить статус</button>
      <p role="status">{error}</p>
    </section>
    <section aria-label="Уведомления"><h2>Уведомления</h2>
      {access.notifications.length?<ul>{access.notifications.map(note=><li key={note.id}>
        {note.kind==='GRANTED'?'Вам предоставлен период доступа к Алисе.':'Оставшаяся часть выбранного периода отозвана.'} {dates(note.created_at)}
      </li>)}</ul>:<p>Новых уведомлений нет.</p>}
    </section>
    <section aria-label="История доступа"><h2>История доступа</h2>
      {!access.history.length?<p>Периоды пока не выдавались.</p>:<ul>{access.history.map(grant=><li key={grant.id}>
        <h3>{sources[grant.source]} · {grant.days} дн.</h3>
        <p>{dates(grant.starts_at)} — {dates(grant.effective_ends_at)}</p>
        <p>{statuses[grant.status]}</p><p>Основание: {reasons[grant.reason]||'Предоставление доступа'}</p>
        {grant.comment&&<p>{grant.comment}</p>}
        {grant.adjusted&&<p>Первоначальная дата окончания: {dates(grant.ends_at)}. История периода сохранена.</p>}
      </li>)}</ul>}
    </section>
  </>;
}
