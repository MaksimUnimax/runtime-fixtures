import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {authEnabled,getProfile,SESSION_COOKIE} from '../../../server/auth';
import {getStores} from '../../../server/stores';
import {OwnerInputsView} from './view';
export const dynamic='force-dynamic';
export const metadata={title:'Себестоимость и расходы',robots:{index:false,follow:false}};
export default async function OwnerInputsPage({searchParams}:{searchParams:Promise<{store?:string}>}){
  if(!authEnabled())redirect('/login');
  const token=(await cookies()).get(SESSION_COOKIE)?.value||'';const profile=await getProfile(token);if(!profile)redirect('/login');
  if(process.env.ALISA_OWNER_DATA_ENABLED!=='1')return <main className="site"><article className="article"><h1>Себестоимость и расходы</h1><p>Раздел ещё не включён. Параметры магазинов не изменены.</p><a href="/app/stores">Мои магазины</a></article></main>;
  let stores;try{stores=await getStores(token);}catch{return <main className="site"><h1>Магазины временно недоступны</h1><p>Данные не изменены. Обновите страницу.</p></main>;}
  const selected=(await searchParams).store||'';
  return <main className="site"><article className="article"><a href="/app/stores">Мои магазины</a><h1>Себестоимость и расходы</h1>{process.env.ALISA_OWNER_PARAMETERS_ENABLED==='1'&&<p><a href={'/app/parameters'+(selected?'?store='+encodeURIComponent(selected):'')}>Коэффициенты и дата расчёта</a></p>}<p>Эти параметры используются только после вашего подтверждения. Неизвестные суммы не заменяются нулями.</p>{stores?<OwnerInputsView stores={stores.items} initialStore={selected} recoveryScope={profile.tenant_id+':'+profile.customer_id}/>:<p>Сначала подключите магазин.</p>}</article></main>;
}
