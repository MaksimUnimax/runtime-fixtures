import {authEnabled} from '../../server/auth';
export const dynamic='force-dynamic';
export default function Login(){return <main><h1>Вход в админку Алисы</h1>{authEnabled()?<><p>Войдите в центр авторизации и подтвердите вход кодом аутентификатора. Доступ предоставляется назначенным сотрудникам.</p><form method="post" action="/auth/start"><input type="hidden" name="return_to" value="/admin"/><button>Войти с MFA</button></form></>:<p>Вход ещё не открыт.</p>}</main>;}
