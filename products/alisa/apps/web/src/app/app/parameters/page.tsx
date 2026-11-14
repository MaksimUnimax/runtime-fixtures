import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {authEnabled,getProfile,SESSION_COOKIE} from '../../../server/auth';
import {getStores} from '../../../server/stores';
import {ParametersView} from './view';
export const dynamic='force-dynamic';
export const metadata={title:'Коэффициенты и дата расчёта',robots:{index:false,follow:false}};
export default async function ParametersPage({searchParams}:{searchParams:Promise<{store?:string}>}){
 if(!authEnabled())redirect('/login');
 const token=(await cookies()).get(SESSION_COOKIE)?.value||'';const profile=await getProfile(token);if(!profile)redirect('/login');
 if(process.env.ALISA_OWNER_PARAMETERS_ENABLED!=='1'||process.env.ALISA_OWNER_DATA_ENABLED!=='1')return <main className="site"><article className="article"><h1>Коэффициенты</h1><p>Раздел ещё не включён. Настройки магазина не изменены.</p><a href="/app/owner-inputs">Себестоимость и расходы</a></article></main>;
 try{
  const stores=await getStores(token);const initial=(await searchParams).store||'';
  return <main className="site"><article className="article"><a href="/app/owner-inputs">Себестоимость и расходы</a><h1>Коэффициенты</h1><p>Используется одно текущее значение. Оно не обновляется автоматически. При сохранении нового прежнее значение заменяется без истории.</p><ParametersView stores={stores?.items||[]} initialStore={initial} recoveryScope={profile.tenant_id+':'+profile.customer_id}/></article></main>;
 }catch{return <main className="site"><h1>Магазины временно недоступны</h1><p>Данные не изменены. Обновите страницу.</p></main>;}
}
