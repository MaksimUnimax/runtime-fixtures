import {callback,response} from '../../../server/auth';
export async function GET(request:Request){try{return await callback(request);}catch{return response({code:'AUTH_UNAVAILABLE'},503);}}
