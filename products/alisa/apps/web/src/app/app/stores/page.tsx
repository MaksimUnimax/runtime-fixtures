import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {authEnabled,getProfile,SESSION_COOKIE} from '../../../server/auth';
import {getStores} from '../../../server/stores';
import {StoresView} from './view';
export const dynamic='force-dynamic';
export const metadata={title:'Мои магазины',robots:{index:false,follow:false}};
export default async function StoresPage(){
  if(!authEnabled())redirect('/login');
  const token=(await cookies()).get(SESSION_COOKIE)?.value||'';
  let profile,stores;
  try{profile=await getProfile(token);if(profile)stores=await getStores(token);}catch{
    return <main className="site"><h1>Магазины временно недоступны</h1><p>Обновите страницу позже.</p></main>;
  }
  if(!profile)redirect('/login');
  return <main className="site"><article className="article"><a href="/app">Вернуться в кабинет</a><h1>Мои магазины</h1>
    {stores?<StoresView initial={stores} recoveryScope={profile.tenant_id+':'+profile.customer_id}/>:<p>Подключение магазинов пока недоступно.</p>}
  </article></main>;
}
