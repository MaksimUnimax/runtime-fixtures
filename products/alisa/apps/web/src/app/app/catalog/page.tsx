import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {getProfile,SESSION_COOKIE} from '../../../server/auth';
import {getStores} from '../../../server/stores';
import {catalogEnabled} from '../../../server/question-catalog';
import {queryStores} from '../queries/store-pages';
import {Catalog} from './catalog';
export const dynamic='force-dynamic';
export const metadata={title:'Поддерживаемые вопросы',robots:{index:false,follow:false},referrer:'same-origin'};
export default async function Page(){
  if(!catalogEnabled())return <main className="site"><h1>Каталог вопросов пока недоступен</h1><a href="/app">В кабинет</a></main>;
  const token=(await cookies()).get(SESSION_COOKIE)?.value||'';
  let profile,stores;
  try{profile=await getProfile(token);if(profile)stores=await getStores(token);}catch{return <main className="site"><h1>Каталог временно недоступен</h1><a href="/app">В кабинет</a></main>;}
  if(!profile)redirect('/login');
  return <main className="site"><article className="article"><a href="/app">Мой кабинет</a><h1>Поддерживаемые вопросы</h1><p>Выберите магазин, найдите показатель и проверьте его смысл. Просмотр каталога не запускает расчёт.</p><Catalog initialStores={queryStores(stores?.items||[])} nextCursor={stores?.next_cursor||null}/></article></main>;
}
