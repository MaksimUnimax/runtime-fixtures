import {begin,response,reportAuthFailure} from '../../../server/auth';
export async function POST(request:Request){try{return await begin(request);}catch(error){reportAuthFailure(error);return response({code:'AUTH_UNAVAILABLE'},503);}}
