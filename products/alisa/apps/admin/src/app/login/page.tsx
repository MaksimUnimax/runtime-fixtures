import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {authEnabled,getProfile,readCookieHeader,SESSION_COOKIE} from '../../server/auth';
export const dynamic='force-dynamic';
export default async function Login(){
  const enabled=authEnabled();
  if(enabled){
    let staff;
    try{staff=await getProfile(readCookieHeader((await headers()).get('cookie'),SESSION_COOKIE));}
    catch{return <main><h1>Проверка входа временно недоступна</h1><p>Не удалось проверить текущую сессию. <a href="/admin">Повторить открытие админки</a>.</p></main>;}
    if(staff)redirect('/admin');
  }
  return <main><h1>Вход в админку Алисы</h1>{enabled?<><p>Войдите в центр авторизации и подтвердите вход кодом аутентификатора. Доступ предоставляется назначенным сотрудникам.</p><form method="post" action="/auth/start"><input type="hidden" name="return_to" value="/admin"/><button>Войти с MFA</button></form></>:<p>Вход ещё не открыт.</p>}</main>;
}
