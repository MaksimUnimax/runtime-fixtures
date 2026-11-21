import {protocol} from '../../../../server/alice-link';
import {response} from '../../../../server/auth';
export async function POST(request:Request){try{return await protocol(request,true);}catch{return response({error:'temporarily_unavailable'},503);}}
