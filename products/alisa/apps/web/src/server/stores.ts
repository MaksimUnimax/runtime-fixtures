import {accountApi} from './auth';

export type StoreCredential={id:string;kind:'SELLER'|'PERFORMANCE'|'WB';revision:number;status:'ACTIVE'|'PENDING';check_code:string;checked_at:string|null};
export type Store={id:string;provider:'OZON'|'WB';name:string;voice_alias:string;revision:number;status:'ACTIVE'|'DISABLED'|'DELETED';identity_verified:boolean;credentials:StoreCredential[]};
export type StoreList={items:Store[];next_cursor:string|null};
export async function getStores(token:string):Promise<StoreList|null>{
  const result=await accountApi('stores',{session_token:token,command:{action:'list'}});
  if(result.status===401||result.status===404)return null;
  if(result.status!==200||!Array.isArray(result.body.items))throw new Error('STORES_UNAVAILABLE');
  return result.body as StoreList;
}
