import {accountApi} from './auth';

export type AccessGrant = {
  id:string; source:'GIFT'|'COMPENSATION'|'PAYMENT'; reason:string; comment:string; days:number;
  starts_at:string; ends_at:string; effective_ends_at:string; adjusted:boolean;
  status:'ACTIVE'|'SCHEDULED'|'EXPIRED'|'REVOKED'; revocable:boolean;
};
export type AccessState = {
  product_id:'alisa_market'; status:'ACTIVE'|'SCHEDULED'|'EXPIRED'|'REVOKED'|'NOT_PROVISIONED';
  active_until:string|null; revision:number; history:AccessGrant[];
  notifications:{id:string;kind:'GRANTED'|'REVOKED';grant_id:string;created_at:string}[];
};

export async function getAccess(token:string):Promise<AccessState|null>{
  const result=await accountApi('access',{session_token:token});
  if(result.status===401||result.status===404)return null;
  if(result.status!==200||!result.body.access)throw new Error('ACCESS_UNAVAILABLE');
  return result.body.access as AccessState;
}
