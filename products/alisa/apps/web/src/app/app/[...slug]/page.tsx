import {cookies} from 'next/headers';
import {notFound,redirect} from 'next/navigation';
import {authEnabled,getProfile,SESSION_COOKIE} from '../../../server/auth';
export default async function UnknownPrivateObject(){
  if(!authEnabled())return <main className="site"><h1>Личный кабинет ещё не открыт</h1><p>Персональные данные здесь не отображаются.</p></main>;
  if(authEnabled()&&!await getProfile((await cookies()).get(SESSION_COOKIE)?.value||''))redirect('/login');
  notFound();
}
