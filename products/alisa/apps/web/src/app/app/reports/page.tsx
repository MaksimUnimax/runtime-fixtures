import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {getProfile,SESSION_COOKIE} from '../../../server/auth';
import {queriesEnabled} from '../../../server/queries';
import {getStores} from '../../../server/stores';
import {Reports} from './reports';
export const dynamic='force-dynamic';
export const metadata={title:'Отчёты',robots:{index:false,follow:false},referrer:'same-origin'};
export default async function Page(){
  if(!queriesEnabled())return <main className="site"><h1>Отчёты пока недоступны</h1><a href="/app">В кабинет</a></main>;
  const token=(await cookies()).get(SESSION_COOKIE)?.value||'';
  let profile,stores;
  try{profile=await getProfile(token);if(profile)stores=await getStores(token);}catch{return <main className="site"><h1>Отчёты временно недоступны</h1><a href="/app">В кабинет</a></main>;}
  if(!profile)redirect('/login');
  return <main className="site"><article className="article"><a href="/app">Мой кабинет</a><h1>Отчёты</h1><Reports stores={(stores?.items||[]).filter(s=>s.status==='ACTIVE'&&s.identity_verified).map(s=>({id:s.id,name:s.name,provider:s.provider}))}/><p><a href="/app/queries">Задать вопрос</a></p></article></main>;
}
