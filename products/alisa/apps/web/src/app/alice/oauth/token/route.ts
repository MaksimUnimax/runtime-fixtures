import {protocol} from '../../../../server/alice-link';
import {response} from '../../../../server/auth';
export async function POST(request:Request){try{return await protocol(request);}catch{return response({error:'temporarily_unavailable'},503);}}
