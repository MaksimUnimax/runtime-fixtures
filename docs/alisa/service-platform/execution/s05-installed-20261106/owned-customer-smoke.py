"""Reuse own native IdP session; API/SSR checks without a provider check call."""
import http.cookiejar,json,os,pathlib,sys,time,urllib.error,urllib.parse,urllib.request,uuid
os.umask(0o077);sys.dont_write_bytecode=True
D=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s05-stores-20261106');OUT=D/'owned-customer-smoke.json'
WEB='https://alisa.octoport.ru';IDP='https://id.octoport.ru'
FIX=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s03-3e91b1aa5d405d0e/synthetic-fixture.json')
STATE=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s04-access-20261105/customer-browser-state.private.json')
rec={'scope':'INSTALLED_OWN_CUSTOMER_API_SSR_NO_BROWSER_NO_PROVIDER_CHECK','status':'FAILED','cases':[],'external_provider_calls':0};created=None
class Redirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  target=urllib.parse.urlsplit(urllib.parse.urljoin(req.full_url,newurl))
  if target.scheme!='https' or target.netloc not in {'alisa.octoport.ru','id.octoport.ru'} or target.username or target.password:raise ValueError('Foreign redirect')
  return super().redirect_request(req,fp,code,msg,headers,target.geturl())
def check(n,v):
 rec['cases'].append({'case':n,'passed':bool(v)})
 if not v:raise RuntimeError(n)
jar=http.cookiejar.CookieJar();opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(jar),Redirect())
def request(path,data=None,origin=True,form=False):
 url=WEB+path;headers={}
 if data is not None:
  headers['Content-Type']='application/x-www-form-urlencoded' if form else 'application/json'
  if origin:headers['Origin']=WEB
  data=urllib.parse.urlencode(data).encode() if form else json.dumps(data).encode()
 req=urllib.request.Request(url,data=data,headers=headers)
 try:
  with opener.open(req,timeout=12) as r:return r.status,r.read(2000000),r.geturl()
 except urllib.error.HTTPError as e:
  try:return e.code,e.read(2000000),e.geturl()
  finally:e.close()
def api(command=None):
 status,raw,_=request('/api/account/stores',command);return status,json.loads(raw)
def cmd(action,**values):return {'action':action,'command_id':str(uuid.uuid4()),**values}
def main():
 global created
 f=json.loads(FIX.read_text());check('existing_own_invalid_contact_only',f['owner_email'].endswith('@example.invalid'))
 for row in json.loads(STATE.read_text())['cookies']:
  if row['domain'].lstrip('.') not in {'alisa.octoport.ru','id.octoport.ru'} or (row['expires']>=0 and row['expires']<=time.time()):continue
  jar.set_cookie(http.cookiejar.Cookie(0,row['name'],row['value'],None,False,row['domain'],row['domain'].startswith('.'),row['domain'].startswith('.'),row['path'],True,row['secure'],None if row['expires']<0 else int(row['expires']),row['expires']<0,None,None,{'HttpOnly':row.get('httpOnly',False)},False))
 status,raw,_=request('/api/account/me')
 if status!=200:
  # No email/OTP/password submission. Only native authorization using an
  # already issued own IdP session; stop if native authentication is required.
  _,_,final=request('/auth/start',{'service':'on','privacy':'on'},form=True)
  if urllib.parse.urlsplit(final).netloc!='alisa.octoport.ru' or not urllib.parse.urlsplit(final).path.startswith('/app'):
   rec['status']='NEEDS_NATIVE_CUSTOMER_LOGIN';return
  status,raw,_=request('/api/account/me')
 check('native_session_authenticated',status==200)
 profile=json.loads(raw)['profile'];check('exact_existing_own_customer_and_tenant',profile['customer_id']==f['owner_customer'] and profile['tenant_id']==f['owner_tenant'])
 secret='owned-nonlive-fixture-'+uuid.uuid4().hex;name='Проверка S05 '+uuid.uuid4().hex[:8]
 create=cmd('create',provider='OZON',name=name,voice_alias='Проверка',credential={'client_id':'12345678','api_key':secret})
 status,data=api(create);check('create_without_payment_or_provider_call',status==201);created=data['store']['id'];store=data['store']
 check('new_key_pending_not_connected',store['credentials'][0]['status']=='PENDING' and not store['identity_verified'] and secret not in json.dumps(data))
 status,again=api(create);check('create_replay_one_same_store',status==201 and again['store']['id']==created)
 status,data=api(cmd('rename',store_id=created,expected_revision=store['revision'],name=name+' изменён',voice_alias='Новый'))
 check('rename_with_revision',status==200);store=data['store']
 status,html,_=request('/app/stores');check('actual_authenticated_page_and_secret_not_rendered',status==200 and store['name'] in html.decode() and secret.encode() not in html)
 status,_,_=request('/api/account/stores',cmd('disable',store_id=created,expected_revision=store['revision']),origin=False);check('missing_origin_denied',status==403)
 status,_,_=request('/api/account/stores?tenant_id=foreign');check('browser_tenant_forgery_denied',status==422)
 status,data=api(cmd('disable',store_id=created,expected_revision=store['revision']));check('disable_revokes_pending_key',status==200 and data['store']['status']=='DISABLED' and all(c['status']=='REVOKED' for c in data['store']['credentials']));store=data['store']
 status,_=api(cmd('delete',store_id=created,expected_revision=store['revision']));check('delete_own_synthetic_store',status==200)
 status,data=api();check('deleted_store_not_listed',status==200 and all(s['id']!=created for s in data['items']));created=None;rec['status']='PASS'
if __name__=='__main__':
 if OUT.exists():raise SystemExit('Existing outcome retained; inspect before resume')
 try:main()
 except Exception as error:rec['error_type']=type(error).__name__
 finally:
  if created:
   try:
    status,data=api();item=next(s for s in data['items'] if s['id']==created);status,_=api(cmd('delete',store_id=created,expected_revision=item['revision']));rec['own_cleanup']=status==200
   except Exception as error:rec['cleanup_error_type']=type(error).__name__
  OUT.write_text(json.dumps(rec,indent=2)+'\n');print(json.dumps(rec))
 sys.exit(0 if rec['status']=='PASS' else 1)
