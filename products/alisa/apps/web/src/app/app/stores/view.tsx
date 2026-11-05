'use client';
import {useEffect,useState} from 'react';
import type {Store,StoreCredential,StoreList} from '../../../server/stores';

const messages:Record<string,string>={
  CONNECTED:'Подключение подтверждено',NOT_CHECKED:'Ещё не проверено',
  AUTH_DENIED:'Площадка отклонила ключ. Проверьте его и сохраните новый.',
  SCOPE_MISSING:'У ключа недостаточно прав.',TIMEOUT:'Площадка не ответила вовремя. Ключ не признан неверным.',
  RATE_LIMITED:'Площадка ограничила частоту запросов. Попробуйте позже.',
  CHECK_UNAVAILABLE:'Проверка подключения пока недоступна. Ключ сохранён, подключение не подтверждено.',
  PROVIDER_UNAVAILABLE:'Площадка временно недоступна.',IDENTITY_NOT_VERIFIED:'Не удалось подтвердить кабинет площадки.',
  ACCOUNT_MISMATCH:'Ключ относится к другому кабинету. Прежний ключ сохранён.',
  ALREADY_CONNECTED:'Этот кабинет площадки уже подключён в вашем списке.',
  REVISION_CONFLICT:'Магазин изменился. Список обновлён; повторите действие с текущими данными.',
  CHECK_IN_PROGRESS:'Проверка уже выполняется. Обновите список немного позже.',
  UNKNOWN_OUTCOME:'Результат проверки неизвестен. Обновите список перед новой проверкой.',
  STORE_DISABLED:'Сначала включите магазин и сохраните новый ключ.',
  IDEMPOTENCY_CONFLICT:'Запрос уже использован для другого действия. Обновите страницу.',
  INVALID_PAYLOAD:'Проверьте заполнение полей.',VAULT_UNAVAILABLE:'Не удалось сохранить ключ. Попробуйте позже.',
};
const kinds={SELLER:'Ozon Seller API',PERFORMANCE:'Реклама Ozon',WB:'Wildberries API'};
type Command=Record<string,unknown>;

function KeyFields({kind,id}:{kind:StoreCredential['kind'];id:string}){
  return <fieldset><legend>{kinds[kind]}</legend>
    {kind!=='WB'&&<label htmlFor={id+'-client'}>Client ID<input id={id+'-client'} name="client_id" required maxLength={160} autoComplete="off"/></label>}
    <label htmlFor={id+'-secret'}>{kind==='WB'?'API-токен':kind==='SELLER'?'API-ключ':'Client Secret'}
      <input id={id+'-secret'} name="secret" type="password" required minLength={12} maxLength={8192} autoComplete="new-password" spellCheck={false}/>
    </label>
  </fieldset>;
}
function material(form:FormData,kind:StoreCredential['kind']){
  const secret=String(form.get('secret')||'');
  return kind==='WB'?{token:secret}:kind==='SELLER'?{client_id:String(form.get('client_id')||''),api_key:secret}:{client_id:String(form.get('client_id')||''),client_secret:secret};
}

