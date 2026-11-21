import "@alisa/ui/style.css";
export const metadata={title:'Админка Алисы',referrer:'same-origin',robots:{index:false,follow:false}};
export default function Layout({children}: {children: React.ReactNode}) {return <html lang="ru"><body><header className="admin-header"><strong>Алиса Маркет</strong><span>Администрирование</span></header>{children}</body></html>;}
