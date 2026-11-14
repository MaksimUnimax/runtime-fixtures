import {catalogApi} from '../../../../server/question-catalog';
import {response} from '../../../../server/auth';
export async function GET(request:Request){try{return await catalogApi(request);}catch{return response({code:'DEPENDENCY_UNAVAILABLE'},503);}}
