import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {getProfile,SESSION_COOKIE} from '../../../server/auth';
import {queriesEnabled} from '../../../server/queries';
import {getStores} from '../../../server/stores';
import {Queries} from './queries';
export const dynamic='force-dynamic';
export const metadata={title:'Задания',robots:{index:false,follow:false},referrer:'same-origin'};
export default async function Page(){
  if(!queriesEnabled())return <main className="site"><h1>Задания пока недоступны</h1><a href="/app">В кабинет</a></main>;
  const token=(await cookies()).get(SESSION_COOKIE)?.value||'';
  let stores,profile;
  try{profile=await getProfile(token);stores=profile?await getStores(token):null;}catch{return <main className="site"><h1>Задания временно недоступны</h1><a href="/app">В кабинет</a></main>;}
  if(!profile)redirect('/login');
  return <main className="site"><article className="article"><a href="/app">Мой кабинет</a><h1>Задания</h1><p>Вопросы из Алисы и кабинета. <a href="/app/reports">Документы маркетплейсов доступны для скачивания 48 часов.</a></p><Queries hasMoreStores={!!stores?.next_cursor} stores={(stores?.items||[]).filter(s=>s.status==='ACTIVE'&&s.identity_verified).map(s=>({id:s.id,name:s.name,provider:s.provider}))}/></article></main>;
}
