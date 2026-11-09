import {reportApi} from '../../../../server/reports';
export const dynamic='force-dynamic';
export async function GET(request:Request){return reportApi(request);}
