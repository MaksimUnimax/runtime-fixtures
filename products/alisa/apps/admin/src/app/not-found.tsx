import Link from "next/link";

export default function NotFound() {
  return <main className=""><article className="article">
    <h1>Страница не найдена</h1>
    <p>Проверьте адрес или вернитесь на главную страницу.</p>
    <Link href="/">На главную</Link>
  </article></main>;
}
