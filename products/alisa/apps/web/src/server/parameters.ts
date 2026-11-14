import {accountApi} from './auth';
/** One allowed platform action; does not accept a caller-controlled URL. */
export async function parameterApi(sessionToken:string,command:Record<string,unknown>){
 return accountApi('parameters',{session_token:sessionToken,command});
}
