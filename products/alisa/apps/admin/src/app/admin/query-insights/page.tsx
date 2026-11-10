import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {authEnabled,getProfile,readCookieHeader,SESSION_COOKIE} from '../../../server/auth';
import {Journal} from './journal';
export const dynamic='force-dynamic';
export default async function Page(){
  if(!authEnabled())return <main><h1>Журнал пока недоступен</h1></main>;
  let staff;
  try{staff=await getProfile(readCookieHeader((await headers()).get('cookie'),SESSION_COOKIE));}
  catch{return <main><h1>Журнал временно недоступен</h1><a href="/admin">Вернуться в админку</a></main>;}
  if(!staff)redirect('/login');
  if(!staff.permissions.includes('insights.read'))return <main><h1>Нет разрешения на просмотр журнала</h1><a href="/admin">Вернуться в админку</a></main>;
  return <Journal canExport={staff.permissions.includes('insights.export')}/>;
}
