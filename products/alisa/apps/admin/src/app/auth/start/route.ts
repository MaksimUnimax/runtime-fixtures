import {begin,reportAuthFailure,response} from '../../../server/auth';
export async function POST(request:Request){try{return await begin(request);}catch(error){reportAuthFailure(error);return response({code:'STAFF_LOGIN_UNAVAILABLE'},503);}}
