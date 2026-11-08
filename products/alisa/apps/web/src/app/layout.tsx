import './site.css';
import Link from 'next/link';
import brandMark from './octoport-brand.png';
import {siteOrigin} from '../server/public';
import {realLoginEnabled,registrationOpen} from '../server/auth';
import {Tracking} from './tracking';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: {
    default: 'Алиса Маркет — голосовая аналитика Ozon и Wildberries',
    template: '%s · Алиса Маркет',
  },
  description: 'Спросите о магазине голосом. Отдельный сервис аналитики Ozon и Wildberries через Яндекс Станцию. Предварительная версия.',
  metadataBase: new URL(siteOrigin()),
  alternates: {canonical: '/'},
  robots: {index: false, follow: false},
  referrer: 'no-referrer',
};

export default function Layout({children}: {children: React.ReactNode}) {
  return <html lang="ru"><body>
    <header>
      <Link className="brand" href="/">
        <img src={brandMark.src} width={36} height={36} alt=""/>
        <span>Алиса Маркет</span>
      </Link>
      <div className="header-actions">
        <Link className="login-link" href="/login">Войти</Link>
        <details className="site-menu">
          <summary>Меню</summary>
          <nav aria-label="Основная навигация">
            <Link href="/examples">Примеры</Link>
            <Link href="/how-it-works">Как это работает</Link>
            <Link href="/help">Помощь</Link>
            <Link href="/join">Тестовая заявка</Link>
          </nav>
        </details>
      </div>
    </header>
    {children}
    <Tracking/>
    <footer>
      <div className="footer-links">
        <Link href="/faq">Вопросы</Link>
        <Link href="/pricing">Тариф</Link>
        <Link href="/contacts">Контакты</Link>
        <Link href="/privacy">Данные</Link>
        <Link href="/terms">Условия</Link>
        <Link href="/consents">Согласия</Link>
        <Link href="/login">Вход</Link>
      </div>
      <p>Алиса Маркет · {registrationOpen()?'Предварительная версия.':'Закрытая тестовая среда.'} {registrationOpen()?'Регистрация по электронной почте. Статус подключения магазина смотрите в кабинете. Платежи пока недоступны.':realLoginEnabled()?'Вход по приглашению. Статус подключения магазина смотрите в кабинете. Платежи пока недоступны.':'Реальные контакты и платежи не принимаются.'}</p>
    </footer>
  </body></html>;
}
