export const dynamic = "force-dynamic";
export function GET() {return Response.json({component: "admin", environment: process.env.ALISA_ENV, release: process.env.ALISA_RELEASE, status: "LIVE"}, {headers: {"Cache-Control": "no-store"}});}
