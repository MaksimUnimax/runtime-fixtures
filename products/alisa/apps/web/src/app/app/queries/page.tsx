import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {getProfile,SESSION_COOKIE} from '../../../server/auth';
import {queriesEnabled} from '../../../server/queries';
import {getStores} from '../../../server/stores';
import {Queries} from './queries';
import {queryStores} from './store-pages';
export const dynamic='force-dynamic';
export const metadata={title:'Задания',robots:{index:false,follow:false},referrer:'same-origin'};
export default async function Page({searchParams}:{searchParams:Promise<{question?:string;store_id?:string}>}){
  const params=await searchParams;
  const initialStoreId=typeof params.store_id==='string'?params.store_id:'';
  const initialQuestion=typeof params.question==='string'?params.question.slice(0,1200):'';
  if(!queriesEnabled())return <main className="site"><h1>Задания пока недоступны</h1><a href="/app">В кабинет</a></main>;
  const token=(await cookies()).get(SESSION_COOKIE)?.value||'';
  let stores,profile;
  try{profile=await getProfile(token);stores=profile?await getStores(token):null;}catch{return <main className="site"><h1>Задания временно недоступны</h1><a href="/app">В кабинет</a></main>;}
  if(!profile)redirect('/login');
  return <main className="site"><article className="article"><a href="/app">Мой кабинет</a><h1>Задания</h1><p>Вопросы из Алисы и кабинета. <a href="/app/reports">Документы маркетплейсов доступны для скачивания 48 часов.</a></p><Queries initialStoreId={initialStoreId} initialQuestion={initialQuestion} nextStoreCursor={stores?.next_cursor||null} stores={queryStores(stores?.items||[])}/></article></main>;
}
