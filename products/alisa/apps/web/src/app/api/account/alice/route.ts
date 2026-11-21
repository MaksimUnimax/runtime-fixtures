import {command} from '../../../../server/alice-link';
import {response} from '../../../../server/auth';
export async function POST(request:Request){try{return await command(request);}catch{return response({code:'ALICE_UNAVAILABLE'},503);}}
