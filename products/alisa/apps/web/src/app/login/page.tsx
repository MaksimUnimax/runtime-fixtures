import {authEnabled,realLoginEnabled,registrationOpen} from '../../server/auth';
export const metadata={referrer:'same-origin',title:'Вход в кабинет',alternates:{canonical:'/login'}};
export default async function Login({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
  const query=await searchParams;
  return <main className="site"><article className="article"><p className="eyebrow">Алиса Маркет</p><h1>{authEnabled()?'Вход в кабинет Алисы':'Вход появится на следующем этапе'}</h1>
  {!authEnabled()?<p>Регистрация и защищённый кабинет пока недоступны.</p>:<><p>{registrationOpen()?'Введите свою почту в центре входа. Для регистрации и повторного входа нужен одноразовый код; пароль не нужен.':realLoginEnabled()?'Вход через общий центр авторизации. Для закрытого теста используйте приглашённый адрес. Код придёт на вашу почту.':'Вход через центр авторизации. В закрытом тесте используйте только адрес example.invalid.'}</p>{query.error&&<p role="alert">{query.error==='ALREADY_HANDLED_OR_EXPIRED'?'Эта попытка уже обработана или истекла. Начните новый вход. Повтор не создаёт ещё один кабинет.':'Не удалось завершить вход. Начните ещё раз.'}</p>}{query.logged_out&&<p role="status">Вы вышли из кабинета Алисы. Сессия центра входа управляется отдельно.</p>}
  <form method="post" action="/auth/start"><label><input type="checkbox" name="service" required/>Принимаю <a href="/terms">{registrationOpen()?'условия использования':'условия закрытого теста'}</a>.</label><label><input type="checkbox" name="privacy" required/>{realLoginEnabled()?'Согласен на обработку почты для входа по ':'Согласен на обработку синтетического контакта по '}<a href="/privacy">правилам</a>.</label><button className="button">Войти или создать кабинет</button></form></>}
  </article></main>;
}
