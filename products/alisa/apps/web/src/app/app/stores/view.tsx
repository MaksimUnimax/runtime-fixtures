'use client';
import {useEffect,useState} from 'react';
import type {Store,StoreCredential,StoreList} from '../../../server/stores';
import {recoveryKey,readPendingCreate,persistCreate,finishCreate} from './pending-create';

const messages:Record<string,string>={
  CONNECTED:'Подключение подтверждено',NOT_CHECKED:'Ещё не проверено',
  AUTH_DENIED:'Площадка отклонила ключ. Проверьте его и сохраните новый.',
  SCOPE_MISSING:'У ключа недостаточно прав.',TIMEOUT:'Площадка не ответила вовремя. Ключ не признан неверным.',
  RATE_LIMITED:'Площадка ограничила частоту запросов. Попробуйте позже.',
  CHECK_UNAVAILABLE:'Проверка подключения пока недоступна. Ключ сохранён, подключение не подтверждено.',
  PROVIDER_UNAVAILABLE:'Площадка временно недоступна.',IDENTITY_NOT_VERIFIED:'Не удалось подтвердить кабинет площадки.',
  AUTHENTICATED_UNLINKED:'Ozon принял рекламный ключ. Связь с этим магазином ещё не подтверждена; рекламные отчёты пока недоступны.',
  PROVIDER_PLAN_REQUIRED:'Площадка ограничила доступ к API из-за состояния оплаты на её стороне.',
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

function KeyFields({kind,id,prefix='',optional=false}:{kind:StoreCredential['kind'];id:string;prefix?:string;optional?:boolean}){
  return <fieldset onInput={event=>{event.currentTarget.querySelectorAll('input').forEach(input=>input.setCustomValidity(''));}}>
    <legend>{kind==='PERFORMANCE'?'Ozon Performance API — реклама':kinds[kind]}{optional?' (необязательно)':''}</legend>
    {kind!=='WB'&&<label htmlFor={id+'-client'}>Client ID<input id={id+'-client'} name={prefix+'client_id'} required={!optional} maxLength={160} autoComplete="off"/></label>}
    <label htmlFor={id+'-secret'}>{kind==='WB'?'API-токен':kind==='SELLER'?'API-ключ':'Client Secret'}
      <input id={id+'-secret'} name={prefix+'secret'} type="password" required={!optional} minLength={12} maxLength={8192} autoComplete="new-password" spellCheck={false}/>
    </label>
  </fieldset>;
}
function material(form:FormData,kind:StoreCredential['kind'],prefix=''){
  const secret=String(form.get(prefix+'secret')||'');
  return kind==='WB'?{token:secret}:kind==='SELLER'?{client_id:String(form.get(prefix+'client_id')||''),api_key:secret}:{client_id:String(form.get(prefix+'client_id')||''),client_secret:secret};
}

export function StoresView({initial,recoveryScope}:{initial:StoreList;recoveryScope:string}){
  const [ready,setReady]=useState(false);
  const [list,setList]=useState(initial),[provider,setProvider]=useState<'OZON'|'WB'>('OZON'),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [pendingCreate,setPendingCreate]=useState<string|null>(null),[retryCreate,setRetryCreate]=useState(false),[storageReady,setStorageReady]=useState(false);
  const pendingKey=recoveryKey(recoveryScope);
  useEffect(()=>{
    function restore(){
      try{if(!navigator.locks)throw new Error('LOCK_UNAVAILABLE');setPendingCreate(readPendingCreate(pendingKey));setStorageReady(true);}
      catch{setStorageReady(false);setMessage('Браузер не позволяет восстановить добавление магазина. Разрешите хранение данных сайта и обновите страницу. Ключи не отправлены.');}
      setRetryCreate(false);
    }
    restore();setReady(true);
    const changed=(event:StorageEvent)=>{if(event.key===pendingKey||event.key===null)restore();};
    window.addEventListener('storage',changed);return ()=>window.removeEventListener('storage',changed);
  },[pendingKey]);
  function completeCreate(id:string){
    if(finishCreate(pendingKey,id)){setPendingCreate(null);setRetryCreate(false);return;}
    try{setPendingCreate(readPendingCreate(pendingKey));}catch{setStorageReady(false);}
    setRetryCreate(false);
  }
  async function recoverCreate(){
    if(!pendingCreate||!navigator.locks)return;
    await navigator.locks.request(pendingKey,{ifAvailable:true},async lock=>{
      if(!lock)throw new Error('Добавление уже выполняется в другой вкладке. Дождитесь результата.');
      const current=readPendingCreate(pendingKey);
      if(current&&current!==pendingCreate){setPendingCreate(current);setRetryCreate(false);return;}
      const value=await send({action:'command_status'},pendingCreate);
      if(value.outcome==='COMPLETED'){
        completeCreate(pendingCreate);setMessage('Магазин уже создан. Проверьте сохранённую карточку и отдельно доступ к рекламе.');
      }else{
        setRetryCreate(true);setMessage('Сохранение пока не подтверждено. Можно повторить это же добавление с прежними данными: повтор не создаст второй магазин.');
      }
    });
  }
  async function refresh(append=false){
    const suffix=append&&list.next_cursor?'?cursor='+encodeURIComponent(list.next_cursor):'';
    const response=await fetch('/api/account/stores'+suffix,{cache:'no-store'});
    if(response.status===401){window.location.assign('/login');throw new Error('Войдите в кабинет.');}
    if(!response.ok)throw new Error('Не удалось обновить список магазинов.');
    const value=await response.json() as StoreList;
    setList(previous=>({...value,items:append?[...previous.items,...value.items]:value.items}));
  }
  async function send(command:Command,commandId:string=crypto.randomUUID()){
    const response=await fetch('/api/account/stores',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...command,command_id:commandId})});
    if(response.status===401){window.location.assign('/login');throw new Error('Войдите в кабинет.');}
    const value=await response.json();
    if(!response.ok)throw new Error(messages[value.code]||'Не удалось выполнить действие. Обновите список перед повтором.');
    return value as {store?:Store;check_code?:string;state?:string;outcome?:'COMPLETED'|'UNKNOWN';store_id?:string};
  }
  async function perform(operation:()=>Promise<unknown>){
    if(busy)return;setBusy(true);setMessage('');
    try{await operation();await refresh();}
    catch(error){setMessage(error instanceof Error?error.message:'Не удалось получить ответ. Обновите список перед повтором.');try{await refresh();}catch{/* Keep the last known list. */}}
    finally{setBusy(false);}
  }
  async function check(store:Store,credential:StoreCredential,notify=true){
    const value=await send({action:'check',store_id:store.id,expected_revision:store.revision,credential_id:credential.id});
    if(notify)setMessage(value.state==='CHECKING'?'Проверка выполняется. Обновите список позже.':messages[value.check_code||'']||'Проверка завершена.');
    return value;
  }
  function createStore(form:HTMLFormElement){
    if(busy||!ready||!storageReady||(pendingCreate&&!retryCreate))return;
    const data=new FormData(form),kind=provider==='OZON'?'SELLER':'WB';
    const withPerformance=provider==='OZON'&&Boolean(data.get('performance_client_id')||data.get('performance_secret'));
    if(withPerformance){
      for(const name of ['performance_client_id','performance_secret']){
        if(!data.get(name)){
          const input=form.elements.namedItem(name) as HTMLInputElement;
          input.setCustomValidity('Для рекламы заполните Client ID и Client Secret либо оставьте оба поля пустыми.');
          input.reportValidity();return;
        }
      }
    }
    const command={action:'create',provider,name:String(data.get('name')||''),voice_alias:String(data.get('voice_alias')||''),credential:material(data,kind)};
    const performance=withPerformance?material(data,'PERFORMANCE','performance_'):null;
    if(!navigator.locks){setStorageReady(false);setMessage('Для безопасного добавления обновите браузер. Ключи не отправлены.');return;}
    void navigator.locks.request(pendingKey,{ifAvailable:true},async lock=>{
    if(!lock){setMessage('Добавление уже выполняется в другой вкладке. Дождитесь результата.');return;}
    let commandId:string;
    try{
      const existing=readPendingCreate(pendingKey);
      if(existing&&existing!==pendingCreate){setPendingCreate(existing);setRetryCreate(false);setMessage('Сначала восстановите предыдущее добавление магазина.');return;}
      commandId=pendingCreate||existing||crypto.randomUUID();persistCreate(pendingKey,commandId);
    }catch{setStorageReady(false);setMessage('Браузер не смог сохранить номер операции. Магазин и ключи не отправлены. Разрешите хранение данных сайта и обновите страницу.');return;}
    setPendingCreate(commandId);setRetryCreate(false);
    await perform(async()=>{
      form.reset();setProvider('OZON');
      const created=await send(command,commandId);
      if(!created.store)throw new Error('Восстановите результат добавления магазина перед повтором.');
      completeCreate(commandId);
      let store=created.store;
      // Persist both channels before provider checks. A failed Seller check
      // must not discard or prevent saving the separate advertising key.
      if(performance){
        try{
          const saved=await send({action:'credential',store_id:store.id,expected_revision:store.revision,kind:'PERFORMANCE',credential:performance});
          if(!saved.store)throw new Error();
          store=saved.store;
        }catch{throw new Error('Магазин уже создан. Не удалось подтвердить сохранение ключа рекламы. Обновите карточку и проверьте раздел «Реклама Ozon» перед повтором.');}
      }
      const results:string[]=[],channels:StoreCredential['kind'][]=performance?[kind,'PERFORMANCE']:[kind];
      for(const channel of channels){
        const credential=store.credentials.find(c=>c.kind===channel&&c.status==='PENDING');
        if(!credential)throw new Error('Магазин сохранён. Обновите карточку для проверки ключей.');
        const checked=await check(store,credential,false);
        results.push(kinds[channel]+': '+(checked.state==='CHECKING'?'Проверка выполняется.':messages[checked.check_code||'']||'Проверка завершена.'));
        if(checked.store)store=checked.store;
        if(checked.state==='CHECKING')break;
      }
      setMessage(results.join(' '));
    });
    }).catch(()=>{setMessage('Не удалось безопасно начать добавление. Обновите страницу.');});
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
    {pendingCreate&&<section aria-label="Незавершённое добавление"><h2>Проверьте предыдущее добавление</h2>
      <p>Не начинайте новое добавление, пока не получен результат предыдущего. Сохранён только номер операции, без ключей.</p>
      <button className="button" disabled={!ready||busy} onClick={()=>void perform(recoverCreate)}>Восстановить результат добавления</button>
    </section>}
    <section aria-label="Добавить магазин"><h2>Добавить магазин</h2>
      <form method="post" action="/api/account/stores" onSubmit={event=>{event.preventDefault();createStore(event.currentTarget);}}>
        <label htmlFor="store-provider">Маркетплейс</label><select id="store-provider" value={provider} disabled={!ready||busy} onChange={event=>setProvider(event.target.value as 'OZON'|'WB')}><option value="OZON">Ozon</option><option value="WB">Wildberries</option></select>
        <label htmlFor="store-name">Название магазина<input id="store-name" name="name" maxLength={80} required disabled={!ready||busy}/></label>
        <label htmlFor="store-alias">Как называть магазин голосом<input id="store-alias" name="voice_alias" maxLength={80} disabled={!ready||busy}/></label>
        <KeyFields key={provider} kind={provider==='OZON'?'SELLER':'WB'} id="new-store"/>
        {provider==='OZON'&&<>
          <p>Для этого же магазина можно сразу добавить отдельный доступ к рекламе или подключить его позже.</p>
          <KeyFields kind="PERFORMANCE" id="new-store-performance" prefix="performance_" optional/>
        </>}
        <p>Сохранённые ключи не показываются. Доступ к продажам и рекламе проверяется отдельно.</p>
        <button className="button" disabled={!ready||busy||!storageReady||!!pendingCreate&&!retryCreate}>{pendingCreate?'Повторить это же добавление':'Сохранить и проверить'}</button>
      </form>
    </section>
    <section aria-label="Сохранённые магазины"><h2>Сохранённые магазины</h2>
      {!list.items.length&&<p>Подключённых магазинов пока нет.</p>}
      {list.items.map(store=><section key={store.id} aria-label={'Магазин '+store.name} data-store-id={store.id}>
        <h3>{store.name} · {store.provider==='OZON'?'Ozon':'Wildberries'}</h3>
        <p><a href={'/app/owner-inputs?store='+encodeURIComponent(store.id)}>Себестоимость и расходы</a></p>
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
