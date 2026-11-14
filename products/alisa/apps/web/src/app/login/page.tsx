import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {authEnabled,getProfile,realLoginEnabled,SESSION_COOKIE} from '../../server/auth';
export const metadata={referrer:'same-origin',title:'Вход в кабинет',alternates:{canonical:'/login'}};
export default async function Login({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
  const sessions=(await cookies()).getAll(SESSION_COOKIE);
  let profile;
  try{profile=sessions.length===1?await getProfile(sessions[0].value):null;}
  catch{return <main className="site"><article className="article"><h1>Вход временно недоступен</h1><p>Не удалось проверить текущий вход. Обновите страницу позже.</p></article></main>;}
  if(profile)redirect('/app');
  const query=await searchParams;
  return <main className="site"><article className="article"><p className="eyebrow">Алиса Маркет</p><h1>{authEnabled()?'Вход в кабинет Алисы':'Вход появится на следующем этапе'}</h1>
  {!authEnabled()?<p>Регистрация и защищённый кабинет пока недоступны.</p>:<><p>Логин — ваша электронная почта. Введите логин и пароль, затем подтвердите вход кодом из письма.</p><p>Если раньше входили без пароля, в центре входа выберите «Установить или сбросить пароль».</p>{!realLoginEnabled()&&<p>В закрытом тесте используйте только адрес example.invalid.</p>}{query.error&&<p role="alert">{query.error==='ALREADY_HANDLED_OR_EXPIRED'?'Эта попытка уже обработана или истекла. Начните новый вход. Повтор не создаёт ещё один кабинет.':'Не удалось завершить вход. Начните ещё раз.'}</p>}{query.logged_out&&<p role="status">Вы вышли из кабинета Алисы. Сессия центра входа управляется отдельно.</p>}
  <form method="post" action="/auth/start"><button className="button">Войти или создать кабинет</button></form></>}
  </article></main>;
}
