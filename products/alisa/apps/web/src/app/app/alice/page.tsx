import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {getProfile,SESSION_COOKIE} from '../../../server/auth';
import {aliceEnabled,getAlice} from '../../../server/alice-link';
export const dynamic='force-dynamic';
export const metadata={title:'Подключение Алисы',referrer:'same-origin',robots:{index:false,follow:false}};
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
        <label htmlFor="voice_private">Приватность</label><select id="voice_private" name="voice_private" defaultValue={status.voice_private?'on':'off'}><option value="on">Включена</option><option value="off">Разрешить озвучивание</option></select><button className="button">Сохранить настройку</button></form>
    </section>
    {status.state==='CONNECTED'&&status.parameter_writes&&<section><h2>Изменение коэффициентов голосом</h2>
      <p>Разрешение действует отдельно от чтения отчётов. Любой, кто пользуется этой привязанной Алисой, сможет предложить изменение коэффициента и подтвердить его голосом. Запись выполняется только после отдельного подтверждения каждой команды. Переподключать аккаунт не нужно.</p>
      <form method="post" action="/api/account/alice"><input type="hidden" name="action" value="parameter_permission"/>
        <input type="hidden" name="expected_revision" value={status.parameter_writes.revision}/>
        <label htmlFor="parameter_writes">Голосовая запись</label><select id="parameter_writes" name="enabled" defaultValue={status.parameter_writes.enabled?'on':'off'}><option value="off">Выключена</option><option value="on">Разрешить</option></select>
        <label><input type="checkbox" name="confirmed" value="yes" required/>Подтверждаю выбранное разрешение для привязанной Алисы.</label>
        <button className="button">Сохранить разрешение</button>
      </form><p>Пример: «Установи коэффициент потерь 12 процентов», затем «Подтверждаю». Для нескольких магазинов добавьте «в магазине» и точное название. В этом выпуске голосом меняется общее значение магазина; исключения товаров доступны в разделе коэффициентов.</p>
    </section>}
    {status.state!=='DISCONNECTED'&&<form method="post" action="/api/account/alice"><input type="hidden" name="action" value="unlink"/><button className="button">Отключить Алису</button></form>}
  </article></main>;
}
