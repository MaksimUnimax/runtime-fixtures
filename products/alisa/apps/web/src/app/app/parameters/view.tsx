'use client';
import {useEffect,useRef,useState} from 'react';
import {type Area,type Current,type Definition,type Product,type Store,type Pending,enteredValue,shownValue,unitLabel,dateText,periodRequest,pendingKey,readPending,errorText} from './model';
type Prepared=Current&{period:{requested:{from:string;to:string};actual:{from:string;to:string}};collection:{available:boolean;code:string};dispatched:boolean};
async function api(command:Record<string,unknown>):Promise<Record<string,unknown>>{
 const result=await fetch('/api/account/parameters',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command),cache:'no-store'});
 const body=await result.json();if(!result.ok)throw Object.assign(new Error(errorText(body.code)),{code:body.code,status:result.status});return body;
}
export function ParametersView({stores,initialStore,recoveryScope}:{stores:Store[];initialStore:string;recoveryScope:string}){
 const available=stores.filter(s=>s.status==='ACTIVE');
 const [store,setStore]=useState(available.some(s=>s.id===initialStore)?initialStore:available.length===1?available[0].id:'');
 const [definitions,setDefinitions]=useState<Definition[]>([]),[parameter,setParameter]=useState('');
 const [kind,setKind]=useState<'store'|'sku'>('store'),[products,setProducts]=useState<Product[]>([]),[sku,setSku]=useState(''),[cursor,setCursor]=useState('');
 const [current,setCurrent]=useState<Current|null>(null),[manual,setManual]=useState(''),[pending,setPending]=useState<Pending|null>(null);
 const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[readBusy,setReadBusy]=useState(false),[storageOK,setStorageOK]=useState(true);
 const [period,setPeriod]=useState('12'),[from,setFrom]=useState(''),[to,setTo]=useState(''),[mode,setMode]=useState('replace'),[prepared,setPrepared]=useState<Prepared|null>(null);
 const generation=useRef(0);const activeStore=useRef(store);activeStore.current=store;const definition=definitions.find(d=>d.key===parameter);
 const product=products.find(p=>p.sku===sku);const area:Area={kind,sku:kind==='store'?'':sku};
 const key=pendingKey(recoveryScope,store,parameter,area);const activeKey=useRef(key);activeKey.current=key;
 const ready=!!store&&!!definition&&(kind==='store'||!!product?.parameter_reference);
 const base=()=>({store_id:store,parameter,scope:area,sku_reference:kind==='sku'?product?.parameter_reference||null:null});
 useEffect(()=>{
  const epoch=++generation.current;setDefinitions([]);setParameter('');setCurrent(null);setProducts([]);setSku('');setCursor('');setKind('store');setPending(null);setPrepared(null);setManual('');setMessage('');setError('');
  if(!store)return;
  setReadBusy(true);
  api({action:'catalog',store_id:store}).then(r=>{if(epoch===generation.current){const defs=r.definitions as Definition[];setDefinitions(defs);setParameter(defs[0]?.key||'');}}).catch(e=>{if(epoch===generation.current)setError(e.message);}).finally(()=>{if(epoch===generation.current)setReadBusy(false);});
 },[store]);
 useEffect(()=>{
  setCurrent(null);setManual('');setMessage('');setError('');setPrepared(null);setBusy(false);setReadBusy(false);
  try{setPending(readPending(localStorage,key));setStorageOK(true);}catch(e){setStorageOK(false);setError(e instanceof Error?e.message:'Не удалось проверить незавершённую запись.');}
  if(!ready)return;let cancelled=false;setReadBusy(true);
  api({...base(),action:'read'}).then(r=>{if(!cancelled)setCurrent(r as Current);}).catch(e=>{if(!cancelled)setError(e.message);}).finally(()=>{if(!cancelled)setReadBusy(false);});
  return()=>{cancelled=true;};
 // A key includes the complete target. A refreshed proof changes readability,
 // but never turns a read into a write or a producer request.
 },[key,ready,product?.parameter_reference]);
 async function refresh(){
  if(!ready)return;const own=key;setError('');setReadBusy(true);
  try{const r=await api({...base(),action:'read'});if(activeKey.current===own)setCurrent(r as Current);}
  catch(e){if(activeKey.current===own)setError(e instanceof Error?e.message:'Не удалось прочитать значение.');}
  finally{if(activeKey.current===own)setReadBusy(false);}
 }
 async function loadProducts(more=false){
  const selected=store;setBusy(true);setError('');
  try{
   const r=await fetch('/api/account/owner-products',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({store_id:store,cursor:more?cursor:''}),cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(errorText(d.code));
   if(selected===activeStore.current){setProducts(prev=>more?[...prev,...d.items]:d.items);setCursor(d.next_cursor||'');if(!more)setSku('');}
  }catch(e){if(selected===activeStore.current)setError(e instanceof Error?e.message:'Каталог недоступен.');}finally{if(selected===activeStore.current)setBusy(false);}
 }
 async function write(action:'set_manual'|'use_general'){
  if(!current||!definition||pending||!storageOK||busy)return;
  setError('');setMessage('');const own=key;
  let value:string|undefined;try{if(action==='set_manual')value=enteredValue(manual,definition.unit);}catch(e){setError((e as Error).message);return;}
  const p:Pending={id:crypto.randomUUID(),store,parameter,scope:area,revision:current.revision,not_after:current.server_time+120,action};
  // Re-read server time just before writing, without rebuilding the expected
  // revision: a concurrent edit must still conflict rather than be overwritten.
  setBusy(true);let recorded=false;
  try{
   const fresh=await api({...base(),action:'read'})as Current;
   if(activeKey.current!==own)return;
   p.not_after=fresh.server_time+120;
   if(fresh.revision!==current.revision){setCurrent(fresh);throw Error('Значение уже изменилось. Проверьте его перед сохранением.');}
   try{localStorage.setItem(own,JSON.stringify(p));recorded=true;setPending(p);}
   catch{setStorageOK(false);throw Error('Браузер не смог сохранить состояние команды. Изменение не отправлено.');}
   const r=await api({...base(),action,command_id:p.id,expected_revision:p.revision,not_after:p.not_after,confirmed:true,...(action==='set_manual'?{value,unit:definition.unit}:{})});
   localStorage.removeItem(own);
   if(activeKey.current===own){setCurrent(r as Current);setPending(null);setManual('');setMessage(action==='use_general'?'Используется общее значение магазина. Индивидуальное число удалено.':'Текущее значение сохранено. Предыдущее заменено без истории.');}
  }catch(e){
   if(activeKey.current===own){
    const failure=e as Error&{status?:number;code?:string};
    if(failure.status&&failure.status<500){
     try{localStorage.removeItem(own);setPending(null);}catch{setStorageOK(false);}
     setError(failure.message);
    }else if(recorded)setError('Ответ о сохранении не получен. Проверьте исход команды — повторная запись автоматически не отправляется.');
    else setError(failure.message||'Сохранение не отправлено.');
   }
  }finally{if(activeKey.current===own)setBusy(false);}
 }
 async function checkPending(){
  if(!pending||!ready)return;setBusy(true);setError('');const own=key;
  try{
   const r=await api({...base(),action:'status',command_id:pending.id});if(activeKey.current!==own)return;setCurrent(r as Current);
   if(r.outcome==='DONE'){
    localStorage.removeItem(own);setPending(null);setManual('');setMessage(r.superseded?'Команда была выполнена, затем значение изменили. Показано актуальное число.':'Сохранение подтверждено. Показано актуальное число.');
   }else if(Number(r.server_time)>=pending.not_after){localStorage.removeItem(own);setPending(null);setMessage('Сохранение не подтверждено, срок команды истёк. Проверьте актуальное число перед новым изменением.');}
   else setMessage('Исход пока не подтверждён. Новые изменения заблокированы до завершения или истечения срока этой команды.');
  }catch(e){setError(e instanceof Error?e.message:'Не удалось проверить сохранение.');}finally{if(activeKey.current===own)setBusy(false);}
 }
 async function prepare(){
  if(!ready||busy)return;const own=key;setError('');setPrepared(null);setBusy(true);
  try{const request=periodRequest(period,from,to);const r=await api({...base(),action:'prepare_calculation',period:request,mode});if(activeKey.current===own)setPrepared(r as Prepared);}
  catch(e){if(activeKey.current===own)setError(e instanceof Error?e.message:'Период не проверен.');}finally{if(activeKey.current===own)setBusy(false);}
 }
 const effective=current?.effective;
 return <section aria-label="Коэффициенты магазина" className="parameter-console">
  <style jsx>{`
   .parameter-console{min-width:0}
   label{display:block;margin-block:.6rem}
   select,input{max-width:100%;box-sizing:border-box}
   select{width:100%;padding:.65rem;border:1px solid #597487;border-radius:8px;background:transparent;color:inherit;font:inherit}
   option{background:Canvas;color:CanvasText}
   fieldset{min-width:0;padding:.8rem 1rem;border:1px solid #597487;border-radius:8px}
   fieldset label{display:flex;align-items:center;gap:.6rem}
   .parameter-console fieldset input[type=radio]{width:18px;height:18px;min-width:18px;margin:0;padding:0;flex:0 0 18px}
   button{max-width:100%;white-space:normal;padding:.65rem 1rem;margin-block:.35rem;border:1px solid #597487;border-radius:8px;background:transparent;color:inherit;font:inherit;cursor:pointer}
   button:disabled{opacity:.5;cursor:not-allowed}
   strong{overflow-wrap:anywhere}
   dl{display:grid;gap:.3rem;margin-block:1rem}
   dt{font-weight:600}dd{margin:0 0 .65rem;overflow-wrap:anywhere}
   section{margin-block:1.5rem}
  `}</style>
  <label>Магазин <select aria-label="Магазин коэффициентов" value={store} onChange={e=>{setBusy(false);setStore(e.target.value);}}><option value="">Выберите магазин</option>{available.map(s=><option key={s.id} value={s.id}>{s.name} · {s.provider}</option>)}</select></label>
  {store&&!definitions.length&&!readBusy&&<p>Для этой площадки пока нет подключённых параметров.</p>}
  {definitions.length>0&&<>
   <p><label>Параметр <select aria-label="Коэффициент" value={parameter} onChange={e=>{setBusy(false);setParameter(e.target.value);}}>{definitions.map(d=><option key={d.key} value={d.key}>{d.label}</option>)}</select></label></p>
   <fieldset><legend>Область применения</legend><label><input type="radio" name="parameter-scope" checked={kind==='store'} onChange={()=>setKind('store')}/> Все товары магазина</label> <label><input type="radio" name="parameter-scope" checked={kind==='sku'} onChange={()=>setKind('sku')}/> Отдельный товар</label></fieldset>
   {kind==='sku'&&<div><p>Выберите товар из каталога этого магазина. Артикул или SKU вручную не подменяет подтверждение принадлежности.</p><button type="button" disabled={busy} onClick={()=>void loadProducts(false)}>Обновить каталог товаров</button> <label>Товар <select aria-label="Товар коэффициента" value={sku} onChange={e=>setSku(e.target.value)}><option value="">Выберите товар</option>{products.map(p=><option key={p.sku} value={p.sku}>{p.name} · {p.offer_id} · SKU {p.sku}</option>)}</select></label>{cursor&&<button type="button" disabled={busy} onClick={()=>void loadProducts(true)}>Загрузить следующие товары</button>}</div>}
   <p><button type="button" disabled={!ready||readBusy||busy} onClick={()=>void refresh()}>Обновить текущее значение</button> {readBusy?'Чтение данных…':''}</p>
   {current&&<section aria-label="Актуальное значение"><h2>Текущее значение</h2><p><strong data-testid="current-value">{effective?shownValue(effective.value,effective.unit)+' '+unitLabel(effective.unit):'Не задано'}</strong></p>
    {current.inherited&&<p>Для товара используется общее значение магазина.</p>}
    {effective&&<dl><dt>Источник</dt><dd>{effective.origin==='manual'?'Задано вручную':'Рассчитано по данным магазина'}</dd><dt>Последний расчёт коэффициента</dt><dd>{dateText(effective.calculated_at)}</dd><dt>Исходные данные получены</dt><dd>{dateText(effective.collected_at)}</dd><dt>Последнее сохранение</dt><dd>{dateText(effective.updated_at)}</dd><dt>Статистический период</dt><dd>{effective.actual_period?effective.actual_period.from+' — '+effective.actual_period.to:'Не задаётся для ручного значения'}</dd></dl>}
    <p>Возраст значения не запускает обновление. Пересчёт выполняется только по вашей команде.</p>
   </section>}
   <section aria-label="Ручной ввод"><h2>Ввести число вручную</h2><p>Сбор данных и даты не требуются. Ноль можно сохранить явно.</p><label>Новое значение, {unitLabel(definition?.unit||'')} <input aria-label="Новое значение" inputMode="decimal" value={manual} onChange={e=>setManual(e.target.value)} disabled={!current||busy||!!pending}/></label> <button type="button" disabled={!current||!ready||busy||!!pending||!storageOK||!manual.trim()} onClick={()=>void write('set_manual')}>Сохранить число</button>
    {kind==='sku'&&current?.current?.state==='VALUE'&&<p><button type="button" disabled={busy||!!pending||!storageOK} onClick={()=>void write('use_general')}>Использовать общее значение</button></p>}
   </section>
   <section aria-label="Расчёт по данным"><h2>Рассчитать по данным магазина</h2><p>По умолчанию — год. Если история короче, после проверки полноты используется доступный интервал.</p><label>Период <select aria-label="Период коэффициента" value={period} onChange={e=>{setPeriod(e.target.value);setPrepared(null);}}><option value="12">Год</option><option value="6">Полгода</option><option value="3">Три месяца</option><option value="custom">Свои даты</option></select></label>
    {period==='custom'&&<p><label>С <input type="date" aria-label="Начало периода коэффициента" value={from} onChange={e=>{setFrom(e.target.value);setPrepared(null);}}/></label> <label>По <input type="date" aria-label="Конец периода коэффициента" value={to} onChange={e=>{setTo(e.target.value);setPrepared(null);}}/></label></p>}
    <p><label>Действие <select aria-label="Режим расчёта" value={mode} onChange={e=>{setMode(e.target.value);setPrepared(null);}}><option value="replace">Рассчитать и заменить текущее</option><option value="preview">Только показать, не сохранять</option></select></label></p>
    <button type="button" disabled={!ready||busy||!!pending} onClick={()=>void prepare()}>Проверить период и доступность сбора</button>
    {prepared&&<p role="status">Период: {prepared.period.requested.from} — {prepared.period.requested.to}. {prepared.collection.available?'Сбор доступен.':errorText(prepared.collection.code)} Сбор не запускался, значение не изменено.</p>}
   </section>
  </>}
  {pending&&<p><button type="button" disabled={!ready||busy} onClick={()=>void checkPending()}>Проверить сохранение</button></p>}
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 </section>;
}
