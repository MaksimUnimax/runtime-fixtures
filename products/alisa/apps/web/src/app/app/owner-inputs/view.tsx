'use client';
import {useEffect,useRef,useState} from 'react';
import type {Store} from '../../../server/stores';
import {labels,toFacts,fromFacts,hasLegacyCostDates,pendingKey,readPending,RowValidationError,type RowInput,type Row,type Field,type State,type RecordState,type Pending} from './model';

type Product={sku:string;name:string;offer_id:string};
type Catalog={items:Product[];next_cursor:string|null;complete:boolean};
type Loaded=RecordState&{server_time:number};
type Reply={state?:string;receipt?:RecordState;server_time?:number;code?:string}&Partial<Loaded>;
const messages:Record<string,string>={
  REVISION_CONFLICT:'Параметры уже изменены в другой вкладке. Обновите версию и проверьте данные заново.',
  OWNER_CONFIRMATION_REQUIRED:'Подтвердите правильность введённых параметров.',
  OWNER_SOURCE_STORE_UNVERIFIED:'Сначала подтвердите подключение магазина на странице «Мои магазины».',
  OWNER_SOURCE_STORE_DISABLED:'Магазин отключён. Его параметры не изменены.',
  AUTHENTICATION_REQUIRED:'Сессия завершилась. Войдите снова; неизвестную команду сначала проверьте после входа.',
  OWNER_COMMAND_EXPIRED:'Срок команды истёк. Параметры не сохранены; проверьте данные и подтвердите заново.',
  OWNER_SOURCE_CAPACITY:'Набор параметров слишком большой. Сократите число строк.',
  NOT_FOUND:'Магазин или раздел недоступен этому аккаунту.',
};
async function call(command:Record<string,unknown>):Promise<{ok:boolean;status:number;body:Reply}>{
  const r=await fetch('/api/account/owner-inputs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command),credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(8000)});
  const body=await r.json() as Reply;return {ok:r.ok,status:r.status,body};
}
export function OwnerInputsView({stores,initialStore,recoveryScope}:{stores:Store[];initialStore:string;recoveryScope:string}){
  const [store,setStore]=useState(stores.some(s=>s.id===initialStore)?initialStore:'');
  const [loaded,setLoaded]=useState<Loaded|null>(null),[rows,setRows]=useState<Row[]>([]);
  const [busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[confirmed,setConfirmed]=useState(false);
  const [invalid,setInvalid]=useState<{rowId:string;field:RowInput;message:string}|null>(null);
  const resultRef=useRef<HTMLParagraphElement>(null);
  const [pending,setPending]=useState<Pending|null>(null),[notice,setNotice]=useState(''),[failure,setFailure]=useState('');
  const [products,setProducts]=useState<Product[]>([]),[productCursor,setProductCursor]=useState<string|null>(null),[catalogBusy,setCatalogBusy]=useState(false),[catalogError,setCatalogError]=useState(''),[catalogReady,setCatalogReady]=useState(false),[search,setSearch]=useState('');
  const [readOnly,setReadOnly]=useState(false);const currentStore=useRef(store);currentStore.current=store;const serverClock=useRef({seconds:0,monotonic:0});
  const selected=stores.find(s=>s.id===store);
  const key=pendingKey(recoveryScope,store);
  const controlId=(rowId:string,field:RowInput)=>`owner-${rowId}-${field}`;
  useEffect(()=>{
    if(busy||!invalid)return;
    const input=document.getElementById(controlId(invalid.rowId,invalid.field));
    input?.focus({preventScroll:true});input?.scrollIntoView({block:'center',behavior:'auto'});
  },[invalid,busy]);
  useEffect(()=>{if(!busy&&notice)resultRef.current?.scrollIntoView({block:'nearest',behavior:'auto'});},[notice,busy]);
  function fieldProps(rowId:string,field:RowInput){
    const bad=invalid?.rowId===rowId&&invalid.field===field;
    return {id:controlId(rowId,field),'aria-invalid':bad?true:undefined,'aria-describedby':bad?controlId(rowId,field)+'-error':undefined,style:bad?{outline:'2px solid #ffb4ab',outlineOffset:'2px'}:undefined};
  }
  function fieldError(rowId:string,field:RowInput){
    return invalid?.rowId===rowId&&invalid.field===field?<span id={controlId(rowId,field)+'-error'} style={{display:'block',color:'#ffb4ab',marginTop:'.4rem'}}>{invalid.message}</span>:null;
  }
  async function load(id=store){
    if(!id)return;
    const r=await call({action:'read',store_id:id});
    if(!r.ok||typeof r.body.server_time!=='number'||typeof r.body.revision!=='number')throw new Error(messages[r.body.code||'']||'Не удалось прочитать параметры. Данные не изменены.');
    if(currentStore.current!==id)return;
    const state=r.body as Loaded;const next=fromFacts(state.facts,id);
    if(!next.some(x=>x.field==='unit_cost'&&x.scope==='all'))next.unshift({id:'current-common',field:'unit_cost',scope:'all',sku:'',from:'',to:'',state:'NOT_PROVIDED',amount:''});
    setLoaded(state);setRows(next);setDirty(false);setConfirmed(false);setReadOnly(false);setInvalid(null);
    serverClock.current={seconds:state.server_time,monotonic:performance.now()};
    if(next.some(x=>x.field==='unit_cost'&&x.scope!=='all')&&!catalogReady)void loadProducts();
  }
  useEffect(()=>{
    let active=true;setLoaded(null);setRows([]);setPending(null);setNotice('');setFailure('');setInvalid(null);setConfirmed(false);setDirty(false);setReadOnly(false);
    setProducts([]);setProductCursor(null);setCatalogReady(false);setCatalogError('');setSearch('');
    if(!store)return;
    setBusy(true);
    (async()=>{try{const p=readPending(localStorage,key);if(p&&p.store!==store)throw new Error('Ожидающая команда относится к другому магазину.');if(active)setPending(p);await load(store);}catch(error){if(active){setFailure(error instanceof Error?error.message:'Не удалось загрузить параметры.');setReadOnly(true);}}finally{if(active)setBusy(false);}})();
    return()=>{active=false;};
    // Store changes explicitly reset the editor. No persistence of monetary drafts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[store,key]);
  function edit(index:number,patch:Partial<Row>){setFailure('');setNotice('');setInvalid(null);setRows(old=>old.map((r,i)=>i===index?{...r,...patch}:r));setDirty(true);setConfirmed(false);}
  function add(field:Field,scope:'all'|'product'='product'){setFailure('');setNotice('');setInvalid(null);setRows(old=>[...old,{id:'entry:'+crypto.randomUUID(),field,scope,sku:'',from:'',to:'',state:'NOT_PROVIDED',amount:''}]);setDirty(true);setConfirmed(false);if(field==='unit_cost'&&scope==='product'&&!catalogReady&&!catalogBusy)void loadProducts();}
  async function loadProducts(cursor:string|null=null){
    const id=store;if(!id||catalogBusy)return;setCatalogBusy(true);setCatalogError('');
    try{
      const r=await fetch('/api/account/owner-products',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({store_id:id,cursor:cursor||''}),credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(8000)});
      const value=await r.json();if(!r.ok)throw new Error(value.code==='RATE_LIMITED'?'Каталог запрошен слишком часто. Попробуйте позднее.':value.code==='SCOPE_MISSING'?'У токена магазина нет права чтения каталога. Проверьте разрешения подключения.':'Каталог сейчас недоступен. Общую себестоимость можно сохранить без него; новое исключение пока не отправляйте.');
      if(currentStore.current!==id)return;
      const data=value as Catalog;if(!Array.isArray(data.items)||data.items.some(x=>typeof x.sku!=='string'||typeof x.name!=='string'||typeof x.offer_id!=='string')||!(data.next_cursor===null||typeof data.next_cursor==='string'))throw new Error('Получен некорректный каталог. Параметры не изменены.');
      setProducts(old=>{const combined=cursor?[...old,...data.items]:data.items;return [...new Map(combined.map(x=>[x.sku,x])).values()];});setProductCursor(data.next_cursor);setCatalogReady(true);
    }catch(e){if(currentStore.current===id)setCatalogError(e instanceof Error?e.message:'Не удалось загрузить товары.');}finally{setCatalogBusy(false);}
  }
  async function locked(fn:()=>Promise<void>){
    if(!navigator.locks)throw new Error('Браузер не поддерживает защиту одновременных изменений. Используйте актуальный Chrome, Opera или Яндекс Браузер.');
    await navigator.locks.request(key,{mode:'exclusive'},fn);
  }
  async function refresh(){
    if(dirty&&!window.confirm('Загрузить сохранённую версию вместо несохранённых правок?'))return;
    setBusy(true);setFailure('');try{await load();}catch(e){setFailure(e instanceof Error?e.message:'Не удалось обновить данные.');}finally{setBusy(false);}
  }
  async function recover(){
    setBusy(true);setFailure('');
    try{await locked(async()=>{
      const p=readPending(localStorage,key);if(!p){setPending(null);await load();return;}
      const r=await call({action:'status',store_id:store,command_id:p.id});
      if(!r.ok)throw new Error(messages[r.body.code||'']||'Не удалось проверить исходную команду. Новая команда не отправлена.');
      if(typeof r.body.server_time==='number')serverClock.current={seconds:r.body.server_time,monotonic:performance.now()};
      if(r.body.state==='DONE'){
        localStorage.removeItem(key);setPending(null);setNotice('Исходная команда выполнена. Загружаю текущую версию параметров.');
        try{await load();}catch{setReadOnly(true);setFailure('Команда подтверждена, но текущую версию пока не удалось прочитать. Не повторяйте сохранение; обновите данные.');}
      }else if(r.body.state==='NOT_FOUND'&&typeof r.body.server_time==='number'&&r.body.server_time>=p.deadline){
        localStorage.removeItem(key);setPending(null);setConfirmed(false);setNotice('Команда не принята, её срок истёк. Проверьте параметры и подтвердите сохранение заново.');
      }else{setPending(p);setNotice('Результат команды ещё не установлен. Новое изменение не отправлено. Нажмите «Проверить сохранение» позднее.');}
    });}catch(e){setFailure(e instanceof Error?e.message:'Проверка недоступна.');}finally{setBusy(false);}
  }
  async function send(action:'approve'|'revoke'){
    if(!loaded||!selected)return;
    if(action==='revoke'&&!window.confirm('Отозвать текущие параметры? Новые расчёты не смогут использовать эту версию.'))return;
    setBusy(true);setFailure('');setNotice('');setInvalid(null);
    try{await locked(async()=>{
      const old=readPending(localStorage,key);if(old){setPending(old);throw new Error('Сначала проверьте исходную команду. Повторная правка не отправлена.');}
      if(action==='approve'&&!confirmed)throw new Error('Подтвердите правильность параметров для выбранного магазина.');
      const facts=action==='approve'?toFacts(rows,store):undefined;
      if(serverClock.current.seconds===0)throw new Error('Обновите версию параметров перед сохранением.');
      const deadline=Math.floor(serverClock.current.seconds+(performance.now()-serverClock.current.monotonic)/1000)+120;
      const p:Pending={id:crypto.randomUUID(),store,deadline,revision:loaded.revision,action};
      // Only command identity/deadline is persisted: never costs, credentials or tokens.
      localStorage.setItem(key,JSON.stringify(p));if(readPending(localStorage,key)?.id!==p.id)throw new Error('Браузер не сохранил идентификатор команды. Изменение не отправлено.');setPending(p);
      const command={action,store_id:store,command_id:p.id,expected_revision:p.revision,not_after:p.deadline,...(action==='approve'?{confirmed:true,facts}:{})};
      let result;try{result=await call(command);}catch{throw new Error('Ответ на сохранение не получен. Проверьте исходную команду кнопкой ниже; новую правку не отправляйте.');}
      if(!result.ok){
        if(result.status>=500)throw new Error('Сервис не подтвердил результат. Проверьте исходную команду; автоматического повтора нет.');
        localStorage.removeItem(key);setPending(null);setConfirmed(false);
        if(result.body.code==='REVISION_CONFLICT')setReadOnly(true);
        throw new Error(messages[result.body.code||'']||'Параметры отклонены. Проверьте выбранные товары, суммы, периоды и отсутствие пересечений.');
      }
      localStorage.removeItem(key);setPending(null);setConfirmed(false);setDirty(false);
      setNotice(action==='approve'?`Параметры подтверждены. Версия ${result.body.revision}.`:'Параметры отозваны.');
      try{await load();}catch{setReadOnly(true);setFailure('Команда выполнена, но текущие данные не удалось обновить. Не повторяйте сохранение; нажмите «Обновить версию».');}
    });}catch(e){
      setFailure(e instanceof Error?e.message:'Не удалось завершить действие. Данные не отправлены повторно.');
      if(e instanceof RowValidationError)setInvalid({rowId:e.rowId,field:e.field,message:e.message});
    }finally{setBusy(false);}
  }
  const disabled=busy||readOnly||pending!==null;
  return <section aria-label="Параметры владельца">
    <label>Магазин <select aria-label="Магазин" value={store} disabled={busy} onChange={e=>{if(!dirty||window.confirm('Несохранённые правки будут потеряны. Переключить магазин?'))setStore(e.target.value);}}><option value="">Выберите магазин</option>{stores.map(s=><option key={s.id} value={s.id}>{s.name} · {s.provider}</option>)}</select></label>
    <p><a href="/app/stores">Подключить или проверить магазины</a></p>
    {notice&&<p ref={resultRef} role="status">{notice}</p>}{failure&&<p role="alert">{failure}</p>}
    {pending&&<aside><p>Есть команда без подтверждённого ответа. Её номер: <code>{pending.id}</code>. Новые изменения заблокированы, чтобы не создать дубликат.</p><button type="button" disabled={busy} onClick={recover}>Проверить сохранение</button></aside>}
    {loaded&&<>
      <p>Сохранённая версия: <strong>{loaded.revision}</strong>. Статус: <strong>{loaded.status==='APPROVED'?'Подтверждены':loaded.status==='REVOKED'?'Отозваны':'Не заданы'}</strong>.</p>
      <button type="button" disabled={busy} onClick={refresh}>Обновить версию</button>
      <h2>Общая себестоимость и исключения</h2>
      <p>Введите одну текущую сумму за единицу. Расчёт обращается к сохранённой цифре. Она используется, пока вы сами её не измените; даты не нужны. Для отдельных товаров можно задать другую текущую себестоимость. Неизвестное значение не заменяется нулём.</p>
      <p>{!rows.some(x=>x.field==='unit_cost'&&x.scope==='all')&&<button type="button" disabled={disabled||rows.length>=200} onClick={()=>add('unit_cost','all')}>Добавить общую себестоимость</button>} <button type="button" disabled={disabled||rows.length>=200} onClick={()=>add('unit_cost','product')}>Добавить исключение для товара</button></p>
      {rows.some(x=>x.field==='unit_cost'&&x.scope!=='all')&&<aside aria-label="Каталог товаров"><p>Товары подгружаются из подключённого магазина. Название и артикул помогают выбрать нужный товар; идентификатор подставляется автоматически.</p><label>Поиск среди загруженных товаров <input aria-label="Поиск товаров" value={search} onChange={e=>setSearch(e.target.value)}/></label><p>Загружено: {products.length}. {productCursor?'Доступны следующие товары.':catalogReady?'Каталог дочитан.':''}</p><button type="button" disabled={catalogBusy||busy} onClick={()=>void loadProducts()}>{catalogReady?'Обновить каталог':'Загрузить каталог'}</button>{productCursor&&<button type="button" disabled={catalogBusy||products.length>=2000} onClick={()=>void loadProducts(productCursor)}>Показать ещё товары</button>}{catalogBusy&&<p role="status">Загружаю товары…</p>}{catalogError&&<p role="alert">{catalogError}</p>}</aside>}
      <p>Себестоимость — текущая сумма без дат. Дополнительные налог и расходы не обязательны для сохранения себестоимости; если добавляете их, укажите фактический период, к которому относится сумма.</p>
      {hasLegacyCostDates(loaded.facts)&&<p role="note">Раньше себестоимость сохранялась с датами. Теперь проверьте текущую сумму и сохраните её без дат. Если для товара было несколько разных сумм, поле оставлено пустым: выберите текущую цифру, мы её не угадываем.</p>}
      <div style={{display:'grid',gap:'1rem'}}>{rows.map((row,index)=><fieldset key={row.id} disabled={disabled} style={{display:'grid',gap:'.9rem',padding:'1rem',border:'1px solid currentColor',borderRadius:'8px'}}>
        <legend>{row.field==='unit_cost'?(row.scope==='all'?'Общая себестоимость всех товаров':'Исключение для товара'):labels[row.field]} · строка {index+1}</legend>
        {row.field==='unit_cost'&&row.scope!=='all'&&<label>Товар <select {...fieldProps(row.id,'sku')} aria-label={`Товар ${index+1}`} value={row.sku} onChange={e=>edit(index,{sku:e.target.value})}><option value="">Выберите товар из каталога</option>{row.sku&&!products.some(x=>x.sku===row.sku)&&<option value={row.sku}>Сохранённое исключение · {row.sku}</option>}{products.filter(x=>x.sku===row.sku||`${x.name} ${x.offer_id}`.toLowerCase().includes(search.toLowerCase())).map(x=><option key={x.sku} value={x.sku}>{x.name} · {x.offer_id||x.sku}</option>)}</select>{fieldError(row.id,'sku')}</label>}
        {row.field==='unit_cost'&&row.scope==='all'&&<p>Применяется ко всем товарам, кроме действующих индивидуальных исключений.</p>}
        {row.field!=='unit_cost'&&<>
        <label>Начало периода расхода <input {...fieldProps(row.id,'from')} aria-label={`Дата начала ${index+1}`} type="date" value={row.from} onChange={e=>edit(index,{from:e.target.value})}/>{fieldError(row.id,'from')}</label>
        <label>Окончание периода расхода <input {...fieldProps(row.id,'to')} aria-label={`Дата окончания ${index+1}`} type="date" value={row.to} onChange={e=>edit(index,{to:e.target.value})}/>{fieldError(row.id,'to')}</label>
        <label>Состояние <select {...fieldProps(row.id,'state')} aria-label={`Состояние ${index+1}`} value={row.state} onChange={e=>edit(index,{state:e.target.value as State})}><option value="NOT_PROVIDED">Не указана</option><option value="VALUE">Сумма известна</option>{row.field==='tax_amount'&&<option value="EXCLUDED_BY_OWNER">Явно исключаю налог из расчёта</option>}</select>{fieldError(row.id,'state')}</label>
        </>}
        {(row.field==='unit_cost'||row.state==='VALUE')&&<label>{row.field==='unit_cost'?'Себестоимость за единицу, ₽':'Сумма, ₽'} <input {...fieldProps(row.id,'amount')} aria-label={`Сумма ${index+1}`} inputMode="decimal" autoComplete="off" placeholder="Не указана" value={row.amount} onChange={e=>edit(index,{amount:e.target.value,...(row.field==='unit_cost'?{state:e.target.value.trim()?'VALUE':'NOT_PROVIDED'}as const:{})})}/>{fieldError(row.id,'amount')}</label>}
        <button type="button" onClick={()=>{setRows(old=>old.filter((_,i)=>i!==index));setDirty(true);setConfirmed(false);setInvalid(null);setFailure('');setNotice('');}}>Удалить строку {index+1}</button>
      </fieldset>)}</div>
      <p>{(['tax_amount','own_cost_amount'] as Field[]).map(field=><button type="button" disabled={disabled||rows.length>=200} key={field} onClick={()=>add(field)}>Добавить: {labels[field].toLowerCase()}</button>)}</p>
      <label><input type="checkbox" checked={confirmed} disabled={disabled} onChange={e=>setConfirmed(e.target.checked)}/> Подтверждаю эти параметры для магазина «{selected?.name}». Сохранение заменит текущую версию {loaded.revision}; неизвестные суммы не являются нулями.</label>
      {!confirmed&&dirty&&!pending&&<p>После заполнения строк поставьте галочку подтверждения — тогда станет доступна кнопка сохранения.</p>}
      {failure&&<p aria-live="polite" style={{borderLeft:'3px solid #ffb4ab',paddingLeft:'.75rem'}}>Сохранение не завершено. {failure}</p>}
      <p><button type="button" disabled={disabled||!confirmed||!dirty} onClick={()=>send('approve')}>Подтвердить и сохранить параметры</button> <button type="button" disabled={disabled||loaded.status!=='APPROVED'} onClick={()=>send('revoke')}>Отозвать параметры</button></p>
      <p>Сохранение параметров не запускает отчёт. Готовность голосового расчёта проверяется отдельно.</p>
    </>}
    {!store&&<p>Выберите свой магазин. Никаких сумм по умолчанию нет.</p>}
  </section>;
}
