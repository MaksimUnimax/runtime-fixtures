'use client';
import {useEffect,useState} from 'react';
type Addition={id:string;kind:'ALIAS'|'COMPOSE_EXISTING';purpose:string;template_ids:string[];answer_spec:{meaning:string;known_negatives:string[]}};
type Package={schema:'alisa-catalog-package/v1';engine_sha256:string;base_template_hash:string;qualification_sha256:string;additions:Addition[]};
type Validation={id:string;draft_revision:number;package_sha256:string;template_hash:string;engine_sha256:string;evidence?:Record<string,unknown>};
type Draft={id:string;candidate_id:string;revision:number;title:string;package_sha256:string;package?:Package;validation:Validation|null};
type Assignment={tenant_id:string;revision:number;applied_revision:number;desired_package_sha256:string;observed_package_sha256:string;observed_template_hash:string;state:string};
type Overview={drafts:Draft[];releases:{package_sha256:string;release_id:string;title:string;created_at:string}[];assignments:Assignment[];pending:{request_id:string;tenant_id:string;revision:number;outcome:Outcome}[];pilot_tenants:{id:string;label:string}[];decisions:{action:string;object_id:string;facts:Record<string,unknown>;created_at:string}[]};
type Outcome={state:string;request_id?:string;revision?:number};
type Template={id:string;purpose:string;kind:string;platforms:string[];input_policy:Record<string,unknown>};
type Info={engine_sha256:string;base_template_hash:string;qualification_sha256:string;proof:{level:string;scope:string;artifact_sha256:string}};
const messages:Record<string,string>={
 CATALOG_FORBIDDEN:'Нужен повторный вход или разрешение на это действие.',
 CATALOG_REVISION_CONFLICT:'Черновик уже изменён. Откройте его заново.',
 CATALOG_ASSIGNMENT_CONFLICT:'Версия клиента уже изменилась. Обновите состояние.',
 CATALOG_PUBLICATION_PENDING:'Предыдущая публикация ещё не сверена с ядром. Сначала проверьте её состояние.',
 CATALOG_APPROVAL_HASH_MISMATCH:'Пакет изменился после проверки. Проверьте и одобрите новую версию.',
 CATALOG_ENGINE_MISMATCH:'Изменилась основа ядра. Проверьте пакет на установленной версии.',
 CATALOG_QUALIFICATION_MISSING:'Для этой версии ещё нет подтверждённого отчёта проверки.',
 CATALOG_QUALIFICATION_INVALID:'Не удалось подтвердить отчёт проверки установленной версии.',
 CATALOG_QUALIFICATION_CHANGED:'Отчёт проверки изменился. Выполните проверку пакета заново.',
 CATALOG_INPUT_CONTRACT_MISMATCH:'У выбранных шаблонов различаются периоды или условия. Выберите совместимые.',
 CATALOG_PLATFORM_MISMATCH:'У выбранных шаблонов нет общей площадки.',
 CATALOG_SOURCE_UNQUALIFIED:'Выберите уже зарегистрированные шаблоны с проверенными источниками.',
 CATALOG_SEMANTIC_COLLISION:'Такое описание уже есть в каталоге. Уточните смысл нового шаблона.',
 CATALOG_ID_COLLISION:'Этот идентификатор уже занят. Создайте новый черновик.',
 CATALOG_SENSITIVE_CONTENT:'Уберите адреса, телефоны, ключи и другие личные сведения.',
 CATALOG_PACKAGE_TOO_LARGE:'Пакет слишком большой. Уменьшите число шаблонов или описания.',
 CATALOG_CORE_CHANGE_REQUIRED:'Для этого изменения нужна отдельная проверка ядра.',
 CATALOG_TENANT_NOT_ALLOWED:'Выберите клиента из настроенного тестового списка.',
 CATALOG_TENANT_NOT_BOUND:'У выбранного тестового клиента ещё нет подходящего подключения.',
 CATALOG_BINDING_CHANGED:'Подключение клиента изменилось. Обновите состояние перед публикацией.',
 INVALID_PAYLOAD:'Проверьте поля и размер пакета.',STAFF_UNAVAILABLE:'Связь прервана. Если отправляли публикацию, проверьте её по сохранённому запросу.',
 CATALOG_INCOMPATIBLE:'Установленная версия ядра пока несовместима с этим действием.'};
