export function canonicalAuthEnabled(){
  const value=process.env.ALISA_CANONICAL_AUTH_ENABLED||'0';
  if(!['0','1'].includes(value)||value==='1'&&process.env.ALISA_ENV!=='stage')throw new Error('Invalid canonical auth mode');
  return value==='1';
}
export function permittedStaffAuthOrigins(environment:string|undefined,site:URL,issuer:URL,canonicalAuth=false){
  const clean=(u:URL)=>u.pathname==='/'&&!u.search&&!u.hash&&!u.username&&!u.password;
  if(![site,issuer].every(clean)||canonicalAuth&&environment!=='stage')return false;
  if(environment==='stage')return site.href===(canonicalAuth?'https://alisa-admin.octoport.ru/':'https://alisa-admin-stage.octoport.ru/')&&issuer.href===(canonicalAuth?'https://id.octoport.ru/':'https://id-stage.octoport.ru/');
  if(environment==='dev')return [site,issuer].every(u=>['127.0.0.1','localhost'].includes(u.hostname)&&['http:','https:'].includes(u.protocol));
  return false;
}
export function siteOrigin(){
  const url=new URL(process.env.ALISA_ADMIN_BASE_URL||'');
  if(url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new Error('Invalid admin origin');
  const canonical=canonicalAuthEnabled();
  if(process.env.ALISA_ENV==='stage'&&url.href!==(canonical?'https://alisa-admin.octoport.ru/':'https://alisa-admin-stage.octoport.ru/'))throw new Error('Invalid admin stage origin');
  if(process.env.ALISA_ENV==='dev'&&!(['http:','https:'].includes(url.protocol)&&['127.0.0.1','localhost'].includes(url.hostname)))throw new Error('Invalid admin dev origin');
  if(!['stage','dev'].includes(process.env.ALISA_ENV||''))throw new Error('Admin not admitted');
  return url.origin;
}
