export function siteOrigin(){
  const value=process.env.ALISA_ADMIN_BASE_URL||'';
  const url=new URL(value);
  if(url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new Error('Invalid admin origin');
  if(process.env.ALISA_ENV==='stage'&&url.origin!=='https://alisa-admin-stage.octoport.ru')throw new Error('Invalid admin stage origin');
  if(process.env.ALISA_ENV==='dev'&&!(['http:','https:'].includes(url.protocol)&&['127.0.0.1','localhost'].includes(url.hostname)))throw new Error('Invalid admin dev origin');
  if(!['stage','dev'].includes(process.env.ALISA_ENV||''))throw new Error('Admin not admitted');
  return url.origin;
}
