import {accountApi} from './auth';
import type {RecordState} from '../app/app/owner-inputs/model';
export async function getOwnerInputs(token:string,store:string):Promise<RecordState>{
  const r=await accountApi('ownerInputs',{session_token:token,command:{action:'read',store_id:store}});
  if(r.status!==200)throw new Error(typeof r.body.code==='string'?r.body.code:'OWNER_DATA_UNAVAILABLE');
  return r.body as RecordState;
}