export function StoresView({initial}:{initial:StoreList}){
  const [ready,setReady]=useState(false);
  useEffect(()=>setReady(true),[]);
  const [list,setList]=useState(initial),[provider,setProvider]=useState<'OZON'|'WB'>('OZON'),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  async function refresh(append=false){
    const suffix=append&&list.next_cursor?'?cursor='+encodeURIComponent(list.next_cursor):'';
    const response=await fetch('/api/account/stores'+suffix,{cache:'no-store'});
    if(response.status===401){window.location.assign('/login');throw new Error('Войдите в кабинет.');}
    if(!response.ok)throw new Error('Не удалось обновить список магазинов.');
    const value=await response.json() as StoreList;
    setList(previous=>({...value,items:append?[...previous.items,...value.items]:value.items}));
  }
  async function send(command:Command){
    const response=await fetch('/api/account/stores',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...command,command_id:crypto.randomUUID()})});
    if(response.status===401){window.location.assign('/login');throw new Error('Войдите в кабинет.');}
    const value=await response.json();
    if(!response.ok)throw new Error(messages[value.code]||'Не удалось выполнить действие. Обновите список перед повтором.');
    return value as {store?:Store;check_code?:string;state?:string};
  }
  async function perform(operation:()=>Promise<unknown>){
    if(busy)return;setBusy(true);setMessage('');
    try{await operation();await refresh();}
    catch(error){setMessage(error instanceof Error?error.message:'Не удалось получить ответ. Обновите список перед повтором.');try{await refresh();}catch{/* Keep the last known list. */}}
    finally{setBusy(false);}
  }
  async function check(store:Store,credential:StoreCredential){
    const value=await send({action:'check',store_id:store.id,expected_revision:store.revision,credential_id:credential.id});
    setMessage(value.state==='CHECKING'?'Проверка выполняется. Обновите список позже.':messages[value.check_code||'']||'Проверка завершена.');
  }
  async function saveKey(store:Store,kind:StoreCredential['kind'],form:HTMLFormElement){
    const data=new FormData(form),credential=material(data,kind);form.reset();
    const value=await send({action:'credential',store_id:store.id,expected_revision:store.revision,kind,credential});
    if(value.store){const pending=value.store.credentials.find(c=>c.kind===kind&&c.status==='PENDING');if(pending)await check(value.store,pending);}
  }
  return <>
    <p>Подключить магазин можно без оплаты. Проверка подключения не запускает финансовый отчёт.</p>
    <p role="status" aria-live="polite">{message}</p>
    <button className="button" disabled={!ready||busy} onClick={()=>void perform(()=>refresh())}>Обновить список</button>
    <section aria-label="Добавить магазин"><h2>Добавить магазин</h2>
      <form method="post" action="/api/account/stores" onSubmit={event=>{event.preventDefault();const form=event.currentTarget;void perform(async()=>{
        const data=new FormData(form),kind=provider==='OZON'?'SELLER':'WB';
        const command={action:'create',provider,name:String(data.get('name')||''),voice_alias:String(data.get('voice_alias')||''),credential:material(data,kind)};
        form.reset();setProvider('OZON');
        const value=await send(command);if(value.store)await check(value.store,value.store.credentials[0]);
      });}}>
        <label htmlFor="store-provider">Маркетплейс</label><select id="store-provider" value={provider} disabled={!ready||busy} onChange={event=>setProvider(event.target.value as 'OZON'|'WB')}><option value="OZON">Ozon</option><option value="WB">Wildberries</option></select>
        <label htmlFor="store-name">Название магазина<input id="store-name" name="name" maxLength={80} required disabled={!ready||busy}/></label>
        <label htmlFor="store-alias">Как называть магазин голосом<input id="store-alias" name="voice_alias" maxLength={80} disabled={!ready||busy}/></label>
        <KeyFields key={provider} kind={provider==='OZON'?'SELLER':'WB'} id="new-store"/>
        <p>Ключ после сохранения не показывается. Рекламу Ozon можно подключить отдельно в карточке магазина.</p>
        <button className="button" disabled={!ready||busy}>Сохранить и проверить</button>
      </form>
    </section>
    <section aria-label="Сохранённые магазины"><h2>Сохранённые магазины</h2>
      {!list.items.length&&<p>Подключённых магазинов пока нет.</p>}
      {list.items.map(store=><section key={store.id} aria-label={'Магазин '+store.name} data-store-id={store.id}>
        <h3>{store.name} · {store.provider==='OZON'?'Ozon':'Wildberries'}</h3>
        <p>{store.status==='DISABLED'?'Магазин отключён. Сохранённые ключи удалены.':'Магазин включён.'}</p>
        {store.voice_alias&&<p>Голосовое название: {store.voice_alias}</p>}
        <form method="post" action="/api/account/stores" onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);void perform(()=>send({action:'rename',store_id:store.id,expected_revision:store.revision,name:String(data.get('name')||''),voice_alias:String(data.get('voice_alias')||'')}));}}>
          <label>Название<input key={store.name} name="name" required maxLength={80} defaultValue={store.name}/></label>
          <label>Голосовое название<input key={store.voice_alias} name="voice_alias" maxLength={80} defaultValue={store.voice_alias}/></label>
          <button className="button" disabled={!ready||busy}>Сохранить названия</button>
        </form>
        {(store.provider==='OZON'?['SELLER','PERFORMANCE'] as const:['WB'] as const).map(kind=><section key={kind} aria-label={kinds[kind]}>
          <h4>{kinds[kind]}</h4>
          {!store.credentials.some(c=>c.kind===kind)&&<p>Не подключено.</p>}
          {store.credentials.filter(c=>c.kind===kind).map(c=><div key={c.id}>
            <p>{c.status==='PENDING'?'Новый ключ, версия ':'Текущий ключ, версия '}{c.revision}: {messages[c.check_code]||'Проверка не подтверждена.'}</p>
            {store.status==='ACTIVE'&&<button className="button" disabled={!ready||busy} onClick={()=>void perform(()=>check(store,c))}>Проверить {c.status==='PENDING'?'новый':'текущий'} ключ</button>}
          </div>)}
          {store.credentials.some(c=>c.kind===kind)&&<button className="button" disabled={!ready||busy} onClick={()=>void perform(()=>send({action:'revoke_credential',store_id:store.id,expected_revision:store.revision,kind}))}>Отключить {kinds[kind]}</button>}
          {store.status==='ACTIVE'&&<details><summary>{kind==='PERFORMANCE'?'Подключить или заменить ключ рекламы':'Сохранить новый ключ'}</summary>
            <form method="post" action="/api/account/stores" onSubmit={event=>{event.preventDefault();const form=event.currentTarget;void perform(()=>saveKey(store,kind,form));}}>
              <KeyFields kind={kind} id={store.id+'-'+kind}/>
              <p>Действующий ключ заменится после подтверждения того же кабинета площадки.</p>
              <button className="button" disabled={!ready||busy}>Сохранить и проверить новый ключ</button>
            </form>
          </details>}
        </section>)}
        <button className="button" disabled={!ready||busy} onClick={()=>void perform(()=>send({action:store.status==='DISABLED'?'enable':'disable',store_id:store.id,expected_revision:store.revision}))}>{store.status==='DISABLED'?'Включить магазин':'Отключить и удалить ключи'}</button>
        <button className="button" disabled={!ready||busy} onClick={()=>{if(window.confirm('Удалить магазин и его сохранённые ключи?'))void perform(()=>send({action:'delete',store_id:store.id,expected_revision:store.revision}));}}>Удалить магазин</button>
      </section>)}
      {list.next_cursor&&<button className="button" disabled={!ready||busy} onClick={()=>{setBusy(true);void refresh(true).catch(()=>setMessage('Не удалось загрузить следующую страницу.')).finally(()=>setBusy(false));}}>Показать ещё</button>}
    </section>
  </>;
}
