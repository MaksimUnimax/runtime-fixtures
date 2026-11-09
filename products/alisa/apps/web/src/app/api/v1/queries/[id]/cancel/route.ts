import {queryApi} from '../../../../../../server/queries';
import {response} from '../../../../../../server/auth';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{return await queryApi(request,(await params).id,'cancel');}catch{return response({code:'UNKNOWN_OUTCOME'},503);}}
