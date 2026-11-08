import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {getProfile,SESSION_COOKIE} from '../../../server/auth';
import {aliceEnabled,getAlice} from '../../../server/alice-link';
export const dynamic='force-dynamic';
export const metadata={title:'Подключение Алисы',robots:{index:false,follow:false}};
export default async function AlicePage({searchParams}:{searchParams:Promise<{notice?:string}>}){
  if(!aliceEnabled())redirect('/app');
  const token=(await cookies()).get(SESSION_COOKIE)?.value||'';
  const profile=await getProfile(token);if(!profile)redirect('/login');
  const status=await getAlice(token),notice=(await searchParams).notice;
  return <main className="site"><article className="article"><a href="/app">Вернуться в кабинет</a><h1>Подключение Алисы</h1>
    {notice==='SAVED'&&<p role="status">Настройка сохранена.</p>}{notice==='DISCONNECTED'&&<p role="status">Доступ навыка отозван.</p>}
    {(notice==='EXPIRED'||notice==='RETRY')&&<p role="alert">Подключение не завершено. Начните его заново из навыка Алисы.</p>}
    <p>{status.state==='CONNECTED'?'Аккаунт подключён.':status.state==='WAITING_FOR_ALICE'?'Доступ выдан. Вернитесь в Алису, чтобы завершить подключение.':'Аккаунт ещё не подключён.'}</p>
    <p>Чтобы подключить или повторно подключить этот аккаунт, откройте навык в приложении Алисы и выберите подключение аккаунта. Войдите с этой же почтой: {profile.email}.</p>
    <section><h2>Голосовая приватность</h2><p>При включённой приватности финансовые данные не произносятся вслух. Результаты можно будет смотреть в кабинете.</p>
      <form method="post" action="/api/account/alice"><input type="hidden" name="action" value="privacy"/>
        <label>Приватность<select name="voice_private" defaultValue={status.voice_private?'on':'off'}><option value="on">Включена</option><option value="off">Разрешить озвучивание</option></select></label><button className="button">Сохранить настройку</button></form>
    </section>
    {status.state!=='DISCONNECTED'&&<form method="post" action="/api/account/alice"><input type="hidden" name="action" value="unlink"/><button className="button">Отключить Алису</button></form>}
  </article></main>;
}
