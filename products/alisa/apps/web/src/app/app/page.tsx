import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {authEnabled,getProfile,SESSION_COOKIE} from '../../server/auth';
export const metadata={title:'Мой кабинет',robots:{index:false,follow:false}};
export default async function Cabinet(){
  if(!authEnabled())return <main className="site"><h1>Личный кабинет ещё не открыт</h1></main>;
  const token=(await cookies()).get(SESSION_COOKIE)?.value||'';
  let profile;
  try{profile=await getProfile(token);}catch{return <main className="site"><h1>Кабинет временно недоступен</h1><p>Обновите страницу через некоторое время.</p></main>;}
  if(!profile)redirect('/login');
  return <main className="site"><article className="article"><p className="eyebrow">Личный кабинет Алисы</p><h1>Мой кабинет</h1><section aria-label="Профиль"><h2>Профиль</h2><p>{profile.email}</p><form method="post" action="/api/account/profile"><label htmlFor="display_name">Как к вам обращаться<input id="display_name" name="display_name" maxLength={80} defaultValue={profile.display_name}/></label><button className="button">Сохранить профиль</button></form></section><section aria-label="Магазины"><h2>Магазины</h2><p>Подключённых магазинов пока нет.</p><p>Доступ к данным магазинов не предоставлен.</p></section><form method="post" action="/auth/logout"><button className="button">Выйти из кабинета</button></form></article></main>;
}
