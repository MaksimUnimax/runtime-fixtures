import {authorize} from '../../../../server/alice-link';
import {response} from '../../../../server/auth';
export async function GET(request:Request){try{return await authorize(request);}catch{return response({code:'ALICE_UNAVAILABLE'},503);}}
