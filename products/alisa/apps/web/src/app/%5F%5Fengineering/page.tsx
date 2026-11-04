import {headers} from 'next/headers';
import {notFound} from 'next/navigation';
import {authorized, probeEnabled} from '../../server/engineering';
import Probe from './probe';
export const dynamic = 'force-dynamic';
export default async function Engineering() {
  if (!probeEnabled() || !authorized(await headers())) notFound();
  return <main><h1>Техническая проба Алисы</h1><p>Закрытая диагностика каркаса. Не отчёт маркетплейса.</p><Probe /></main>;
}
