import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {authEnabled,getProfile,SESSION_COOKIE} from '../../../server/auth';
import {getAccess} from '../../../server/access';
import {AccessView} from './view';

export const dynamic='force-dynamic';
export const metadata={title:'Доступ к Алисе',robots:{index:false,follow:false}};
export default async function AccessPage(){
  if(!authEnabled())redirect('/login');
  const token=(await cookies()).get(SESSION_COOKIE)?.value||'';
  let profile;
  try{profile=await getProfile(token);}catch{
    return <main className="site"><h1>Доступ временно недоступен</h1><p>Обновите страницу позже.</p></main>;
  }
  if(!profile)redirect('/login');
  let access;
  try{access=await getAccess(token);}catch{
    return <main className="site"><h1>Доступ временно недоступен</h1><p>Обновите страницу позже.</p></main>;
  }
  return <main className="site"><article className="article"><a href="/app">Вернуться в кабинет</a><h1>Доступ к Алисе</h1>
    {access?<AccessView initial={access}/>:<p>Раздел доступа пока недоступен.</p>}
  </article></main>;
}
