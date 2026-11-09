import {boundary, platform} from '../../../../../server/engineering';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: {params: Promise<{id: string}>}) {
  const denied = boundary(request);
  if (denied) return denied;
  const {id} = await context.params;
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) return Response.json({code: 'INVALID_PAYLOAD'}, {status: 422});
  return platform(`/internal/foundation/probes/${id}`);
}
