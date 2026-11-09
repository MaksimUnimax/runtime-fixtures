import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {authEnabled,getProfile,SESSION_COOKIE} from '../../server/auth';
import {ALICE_FLOW_COOKIE,aliceEnabled} from '../../server/alice-link';
import {queriesEnabled} from '../../server/queries';
export const metadata={referrer:'same-origin',title:'Мой кабинет',robots:{index:false,follow:false}};
export default async function Cabinet(){
  if(!authEnabled())return <main className="site"><h1>Личный кабинет ещё не открыт</h1></main>;
  const token=(await cookies()).get(SESSION_COOKIE)?.value||'';
  let profile;
  try{profile=await getProfile(token);}catch{return <main className="site"><h1>Кабинет временно недоступен</h1><p>Обновите страницу через некоторое время.</p></main>;}
  if(!profile)redirect('/login');
  if(aliceEnabled()&&/^[A-Za-z0-9_-]{43}$/.test((await cookies()).get(ALICE_FLOW_COOKIE)?.value||''))redirect('/app/alice/connect');
  return <main className="site"><article className="article"><p className="eyebrow">Личный кабинет Алисы</p><h1>Мой кабинет</h1><section aria-label="Доступ"><h2>Доступ к Алисе</h2><a className="button" href="/app/access">Посмотреть срок и историю доступа</a></section><section aria-label="Профиль"><h2>Профиль</h2><p>{profile.email}</p><form method="post" action="/api/account/profile"><label htmlFor="display_name">Как к вам обращаться<input id="display_name" name="display_name" maxLength={80} defaultValue={profile.display_name}/></label><button className="button">Сохранить профиль</button></form></section>{queriesEnabled()&&<section aria-label="Задания"><h2>Задания</h2><a className="button" href="/app/queries">Открыть задания и отчёты</a></section>}<section aria-label="Магазины"><h2>Магазины</h2><a className="button" href="/app/stores">Открыть мои магазины</a></section>{aliceEnabled()&&<section aria-label="Алиса"><h2>Навык Алисы</h2><a className="button" href="/app/alice">Подключение и голосовая приватность</a></section>}<form method="post" action="/auth/logout"><button className="button">Выйти из кабинета</button></form></article></main>;
}
