'use client';
import {useEffect,useRef,useState} from 'react';
type Row={id:string;state:string;store_ids:string[];created_at:string;expires_at:string;checked_at:string|null;submission_confirmed:boolean};
type Store={id:string;name:string;provider:string};
type Submission={id:string;storeIds:string[];question:string};
type Result={queryId:string;pages:string[];result_kind?:string;fetched_at:string;result_expires_at:string};
const labels:Record<string,string>={QUEUED:'В очереди',RUNNING:'Расчёт идёт',READY:'Готово',FAILED:'Не завершено',CANCELLED:'Отменено',UNKNOWN:'Отправка не подтверждена',EXPIRED:'Срок хранения истёк',ALIASED:'Общий расчёт'};
const messages:Record<string,string>={ACCESS_REQUIRED:'Доступ к отчётам пока не активен. Проверьте срок доступа в кабинете.',AUTH_REQUIRED:'Войдите в кабинет заново.',PERMISSION_DENIED:'Доступ к этому отчёту закрыт.',CREDENTIAL_REVOKED:'Проверьте ключи магазина.',CAPABILITY_UNAVAILABLE:'Магазин пока не подключён к расчётам платформы.',RESULT_EXPIRED:'Срок хранения отчёта истёк.',RESULT_NOT_READY:'Отчёт ещё готовится.',IDEMPOTENCY_CONFLICT:'Этот номер отправки уже использован с другим вопросом.',UNKNOWN_OUTCOME:'Отправка не подтверждена. Проверьте задание. Повторяйте только ту же отправку.',DEPENDENCY_UNAVAILABLE:'Сервис временно недоступен. Обновите состояние задания.'};
async function api(path='',body?:unknown){
  const r=await fetch('/api/v1/queries'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',redirect:'error'});
  const value=await r.json();if(!r.ok)throw new Error(typeof value.code==='string'?value.code:'DEPENDENCY_UNAVAILABLE');return value;
}
export function Queries({stores,hasMoreStores=false}:{stores:Store[];hasMoreStores?:boolean}){
  const view=useRef(0);
  const [feedbackFor,setFeedbackFor]=useState<string|null>(null);
  const [items,setItems]=useState<Row[]>([]),[storeIds,setStoreIds]=useState<string[]>(stores[0]?[stores[0].id]:[]),[question,setQuestion]=useState(''),[pending,setPending]=useState<Submission|null>(null),[selected,setSelected]=useState<Row|null>(null),[result,setResult]=useState<Result|null>(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const show=(error:unknown)=>setNotice(messages[error instanceof Error?error.message:'']||'Сервис временно недоступен. Проверьте состояние задания.');
  async function refresh(){try{setItems((await api()).items);}catch(e){show(e);}}
  async function status(row:Row){
    const generation=++view.current;setBusy(true);setResult(null);
    try{const value=await api('/'+row.id);if(generation!==view.current)return;
      setSelected(value.query);setItems(v=>v.map(x=>x.id===row.id?value.query:x));if(value.code)setNotice(messages[value.code]||'Проверьте состояние задания.');
    }catch(e){if(generation===view.current)show(e);}finally{if(generation===view.current)setBusy(false);}
  }
  useEffect(()=>{void refresh();},[]);
  useEffect(()=>{if(!result)return;const timer=setTimeout(()=>{setResult(null);setNotice(messages.RESULT_EXPIRED);},Math.max(0,Date.parse(result.result_expires_at)-Date.now()));return ()=>clearTimeout(timer);},[result]);
  async function submit(recover=false){
    const data=recover&&pending?pending:{id:crypto.randomUUID(),storeIds:[...storeIds].sort(),question};
    if(busy||pending&&!recover||!data.storeIds.length||!data.question.trim())return;
    const generation=++view.current;setBusy(true);setNotice('');setResult(null);setPending(data);
    try{const value=await api('',{id:data.id,store_ids:data.storeIds,utterance:data.question,recover});if(generation!==view.current)return;setSelected(value.query);if(value.query.submission_confirmed){setPending(null);setQuestion('');setNotice('Задание принято.');}else setNotice(messages.UNKNOWN_OUTCOME);await refresh();}catch(e){if(generation===view.current)show(e);}finally{if(generation===view.current)setBusy(false);}
  }
  async function open(row:Row){
    const generation=++view.current;setBusy(true);setResult(null);
    try{const value=await api('/'+row.id+'/result');if(generation!==view.current)return;
      setSelected(value.query);if(value.result&&value.query.id===row.id)setResult({...value.result,queryId:row.id});else setNotice(messages.UNKNOWN_OUTCOME);
    }catch(e){if(generation===view.current)show(e);}finally{if(generation===view.current)setBusy(false);}
  }
  async function feedback(){
    const queryId=result?.queryId;if(!queryId||queryId!==selected?.id||busy)return;
    const generation=view.current;setBusy(true);
    try{await api('/'+queryId+'/feedback',{});setFeedbackFor(queryId);if(generation===view.current)setNotice('Спасибо, отметка о неверном смысле сохранена.');}
    catch(e){if(generation===view.current)show(e);}finally{if(generation===view.current)setBusy(false);}
  }
  async function cancel(row:Row){
    const generation=++view.current;setBusy(true);setResult(null);
    try{const value=await api('/'+row.id+'/cancel',{request_id:crypto.randomUUID()});if(generation!==view.current)return;
      setSelected(value.query);setNotice(value.status?.cancelled?'Задание отменено.':value.code||value.status?.state==='UNKNOWN'||value.status?.code==='UNKNOWN_OUTCOME'?messages.UNKNOWN_OUTCOME:'Задание уже завершено.');await refresh();
    }catch(e){if(generation===view.current)show(e);}finally{if(generation===view.current)setBusy(false);}
  }
  return <><section aria-label="Новый отчёт"><h2>Новый отчёт</h2>{stores.length?<form onSubmit={e=>{e.preventDefault();void submit();}}><fieldset disabled={busy||!!pending}><legend>Магазины для запроса</legend><button type="button" onClick={()=>setStoreIds(stores.map(s=>s.id))}>Выбрать все в списке</button> <button type="button" onClick={()=>setStoreIds([])}>Снять выбор</button><p>Выбрано магазинов: {storeIds.length}</p>{hasMoreStores&&<p>Показана часть магазинов. Выбор относится только к магазинам в этом списке.</p>}{stores.map(s=><label key={s.id} style={{display:"block"}}><input type="checkbox" value={s.id} checked={storeIds.includes(s.id)} onChange={()=>setStoreIds(ids=>ids.includes(s.id)?ids.filter(id=>id!==s.id):[...ids,s.id])}/>{s.name} · {s.provider}</label>)}</fieldset><label>Вопрос<textarea value={question} onChange={e=>setQuestion(e.target.value)} maxLength={1200} required disabled={busy||!!pending} placeholder="Сколько заказов на Озон за вчера?"/></label><button className="button" disabled={busy||!!pending||!storeIds.length}>Подготовить отчёт</button></form>:<p>Сначала <a href="/app/stores">подключите магазин</a>.</p>}{pending&&<p>Эта отправка сохранена в открытой странице. <button disabled={busy} onClick={()=>void submit(true)}>Повторить ту же отправку</button> <button disabled={busy} onClick={()=>setPending(null)}>Изменить вопрос</button></p>}</section><p role="status">{notice}</p><section aria-label="Мои задания"><h2>Мои задания</h2><button disabled={busy} onClick={()=>void refresh()}>Обновить список</button><p>Состояние указано при последней проверке. Номер и состояние запроса доступны сутки. Краткий ответ доступен до указанного срока, документы API — 48 часов в разделе «Отчёты».</p>{!items.length&&<p>Заданий пока нет.</p>}<ul>{items.map(row=><li key={row.id}><button disabled={busy} onClick={()=>void status(row)}>{new Date(row.created_at).toLocaleString('ru-RU')} · {labels[row.state]||row.state}</button> · {row.store_ids.map(id=>stores.find(s=>s.id===id)?.name||'Магазин').join(', ')}</li>)}</ul></section>{selected&&<section aria-label="Карточка задания"><h2>{labels[selected.state]||selected.state}</h2><p>Номер: {selected.id}</p><button disabled={busy} onClick={()=>void status(selected)}>Проверить состояние</button>{selected.state==='READY'&&<button disabled={busy} onClick={()=>void open(selected)}>Открыть отчёт</button>}{selected.submission_confirmed&&['QUEUED','RUNNING','ALIASED','UNKNOWN'].includes(selected.state)&&<button disabled={busy} onClick={()=>void cancel(selected)}>Отменить задание</button>}{result&&result.queryId===selected.id&&<div aria-label="Сохранённый отчёт"><h3>{result.result_kind==='UNSUPPORTED_QUERY'?'Запрос пока не поддерживается':result.result_kind==='PROVIDER_REFUSAL'?'Пояснение об ограничении доступа':'Отчёт'}</h3><p>Данные проверены: {result.fetched_at}</p>{result.pages.map((page,i)=><p style={{whiteSpace:'pre-wrap'}} key={i}>{page}</p>)}{result.result_kind==='DATA'&&<button disabled={busy||feedbackFor===selected.id} onClick={()=>void feedback()}>{feedbackFor===selected.id?'Отметка сохранена':'Ответ не тот'}</button>}</div>}</section>}</>;
}
