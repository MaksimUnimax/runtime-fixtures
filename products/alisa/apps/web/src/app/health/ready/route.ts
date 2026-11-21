import {probeEnabled} from '../../../server/engineering';
export const dynamic = "force-dynamic";
export async function GET() {
 const base = process.env.ALISA_PLATFORM_URL;
 try {
  if (!base || !process.env.ALISA_RELEASE || !process.env.ALISA_ENV) throw Error();
  const token = process.env.ALISA_SERVICE_TOKEN;
  if (!token || token.length < 32 || token.startsWith('REPLACE_')) throw Error();
  if (probeEnabled() && (!process.env.ALISA_ENGINEERING_AUTH || process.env.ALISA_ENGINEERING_AUTH.length < 24 || !process.env.ALISA_WEB_ORIGIN)) throw Error();
  const u = new URL(base); if (u.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(u.hostname)) throw Error();
  const r = await fetch(`${base}/health/ready`, {cache: "no-store", signal: AbortSignal.timeout(4000)});
  return Response.json({component: "web", environment: process.env.ALISA_ENV, release: process.env.ALISA_RELEASE, status: r.ok ? "READY" : "NOT_READY"}, {status: r.ok ? 200 : 503, headers: {"Cache-Control": "no-store"}});
 } catch {return Response.json({code: "DEPENDENCY_UNAVAILABLE"}, {status: 503});}
}
