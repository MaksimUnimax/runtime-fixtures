'use client';
import {useEffect,useRef,useState} from 'react';
import {appendStores,storePage,type QueryStore} from './store-pages';
type Row={id:string;state:string;store_ids:string[];created_at:string;expires_at:string;checked_at:string|null;submission_confirmed:boolean};
type Submission={id:string;storeIds:string[];question:string};
type Clarification={schema_version:string;revision:string;question:string;missing:string[];turn:number};
type PendingAnswer={queryId:string;requestId:string;revision:string;answer:string};
type Result={queryId:string;pages:string[];result_kind?:string;clarification?:Clarification;fetched_at:string;result_expires_at:string};
const labels:Record<string,string>={QUEUED:'В очереди',RUNNING:'Расчёт идёт',READY:'Готово',NEEDS_INPUT:'Нужно уточнение',FAILED:'Не завершено',CANCELLED:'Отменено',UNKNOWN:'Отправка не подтверждена',EXPIRED:'Срок хранения истёк',ALIASED:'Общий расчёт'};
const messages:Record<string,string>={ACCESS_REQUIRED:'Доступ к отчётам пока не активен. Проверьте срок доступа в кабинете.',AUTH_REQUIRED:'Войдите в кабинет заново.',PERMISSION_DENIED:'Доступ к этому отчёту закрыт.',CREDENTIAL_REVOKED:'Проверьте ключи магазина.',CAPABILITY_UNAVAILABLE:'Магазин пока не подключён к расчётам платформы.',RESULT_EXPIRED:'Срок хранения отчёта истёк.',RESULT_NOT_READY:'Отчёт ещё готовится.',IDEMPOTENCY_CONFLICT:'Этот номер отправки уже использован с другим вопросом.',UNKNOWN_OUTCOME:'Отправка не подтверждена. Проверьте задание. Повторяйте только ту же отправку.',DEPENDENCY_UNAVAILABLE:'Сервис временно недоступен. Обновите состояние задания.'};
async function api(path='',body?:unknown){
  const r=await fetch('/api/v1/queries'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',redirect:'error'});
  const value=await r.json();if(!r.ok)throw new Error(typeof value.code==='string'?value.code:'DEPENDENCY_UNAVAILABLE');return value;
}
export function Queries({stores:initialStores,nextStoreCursor=null}:{stores:QueryStore[];nextStoreCursor?:string|null}){
  const view=useRef(0);
  const paging=useRef(false),seenCursors=useRef(new Set<string>());
  const [stores,setStores]=useState(initialStores),[cursor,setCursor]=useState(nextStoreCursor);
  const [loadingStores,setLoadingStores]=useState(false),[storeNotice,setStoreNotice]=useState('');
  const [answerInput,setAnswerInput]=useState(''),[answerRevision,setAnswerRevision]=useState(''),[pendingAnswers,setPendingAnswers]=useState<Record<string,PendingAnswer>>({});
  const [feedbackFor,setFeedbackFor]=useState<string|null>(null);
  const [items,setItems]=useState<Row[]>([]),[storeIds,setStoreIds]=useState<string[]>(initialStores[0]?[initialStores[0].id]:[]),[question,setQuestion]=useState(''),[pending,setPending]=useState<Submission|null>(null),[selected,setSelected]=useState<Row|null>(null),[result,setResult]=useState<Result|null>(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const pendingAnswer=selected?pendingAnswers[selected.id]||null:null;
  function setPendingAnswer(value:PendingAnswer|null){const id=value?.queryId||selected?.id;if(id)setPendingAnswers(previous=>{const next={...previous};if(value)next[id]=value;else delete next[id];return next;});}
  const show=(error:unknown)=>setNotice(messages[error instanceof Error?error.message:'']||'Сервис временно недоступен. Проверьте состояние задания.');
  async function refresh(){try{setItems((await api()).items);}catch(e){show(e);}}
  async function moreStores(){
    if(busy||pending||paging.current||!cursor)return;
    const requested=cursor;paging.current=true;setLoadingStores(true);setStoreNotice('');
    try{
      const response=await fetch('/api/account/stores?cursor='+encodeURIComponent(requested),{cache:'no-store',redirect:'error'});
      if(response.status===401)throw new Error('AUTH_REQUIRED');
      if(!response.ok)throw new Error('STORES_UNAVAILABLE');
      const page=storePage(await response.json());
      if(page.cursor===requested||page.cursor&&seenCursors.current.has(page.cursor))throw new Error('STORE_PAGE_INVALID');
      setStores(previous=>appendStores(previous,page.stores));setCursor(page.cursor);seenCursors.current.add(requested);
    }catch(error){setStoreNotice(error instanceof Error&&error.message==='AUTH_REQUIRED'?messages.AUTH_REQUIRED:'Не удалось загрузить следующую страницу магазинов. Повторите попытку.');}
    finally{paging.current=false;setLoadingStores(false);}
  }
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
    if(busy||paging.current||pending&&!recover||!data.storeIds.length||!data.question.trim())return;
    const generation=++view.current;setBusy(true);setNotice('');setResult(null);setPending(data);
    try{const value=await api('',{id:data.id,store_ids:data.storeIds,utterance:data.question,recover});if(generation!==view.current)return;setSelected(value.query);if(value.query.submission_confirmed){setPending(null);setQuestion('');setNotice('Задание принято.');}else setNotice(messages.UNKNOWN_OUTCOME);await refresh();}catch(e){if(generation===view.current)show(e);}finally{if(generation===view.current)setBusy(false);}
  }
  async function open(row:Row){
    const generation=++view.current;setBusy(true);setResult(null);
    try{const value=await api('/'+row.id+'/result');if(generation!==view.current)return;
      setSelected(value.query);if(value.result&&value.query.id===row.id){
        setResult({...value.result,queryId:row.id});
        const revision=value.result.clarification?.revision||'';if(revision!==answerRevision){setAnswerRevision(revision);setAnswerInput('');}
        setPendingAnswers(previous=>{if(previous[row.id]&&previous[row.id].revision!==revision){const next={...previous};delete next[row.id];return next;}return previous;});
      }else setNotice(messages.UNKNOWN_OUTCOME);
    }catch(e){if(generation===view.current)show(e);}finally{if(generation===view.current)setBusy(false);}
  }
  async function answerClarification(recover=false){
    const prompt=result?.clarification;
    const data=recover&&pendingAnswer?pendingAnswer:prompt&&selected?{queryId:selected.id,requestId:crypto.randomUUID(),revision:prompt.revision,answer:answerInput}:null;
    if(!data||busy||pendingAnswer&&!recover||!data.answer.trim())return;
    const generation=++view.current;setBusy(true);setPendingAnswer(data);
    try{
      const value=await api('/'+data.queryId+'/clarify',{request_id:data.requestId,expected_revision:data.revision,answer:data.answer,recover});
      if(generation!==view.current)return;
      setSelected(value.query);
      if(value.code){setNotice('Отправка уточнения не подтверждена. Можно повторить ту же отправку.');}
      else{setPendingAnswer(null);setAnswerInput('');setResult(null);setNotice('Уточнение принято. Продолжается исходное задание.');}
      await refresh();
    }catch(error){if(generation===view.current)show(error);}finally{if(generation===view.current)setBusy(false);}
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
  return <><section aria-label="Новый отчёт"><h2>Новый отчёт</h2>{stores.length?<form onSubmit={e=>{e.preventDefault();void submit();}}><fieldset disabled={busy||!!pending||loadingStores}><legend>Магазины для запроса</legend><button type="button" onClick={()=>setStoreIds(stores.map(s=>s.id))}>Выбрать все в списке</button> <button type="button" onClick={()=>setStoreIds([])}>Снять выбор</button><p>Выбрано магазинов: {storeIds.length}</p>{cursor&&<p>Показана часть магазинов. Выбор относится только к магазинам в этом списке.</p>}{stores.map(s=><label key={s.id} style={{display:"block"}}><input type="checkbox" value={s.id} checked={storeIds.includes(s.id)} onChange={()=>setStoreIds(ids=>ids.includes(s.id)?ids.filter(id=>id!==s.id):[...ids,s.id])}/>{s.name} · {s.provider}</label>)}</fieldset><label>Вопрос<textarea value={question} onChange={e=>setQuestion(e.target.value)} maxLength={1200} required disabled={busy||!!pending||loadingStores} placeholder="Сколько заказов на Озон за вчера?"/></label><button className="button" disabled={busy||!!pending||loadingStores||!storeIds.length}>Подготовить отчёт</button></form>:<p>{cursor?'В этой части списка нет доступных магазинов. Загрузите следующую страницу или ':'Сначала '}<a href="/app/stores">подключите магазин</a>.</p>}{cursor&&<p><button type="button" disabled={busy||!!pending||loadingStores} onClick={()=>void moreStores()}>{loadingStores?'Загружаю магазины…':'Показать ещё магазины'}</button></p>}{storeNotice&&<p role="alert">{storeNotice}</p>}{pending&&<p>Эта отправка сохранена в открытой странице. <button disabled={busy} onClick={()=>void submit(true)}>Повторить ту же отправку</button> <button disabled={busy} onClick={()=>setPending(null)}>Изменить вопрос</button></p>}</section><p role="status">{notice}</p><section aria-label="Мои задания"><h2>Мои задания</h2><button disabled={busy} onClick={()=>void refresh()}>Обновить список</button><p>Состояние указано при последней проверке. Номер и состояние запроса доступны сутки. Краткий ответ доступен до указанного срока, документы API — 48 часов в разделе «Отчёты».</p>{!items.length&&<p>Заданий пока нет.</p>}<ul>{items.map(row=><li key={row.id}><button disabled={busy} onClick={()=>void status(row)}>{new Date(row.created_at).toLocaleString('ru-RU')} · {labels[row.state]||row.state}</button> · {row.store_ids.map(id=>stores.find(s=>s.id===id)?.name||'Магазин').join(', ')}</li>)}</ul></section>{selected&&<section aria-label="Карточка задания"><h2>{labels[selected.state]||selected.state}</h2><p>Номер: {selected.id}</p><button disabled={busy} onClick={()=>void status(selected)}>Проверить состояние</button>{['READY','NEEDS_INPUT'].includes(selected.state)&&<button disabled={busy} onClick={()=>void open(selected)}>{selected.state==='NEEDS_INPUT'?'Ответить на уточнение':'Открыть отчёт'}</button>}{selected.submission_confirmed&&['QUEUED','RUNNING','ALIASED','UNKNOWN','NEEDS_INPUT'].includes(selected.state)&&<button disabled={busy} onClick={()=>void cancel(selected)}>Отменить задание</button>}{result&&result.queryId===selected.id&&<div aria-label="Сохранённый отчёт"><h3>{result.result_kind==='CLARIFICATION'?'Уточнение запроса':result.result_kind==='UNSUPPORTED_QUERY'?'Запрос пока не поддерживается':result.result_kind==='PROVIDER_REFUSAL'?'Пояснение об ограничении доступа':'Отчёт'}</h3>{result.result_kind!=='CLARIFICATION'&&<p>Данные проверены: {result.fetched_at}</p>}{result.pages.map((page,i)=><p style={{whiteSpace:'pre-wrap'}} key={i}>{page}</p>)}{result.result_kind==='CLARIFICATION'&&result.clarification&&<form onSubmit={event=>{event.preventDefault();void answerClarification();}}><label>Ответ на уточнение<textarea maxLength={1200} required value={pendingAnswer?.queryId===selected.id?pendingAnswer.answer:answerInput} disabled={busy||!!pendingAnswer} onChange={event=>setAnswerInput(event.target.value)}/></label><button disabled={busy||!!pendingAnswer||!answerInput.trim()}>Продолжить задание</button></form>}{result.result_kind==='DATA'&&<button disabled={busy||feedbackFor===selected.id} onClick={()=>void feedback()}>{feedbackFor===selected.id?'Отметка сохранена':'Ответ не тот'}</button>}</div>}{pendingAnswer?.queryId===selected.id&&<p role="status">Уточнение сохранено в открытой странице. <button disabled={busy} onClick={()=>void answerClarification(true)}>Повторить то же уточнение</button></p>}</section>}</>;
}
