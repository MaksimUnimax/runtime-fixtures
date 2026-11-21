import {callback,reportAuthFailure,response} from '../../../server/auth';
export async function GET(request:Request){try{return await callback(request);}catch(error){reportAuthFailure(error);return response({code:'STAFF_LOGIN_UNAVAILABLE'},503);}}
