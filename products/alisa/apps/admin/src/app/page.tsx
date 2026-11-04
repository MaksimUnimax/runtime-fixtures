export const dynamic = "force-dynamic";
export default function Home() {return <main><h1>Алиса · admin</h1><p>Технический каркас. Пользовательские функции ещё не подключены.</p><p>Среда: {process.env.ALISA_ENV || "UNCONFIGURED"}. Версия: {process.env.ALISA_RELEASE || "UNCONFIGURED"}.</p></main>;}
