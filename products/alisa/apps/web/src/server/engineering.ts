import {timingSafeEqual} from 'node:crypto';

export const probeEnabled = () => ['dev', 'stage'].includes(process.env.ALISA_ENV || '') && process.env.FOUNDATION_PROBE_ENABLED === '1';
const equal = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
export function authorized(headers: Headers): boolean {
  const expected = process.env.ALISA_ENGINEERING_AUTH;
  return !!expected && expected.length >= 24 && equal(headers.get('authorization') || '', `Basic ${expected}`);
}
export function boundary(request: Request, write = false): Response | null {
  if (!probeEnabled()) return Response.json({code: 'NOT_FOUND'}, {status: 404});
  if (!authorized(request.headers)) return Response.json({code: 'UNAUTHORIZED'}, {status: 401, headers: {'WWW-Authenticate': 'Basic realm="Alisa engineering"'}});
  const allowed = process.env.ALISA_WEB_ORIGIN;
  // Next may normalize request.url to its internal localhost origin. Validate
  // the actual Host passed by the exact-name ingress; never trust X-Forwarded-Host.
  if (!allowed || request.headers.get('host')?.toLowerCase() !== new URL(allowed).host) return Response.json({code: 'INVALID_HOST'}, {status: 403});
  if (write && request.headers.get('origin') !== allowed) return Response.json({code: 'INVALID_ORIGIN'}, {status: 403});
  return null;
}
export async function platform(path: string, method = 'GET', payload?: unknown): Promise<Response> {
  const token = process.env.ALISA_SERVICE_TOKEN;
  const base = process.env.ALISA_PLATFORM_URL;
  if (!token || token.length < 32 || !base) return Response.json({code: 'CONFIGURATION_ERROR'}, {status: 503});
  // Deployment contract: fixed loopback upstream; never accept an upstream URL from the browser.
  const url = new URL(base);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/' || url.username || url.password || url.search || url.hash) {
    return Response.json({code: 'INVALID_UPSTREAM'}, {status: 503});
  }
  try {
    const upstream = await fetch(`${base}${path}`, {
      method, headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: payload === undefined ? undefined : JSON.stringify(payload),
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    const data = await upstream.json();
    // Allowlist response; do not relay arbitrary upstream headers or secret-bearing errors.
    const keys = ['probe_id', 'kind', 'correlation_id', 'state', 'effect_count', 'accepted_release', 'processed_release', 'environment', 'release', 'code'];
    return Response.json(Object.fromEntries(Object.entries(data).filter(([k]) => keys.includes(k))), {status: upstream.status, headers: {'Cache-Control': 'no-store'}});
  } catch {
    return Response.json({code: 'PLATFORM_UNAVAILABLE'}, {status: 503});
  }
}
