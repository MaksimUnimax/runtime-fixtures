'use client';
import {useEffect,useState} from 'react';
type Store={id:string;name:string;provider:string};
type File={id:string;run_id:string;template:{id:string;name:string;version:number};filename:string;bytes:number;created_at:number;expires_at:number;error:string|null};
const date=(value:number)=>new Date(value*1000).toLocaleString('ru-RU');
const messages:Record<string,string>={ACCESS_REQUIRED:'Для просмотра документов нужен действующий доступ к сервису.',AUTH_REQUIRED:'Войдите в кабинет заново.',CREDENTIAL_REVOKED:'Проверьте подключение магазина.',PERMISSION_DENIED:'Доступ к документам закрыт.',CAPABILITY_UNAVAILABLE:'Хранение документов пока недоступно.',NOT_FOUND:'Документ больше недоступен.',RESULT_EXPIRED:'Срок хранения документа истёк.'};
export function Reports({stores}:{stores:Store[]}){
  const [store,setStore]=useState(stores[0]?.id||''),[files,setFiles]=useState<File[]>([]),[cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  async function load(more=false){
    if(!store||busy)return;setBusy(true);setMessage('');
    try{
      const query=new URLSearchParams({store});if(more&&cursor)query.set('cursor',cursor);
      const r=await fetch('/api/v1/reports?'+query,{cache:'no-store'}),value=await r.json();
      if(!r.ok)throw new Error(value.code);
      setFiles(old=>Array.from(new Map([...(more?old:[]),...value.items].map((f:File)=>[f.id,f])).values()) as File[]);
      setCursor(value.next_cursor);
    }catch(e){setMessage(messages[(e as Error).message]||'Не удалось загрузить документы. Повторите позже.');}
    finally{setBusy(false);}
  }
  useEffect(()=>{setFiles([]);setCursor(null);if(store)void load();},[store]);
  useEffect(()=>{
    if(!files.length)return;
    const timer=setTimeout(()=>setFiles(old=>old.filter(f=>f.expires_at*1000>Date.now())),Math.max(0,Math.min(...files.map(f=>f.expires_at*1000))-Date.now()));
    return ()=>clearTimeout(timer);
  },[files]);
  const groups=Array.from(new Set(files.map(f=>f.run_id))).map(id=>files.filter(f=>f.run_id===id));
  return <section aria-label="Документы маркетплейсов"><p>Документы доступны 48 часов с момента получения. Скачивание использует сохранённый файл.</p>
    {stores.length?<><label>Магазин<select value={store} onChange={e=>setStore(e.target.value)} disabled={busy}>{stores.map(s=><option key={s.id} value={s.id}>{s.name} · {s.provider}</option>)}</select></label><button disabled={busy} onClick={()=>void load()}>Обновить документы</button></>:<p>Сначала <a href="/app/stores">подключите магазин</a>.</p>}
    <p role="status">{message}</p>{!files.length&&!busy&&<p>Сохранённых документов пока нет.</p>}
    {!!groups.length&&<table><thead><tr><th>Шаблон</th><th>Получено</th><th>Документы</th></tr></thead><tbody>{groups.map(group=><tr key={group[0].run_id}>
      <td>{group[0].template.name}</td><td>{date(Math.min(...group.map(f=>f.created_at)))}</td>
      <td><ul>{group.map(file=><li key={file.id}>{file.error?<span>Не удалось сохранить документ: недостаточно места.</span>:<a href={'/api/v1/reports/'+file.id+'?store='+encodeURIComponent(store)} download>{file.filename} — скачать ({Math.ceil(file.bytes/1024)} КБ)</a>}<small> · до {date(file.expires_at)}</small></li>)}</ul></td>
    </tr>)}</tbody></table>}{cursor&&<button disabled={busy} onClick={()=>void load(true)}>Показать ещё</button>}
  </section>;
}
