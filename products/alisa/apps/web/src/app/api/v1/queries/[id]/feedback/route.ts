import {queryApi} from '../../../../../../server/queries';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return queryApi(request,(await params).id,'feedback');}
