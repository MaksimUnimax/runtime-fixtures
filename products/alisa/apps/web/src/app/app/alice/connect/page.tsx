import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {getProfile,SESSION_COOKIE} from '../../../../server/auth';
import {ALICE_FLOW_COOKIE,aliceEnabled,previewAlice} from '../../../../server/alice-link';
export const dynamic='force-dynamic';
export const metadata={title:'Разрешить доступ Алисе',referrer:'no-referrer',robots:{index:false,follow:false}};
export default async function AliceConsent(){
  if(!aliceEnabled())redirect('/app');
  const jar=await cookies(),profile=await getProfile(jar.get(SESSION_COOKIE)?.value||'');
  if(!profile)redirect('/login');
  if(!/^[A-Za-z0-9_-]{43}$/.test(jar.get(ALICE_FLOW_COOKIE)?.value||''))redirect('/app/alice');
  if(!await previewAlice(jar.get(SESSION_COOKIE)?.value||'',jar.get(ALICE_FLOW_COOKIE)?.value||''))redirect('/alice/oauth/cancel');
  return <main className="site"><article className="article"><h1>Подключить аккаунт к Алисе</h1>
    <p>Вы вошли как {profile.email}. Навык «Алиса Маркет» получит доступ к этому аккаунту. Управлять подключением и отозвать доступ можно в кабинете.</p>
    <p>Ключи магазинов останутся скрыты. Подключение не меняет магазины и срок доступа.</p>
    <form method="post" action="/api/account/alice"><button className="button" name="action" value="approve">Разрешить подключение</button> <button name="action" value="deny">Отмена</button></form>
  </article></main>;
}
