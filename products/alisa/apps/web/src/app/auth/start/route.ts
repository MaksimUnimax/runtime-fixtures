import {begin,response} from '../../../server/auth';
export async function POST(request:Request){try{return await begin(request);}catch{return response({code:'AUTH_UNAVAILABLE'},503);}}
