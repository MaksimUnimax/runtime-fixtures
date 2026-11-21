/** Customer session persistence. No change to login-factor or staff policies. */
export const SESSION_COOKIE='__Host-alisa_session';
export const SESSION_MAX_AGE_SECONDS=30*24*60*60;
export function cookie(name:string,value:string,age:number){return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;}
