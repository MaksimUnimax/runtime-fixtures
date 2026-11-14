import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {authEnabled,getProfile,readCookieHeader,SESSION_COOKIE} from '../../server/auth';
import {Dashboard} from './ui';
export const dynamic='force-dynamic';
export default async function Admin(){
  if(!authEnabled())return <main><h1>Админка ещё не открыта</h1></main>;
  let staff;
  try{staff=await getProfile(readCookieHeader((await headers()).get('cookie'),SESSION_COOKIE));}
  catch{return <main><h1>Админка временно недоступна</h1><p>Повторите вход позже.</p></main>;}
  if(!staff)redirect('/login');
  return <>{process.env.ALISA_QUESTION_CATALOG_ENABLED==='1'&&staff.permissions.includes('staff.manage')&&<p><a href="/admin/catalog">Каталог вопросов</a></p>}<Dashboard staff={staff}/></>;
}
