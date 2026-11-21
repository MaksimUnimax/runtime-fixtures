import type {FoundationProbeInput} from '@alisa/contracts';
import {boundary, platform} from '../../../../server/engineering';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const denied = boundary(request, true);
  if (denied) return denied;
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return Response.json({code: 'INVALID_PAYLOAD'}, {status: 422});
  // A bounded streamed read avoids accepting an unbounded chunked request body.
  const reader = request.body?.getReader();
  if (!reader) return Response.json({code: 'INVALID_PAYLOAD'}, {status: 422});
  let raw = '', bytes = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 512) {await reader.cancel(); return Response.json({code: 'INVALID_PAYLOAD'}, {status: 422});}
    raw += new TextDecoder().decode(value);
  }
  try {
    const p = JSON.parse(raw);
    if (Object.keys(p).sort().join(',') !== 'kind,probe_id' || p.kind !== 'foundation-v1' || typeof p.probe_id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(p.probe_id)) throw Error();
    return platform('/internal/foundation/probes', 'POST', p as FoundationProbeInput);
  } catch { return Response.json({code: 'INVALID_PAYLOAD'}, {status: 422}); }
}
