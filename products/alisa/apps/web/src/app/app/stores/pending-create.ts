// Only an opaque operation UUID is persisted, scoped to the current membership.
export const recoveryKey=(scope:string)=>'alisa-store-create:'+scope;
export function readPendingCreate(key:string):string|null{
  const value=localStorage.getItem(key);
  if(!value)return null;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new Error('INVALID_RECOVERY');
  return value;
}
export function persistCreate(key:string,id:string){
  localStorage.setItem(key,id);
  if(readPendingCreate(key)!==id)throw new Error('RECOVERY_UNAVAILABLE');
}
export function finishCreate(key:string,id:string):boolean{
  try{
    if(readPendingCreate(key)!==id)return false;
    localStorage.removeItem(key);
    return readPendingCreate(key)===null;
  }catch{return false;}
}
