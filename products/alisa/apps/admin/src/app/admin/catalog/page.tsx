import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {accountApi,authEnabled,getProfile,readCookieHeader,SESSION_COOKIE} from '../../../server/auth';
export const dynamic='force-dynamic';
export const metadata={title:'Каталог вопросов',robots:{index:false,follow:false},referrer:'same-origin'};
export default async function Page(){
  if(!authEnabled()||process.env.ALISA_QUESTION_CATALOG_ENABLED!=='1')return <main><h1>Каталог пока недоступен</h1></main>;
  const token=readCookieHeader((await headers()).get('cookie'),SESSION_COOKIE);
  let staff,result;
  try{staff=await getProfile(token);if(staff?.permissions.includes('staff.manage'))result=await accountApi('catalog',{session_token:token});}
  catch{return <main><h1>Каталог временно недоступен</h1><a href="/admin">В админку</a></main>;}
  if(!staff)redirect('/login');
  if(!staff.permissions.includes('staff.manage'))return <main><h1>Нет разрешения на просмотр каталога</h1><a href="/admin">В админку</a></main>;
  if(!result||result.status!==200)return <main><h1>Каталог недоступен</h1><p>Проверьте совместимость установленного ядра.</p><a href="/admin">В админку</a></main>;
  const value=result.body as {template_hash:string;items:{id:string;version:number;kind:string;description:string;metrics:string[];dependencies:string[];sources:Record<string,string>[]}[]};
  return <main><a href="/admin">В админку</a><h1>Действующий каталог вопросов</h1><p>Только просмотр. Источник — текущая версия аналитического ядра. Изменение и публикация шаблонов выполняются отдельной процедурой.</p><p>Отпечаток каталога: <code>{value.template_hash}</code></p><ul>{value.items.map(row=><li key={row.id}><h2>{row.id} · версия {row.version}</h2><p>{row.description}</p><p>Тип: {row.kind}. Показатели: {row.metrics.join(', ')||'не применимо'}. Зависимости: {row.dependencies.join(', ')||'нет'}.</p><details><summary>Зарегистрированные источники</summary><ul>{row.sources.map((s,i)=><li key={i}>{Object.entries(s).map(([k,v])=>`${k}: ${v}`).join(' · ')}</li>)}</ul></details></li>)}</ul></main>;
}
