import {reportApi} from '../../../../../server/reports';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return reportApi(request,(await params).id);}
