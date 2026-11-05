/** Configured origins only. Request headers never select an authority. */
export function permittedAuthOrigins(environment:string|undefined,site:URL,issuer:URL,canonicalSite:boolean){
  const clean=(u:URL)=>u.pathname==='/'&&!u.search&&!u.hash&&!u.username&&!u.password;
  if(![site,issuer].every(clean))return false;
  if(environment==='stage')return site.href===(canonicalSite?'https://alisa.octoport.ru/':'https://alisa-stage.octoport.ru/')&&issuer.href==='https://id-stage.octoport.ru/';
  if(environment==='dev')return [site,issuer].every(u=>['127.0.0.1','localhost'].includes(u.hostname)&&['http:','https:'].includes(u.protocol));
  return false;
}
