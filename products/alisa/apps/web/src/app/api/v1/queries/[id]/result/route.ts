import {queryApi} from '../../../../../../server/queries';
import {response} from '../../../../../../server/auth';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){try{return await queryApi(request,(await params).id,'result');}catch{return response({code:'DEPENDENCY_UNAVAILABLE'},503);}}