const stateLabel:Record<string,string>={BASELINE:'Исходная версия',PENDING:'Ожидает сверки',APPLIED:'Подтверждено ядром',CONFLICT:'Нужна сверка версий',SUPERSEDED:'Уже есть более новое назначение'};
const newAddition=():Addition=>({id:'C'+crypto.randomUUID().replaceAll('-',''),kind:'ALIAS',purpose:'',template_ids:[],answer_spec:{meaning:'',known_negatives:[]}});

async function request<T>(action:string,filters:Record<string,unknown>):Promise<T>{
 const r=await fetch('/api/staff/catalog-changes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,filters})});
 const data=await r.json() as Record<string,unknown>;
 if(!r.ok){if(r.status===401||r.status===403)throw new Error(messages.CATALOG_FORBIDDEN);throw new Error(messages[String(data.code)]||'Не удалось выполнить действие. Обновите состояние и повторите.');}
 return data as T;
}

export function Releases({permissions,initialCandidate}:{permissions:string[];initialCandidate:string}){
 const edit=permissions.includes('catalog.edit'),approve=permissions.includes('catalog.approve'),publish=permissions.includes('catalog.publish');
 const [overview,setOverview]=useState<Overview|null>(null),[info,setInfo]=useState<Info|null>(null),[templates,setTemplates]=useState<Template[]>([]);
 const [query,setQuery]=useState(''),[next,setNext]=useState<number|null>(null),[candidate,setCandidate]=useState(initialCandidate);
 const [draft,setDraft]=useState<Draft|null>(null),[rows,setRows]=useState<Addition[]>([newAddition()]),[dirty,setDirty]=useState(false),[reviewed,setReviewed]=useState(false);
 const [tenant,setTenant]=useState(''),[release,setRelease]=useState(''),[rollback,setRollback]=useState(''),[uncertain,setUncertain]=useState('');
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 async function reload(){setOverview(await request<Overview>('list',{}));}
 async function find(offset=0){
  const result=await request<{items:Template[];next_offset:number|null}>('templates',{query,offset});
  setTemplates(old=>[...new Map([...old,...result.items].map(x=>[x.id,x])).values()]);setNext(result.next_offset);
 }
 useEffect(()=>{void reload().catch(()=>setMessage('Не удалось загрузить выпуски.'));void request<Info>('info',{}).then(setInfo).catch(()=>setMessage('Проверка установленного ядра пока недоступна.'));void find().catch(()=>{});},[]);
 async function perform(action:()=>Promise<void>){
  setBusy(true);setMessage('');try{await action();await reload();}catch(error){setMessage(error instanceof Error?error.message:'Связь прервана. Обновите состояние.');}finally{setBusy(false);}
 }
 function choose(value:Draft){setDraft(value);setCandidate(value.candidate_id);setRows(value.package?.additions||[]);setDirty(false);setReviewed(false);}
 function patch(index:number,value:Partial<Addition>){setRows(old=>old.map((r,i)=>i===index?{...r,...value}:r));setDirty(true);setReviewed(false);}
 async function save(){
  if(!info)throw new Error('Сначала дождитесь проверки установленного ядра.');
  const value:Package={schema:'alisa-catalog-package/v1',engine_sha256:info.engine_sha256,base_template_hash:info.base_template_hash,
   qualification_sha256:info.qualification_sha256,
   additions:rows.map(row=>({...row,purpose:row.purpose.trim(),answer_spec:{meaning:row.answer_spec.meaning.trim(),known_negatives:row.answer_spec.known_negatives.map(x=>x.trim()).filter(Boolean)}}))};
  const result=await request<Draft>(draft?'draft.edit':'draft.create',draft?{draft_id:draft.id,expected_revision:draft.revision,package:value}:{candidate_id:candidate,package:value});
  choose(result);setMessage('Черновик сохранён.');
 }
 async function check(){if(!draft)return;choose(await request<Draft>('validate',{draft_id:draft.id,expected_revision:draft.revision}));setMessage('Проверка пройдена. Перед одобрением проверьте смысл и известные ограничения.');}
 async function accept(){
  if(!draft?.validation)return;
  const result=await request<{package_sha256:string}>('approve',{draft_id:draft.id,expected_revision:draft.revision,validation_id:draft.validation.id,package_sha256:draft.package_sha256,reviewed});
  setRelease(result.package_sha256);setReviewed(false);setMessage('Точный пакет одобрен. Для включения выберите тестового клиента.');
 }
 function showOutcome(value:Outcome){setMessage(stateLabel[value.state]||'Состояние обновлено.');if(value.state==='APPLIED')setUncertain('');}
 async function assign(action:'publish'|'rollback'){
  const requestId=crypto.randomUUID();setUncertain(requestId);
  const expected=overview?.assignments.find(x=>x.tenant_id===tenant)?.revision||0;
  showOutcome(await request<Outcome>(action,{request_id:requestId,tenant_id:tenant,expected_revision:expected,package_sha256:action==='publish'?release:rollback}));
 }
 const valid=!!draft?.validation&&draft.validation.draft_revision===draft.revision&&draft.validation.package_sha256===draft.package_sha256;
 const current=overview?.assignments.find(x=>x.tenant_id===tenant);
 return <main><p><a href="/admin">Админка</a> · <a href="/admin/query-insights">Журнал вопросов</a> · <a href="/admin/catalog">Действующий каталог</a></p>
  <h1>Проверка и публикация шаблонов</h1><p>Выпуск включает только одобренный пакет. Уже принятые задания завершаются на своей версии.</p>
  <p role="status">{message}</p><button disabled={busy} onClick={()=>void perform(reload)}>Обновить состояние</button>
  <section><h2>Черновики</h2><ul>{overview?.drafts.map(row=><li key={row.id}>{row.title} · версия {row.revision} <button disabled={busy} onClick={()=>void perform(async()=>choose(await request<Draft>('draft.read',{draft_id:row.id})))}>Открыть</button></li>)}</ul>
   {edit&&<button disabled={busy} onClick={()=>{setDraft(null);setRows([newAddition()]);setDirty(false);setReviewed(false);}}>Новый черновик</button>}
  </section>
  {(edit||draft)&&<section><h2>{draft?'Карточка черновика':'Новый шаблон из потребности'}</h2>
   {edit&&<form onSubmit={e=>{e.preventDefault();void perform(()=>find());}}><label>Найти готовый шаблон<input value={query} maxLength={200} onChange={e=>setQuery(e.target.value)}/></label><button disabled={busy}>Найти</button>{next!==null&&<button type="button" disabled={busy} onClick={()=>void perform(()=>find(next))}>Загрузить ещё</button>}</form>}
   <form onSubmit={e=>{e.preventDefault();void perform(save);}}><label>Карточка потребности<input required readOnly={!!draft||!edit} value={candidate} pattern="[0-9a-f-]{36}" onChange={e=>setCandidate(e.target.value)}/></label>
    {rows.map((row,index)=><fieldset key={row.id} disabled={busy||!edit}><legend>Шаблон {index+1}</legend>
     <label>Название и назначение<input required maxLength={800} value={row.purpose} onChange={e=>patch(index,{purpose:e.target.value})}/></label>
     <label>Вид изменения<select value={row.kind} onChange={e=>{const kind=e.target.value as Addition['kind'];patch(index,{kind,template_ids:kind==='ALIAS'?row.template_ids.slice(0,1):row.template_ids});}}><option value="ALIAS">Переиспользовать готовый шаблон</option><option value="COMPOSE_EXISTING">Объединить готовые шаблоны</option></select></label>
     <label>Готовые шаблоны<select required multiple={row.kind==='COMPOSE_EXISTING'} size={row.kind==='COMPOSE_EXISTING'?6:1} value={row.kind==='ALIAS'?(row.template_ids[0]||''):row.template_ids}
      onChange={e=>patch(index,{template_ids:Array.from(e.currentTarget.selectedOptions).map(x=>x.value).filter(Boolean)})}>
      {row.kind==='ALIAS'&&<option value="">Выберите шаблон</option>}{row.template_ids.filter(id=>!templates.some(t=>t.id===id)).map(id=><option key={id} value={id}>{id}</option>)}
      {templates.map(t=><option key={t.id} value={t.id}>{t.purpose}</option>)}</select></label>
     <label>Что должен означать ответ<textarea required maxLength={1200} value={row.answer_spec.meaning} onChange={e=>patch(index,{answer_spec:{...row.answer_spec,meaning:e.target.value}})}/></label>
     <label>Когда шаблон не подходит — до десяти пунктов, каждый с новой строки<textarea required maxLength={3000} value={row.answer_spec.known_negatives.join('\n')} onChange={e=>patch(index,{answer_spec:{...row.answer_spec,known_negatives:e.target.value.split('\n')}})}/></label>
     {rows.length>1&&<button type="button" onClick={()=>{setRows(old=>old.filter((_,i)=>i!==index));setDirty(true);setReviewed(false);}}>Убрать из пакета</button>}
    </fieldset>)}
    {edit&&<><button type="button" disabled={busy||rows.length>=20} onClick={()=>{setRows(old=>[...old,newAddition()]);setDirty(true);setReviewed(false);}}>Добавить шаблон в пакет</button><button disabled={busy||!info}>Сохранить черновик</button></>}
   </form>
   {draft&&<><p>{valid?'Сохранённая версия проверена.':'Сохранённой версии нужна проверка.'}{dirty?' Есть несохранённые изменения.':''}</p>
    {edit&&<button disabled={busy||dirty} onClick={()=>void perform(check)}>Проверить пакет</button>}
    {draft.validation&&<details><summary>Подтверждение проверки</summary><p>Отпечаток пакета: <code>{draft.package_sha256}</code></p><p>Проверка источников наследуется только для неизменённых привязок готовых шаблонов.</p></details>}
    {approve&&<><label><input type="checkbox" checked={reviewed} disabled={busy||dirty||!valid} onChange={e=>setReviewed(e.target.checked)}/>Смысл ответа и ограничения проверены; одобряю показанный точный пакет.</label><button disabled={busy||dirty||!valid||!reviewed} onClick={()=>void perform(accept)}>Одобрить пакет</button></>}
   </>}
  </section>}
  <section><h2>Включение на тестовых клиентах</h2><p>Публикация считается завершённой после подтверждения ядром. Откат меняет версию для следующих заданий.</p>
   {!overview?.pilot_tenants.length&&<p>Тестовые клиенты для публикации пока не настроены.</p>}
   {publish&&<><label>Тестовый клиент<select value={tenant} disabled={busy} onChange={e=>setTenant(e.target.value)}><option value="">Выберите клиента</option>{overview?.pilot_tenants.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
    <label>Одобренный выпуск<select value={release} disabled={busy} onChange={e=>setRelease(e.target.value)}><option value="">Выберите выпуск</option>{overview?.releases.map(r=><option key={r.package_sha256} value={r.package_sha256}>{r.title} · {r.release_id}</option>)}</select></label>
    <button disabled={busy||!tenant||!release||current?.state==='PENDING'} onClick={()=>void perform(()=>assign('publish'))}>Включить на выбранном клиенте</button>
    <label>Версия для отката<select value={rollback} disabled={busy} onChange={e=>setRollback(e.target.value)}><option value="">Исходный каталог</option>{overview?.releases.map(r=><option key={r.package_sha256} value={r.package_sha256}>{r.title} · {r.release_id}</option>)}</select></label>
    <button disabled={busy||!tenant||current?.state==='PENDING'} onClick={()=>void perform(()=>assign('rollback'))}>Откатить выбранного клиента</button>
   </>}
   <ul>{overview?.assignments.map(a=><li key={a.tenant_id}>{overview.pilot_tenants.find(p=>p.id===a.tenant_id)?.label||a.tenant_id} · {stateLabel[a.state]||a.state} · назначение {a.revision}, подтверждено {a.applied_revision}</li>)}</ul>
   {publish&&uncertain&&!overview?.pending.some(x=>x.request_id===uncertain)&&<button disabled={busy} onClick={()=>void perform(async()=>showOutcome(await request<Outcome>('retry',{request_id:uncertain})))}>Проверить отправленную публикацию</button>}
   <ul>{overview?.pending.map(p=><li key={p.request_id}>{p.tenant_id} · {stateLabel[p.outcome.state]||'Ожидает сверки'} {publish&&<button disabled={busy} onClick={()=>void perform(async()=>showOutcome(await request<Outcome>('retry',{request_id:p.request_id})))}>Сверить с ядром</button>}</li>)}</ul>
  </section>
  <section><h2>Последние решения</h2><ul>{overview?.decisions.map((d,i)=><li key={i}>{new Date(d.created_at).toLocaleString('ru-RU')} · {({DRAFT_CREATED:'Черновик создан',DRAFT_EDITED:'Черновик изменён',VALIDATED:'Проверка пройдена',VALIDATION_REJECTED:'Проверка не пройдена',APPROVED:'Пакет одобрен',PUBLICATION_REQUESTED:'Назначение сохранено',READBACK_APPLIED:'Включение подтверждено ядром'} as Record<string,string>)[d.action]||'Состояние обновлено'}</li>)}</ul></section>
 </main>;
}
