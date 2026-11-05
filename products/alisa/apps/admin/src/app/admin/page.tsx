import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {authEnabled,getProfile,SESSION_COOKIE} from '../../server/auth';
import {Dashboard} from './ui';
export const dynamic='force-dynamic';
export default async function Admin(){
  if(!authEnabled())return <main><h1>Админка ещё не открыта</h1></main>;
  let staff;
  try{staff=await getProfile((await cookies()).get(SESSION_COOKIE)?.value||'');}
  catch{return <main><h1>Админка временно недоступна</h1><p>Повторите вход позже.</p></main>;}
  if(!staff)redirect('/login');
  return <Dashboard staff={staff}/>;
}
