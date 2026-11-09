import {intakeEnabled} from '../../server/public';
import {JoinForm} from './ui';
export const dynamic='force-dynamic';
export const metadata={title:'Тестовая заявка',alternates:{canonical:'/join'}};
export default function Join(){return <main className="site"><article className="article"><p className="eyebrow">Первый тестовый путь</p><h1>Проверим заявку и подтверждение почты</h1><p>Только синтетический адрес example.invalid. Письмо поступит в тестовый mail sink. Заявка не создаёт аккаунт и не выдаёт доступ.</p>{intakeEnabled()?<JoinForm/>:<p className="status">Приём заявок в этой среде ещё не включён. Сбор реальных контактов закрыт.</p>}</article></main>;}
