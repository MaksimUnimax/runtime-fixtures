import {queryApi} from '../../../../server/queries';
import {response} from '../../../../server/auth';
export async function GET(request:Request){try{return await queryApi(request);}catch{return response({code:'DEPENDENCY_UNAVAILABLE'},503);}}
export async function POST(request:Request){try{return await queryApi(request);}catch{return response({code:'UNKNOWN_OUTCOME'},503);}}
