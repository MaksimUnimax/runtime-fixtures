import {publicRequest} from '../../../../server/public';
export const dynamic='force-dynamic';
export async function POST(request:Request,{params}:{params:Promise<{action:string}>}) {return publicRequest(request,(await params).action);}
