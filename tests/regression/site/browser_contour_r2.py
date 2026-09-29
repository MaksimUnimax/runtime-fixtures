# Browser regression for owner R4 references, retaining R2 stacking and R3 slogan/heading; requires installed branded browsers and websocket-client.
import argparse,base64,functools,http.server,json,os,signal,socket,subprocess,tempfile,threading,time,urllib.request,websocket
from pathlib import Path

parser=argparse.ArgumentParser();parser.add_argument('--url');parser.add_argument('--out',default='/tmp/octoport-contour-r2-evidence');parser.add_argument('--quick',action='store_true');parser.add_argument('--browser',choices=['chrome','opera','yandex']);parser.add_argument('--root',default=str(Path(__file__).resolve().parents[3]/'apps/site/public'));args=parser.parse_args()
OUT=Path(args.out);OUT.mkdir(parents=True,exist_ok=True)
server=None
if args.url: BASE=args.url.rstrip('/')
else:
 class Handler(http.server.SimpleHTTPRequestHandler):
  def log_message(self,*a): pass
  def translate_path(self,path):
   result=super().translate_path(path)
   if path.split('?')[0] in ['/seller-analytics','/privacy','/support','/install']: result+='.html'
   return result
 handler=functools.partial(Handler,directory=args.root)
 server=http.server.ThreadingHTTPServer(('127.0.0.1',0),handler);threading.Thread(target=server.serve_forever,daemon=True).start();BASE=f'http://127.0.0.1:{server.server_address[1]}'

class Browser:
 def __init__(self,name,binary):
  self.name=name;self.seq=0;self.events=[];self.ws=None
  sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
  profile=tempfile.mkdtemp(prefix=name+'-',dir=OUT)
  self.log=open(OUT/(name+'.log'),'w')
  mode=[] if name in ['opera','yandex'] and os.environ.get('DISPLAY') else ['--headless']
  self.proc=subprocess.Popen([binary,*mode,'--disable-renderer-backgrounding','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--disable-extensions','--no-first-run','--no-default-browser-check','--remote-allow-origins=*',f'--remote-debugging-port={port}',f'--user-data-dir={profile}',BASE+'/'],stdout=self.log,stderr=self.log,start_new_session=True)
  for _ in range(180):
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/json',timeout=.5) as r: tabs=json.load(r)
    pages=[t for t in tabs if t.get('type')=='page' and not t.get('url','').startswith('chrome-extension:')]
    if pages:
     tab=next((t for t in pages if t.get('url','').startswith(BASE)),pages[0]);self.ws=websocket.create_connection(tab['webSocketDebuggerUrl'],timeout=30,origin='http://localhost');break
   except Exception: pass
   time.sleep(.1)
  if self.ws is None: self.close();raise RuntimeError(name+' CDP unavailable; see '+str(OUT))
  for m in ['Page.enable','Runtime.enable','Network.enable','Log.enable']: self.send(m)
  self.send('Page.bringToFront')
 def send(self,m,p=None):
  self.seq+=1;self.ws.send(json.dumps({'id':self.seq,'method':m,'params':p or {}}))
  while True:
   r=json.loads(self.ws.recv())
   if r.get('id')==self.seq:
    if 'error' in r: raise RuntimeError(r['error'])
    return r.get('result',{})
   self.events.append(r)
 def ev(self,s):
  r=self.send('Runtime.evaluate',{'expression':s,'returnByValue':True,'awaitPromise':True})
  if r.get('exceptionDetails'): raise RuntimeError(r['exceptionDetails'])
  return r.get('result',{}).get('value')
 def nav(self,path,width,height=1000):
  self.send('Emulation.setDeviceMetricsOverride',{'width':width,'height':height,'deviceScaleFactor':1,'mobile':False})
  target=BASE+path;self.send('Page.navigate',{'url':target})
  for _ in range(150):
   if self.ev('({url:location.href,ready:document.readyState})')=={'url':target,'ready':'complete'}:break
   time.sleep(.1)
  else:raise RuntimeError(self.name+' navigation failed '+target)
  self.ev('document.fonts.ready.then(()=>true)');time.sleep(.15)
 def shot(self,name,full=False):
  p={'format':'png','captureBeyondViewport':full}
  if full:
   size=self.send('Page.getLayoutMetrics')['cssContentSize'];p['clip']={'x':0,'y':0,'width':size['width'],'height':size['height'],'scale':1}
  b=self.send('Page.captureScreenshot',p);f=OUT/(self.name+'-'+name+'.png');f.write_bytes(base64.b64decode(b['data']));return str(f)
 def info(self):
  return self.ev('''(() => ({url:location.href,title:document.title,h1:document.querySelector('h1')?.innerText,canonical:document.querySelector('link[rel=canonical]')?.href,cw:document.documentElement.clientWidth,sw:document.documentElement.scrollWidth,font:document.fonts.check('400 16px Rubik','Октопорт'),images:[...document.images].map(i=>({src:i.getAttribute('src'),ok:i.complete&&i.naturalWidth>0,w:i.naturalWidth,h:i.naturalHeight})),badges:document.querySelectorAll('.ai-badge,.market-badge').length,offenders:[...document.body.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return s.display!=='none'&&s.position!=='absolute'&&r.width>0&&(r.right>document.documentElement.clientWidth+1||r.left< -1)}).map(e=>e.tagName+'.'+e.className).slice(0,12)}))()''')
 def rects(self):
  return self.ev('''[...document.querySelectorAll('.contour-underlay')].map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height,getComputedStyle(e).transform]})''')
 def close(self):
  if self.ws:
   try:self.ws.close()
   except Exception:pass
  try:os.killpg(self.proc.pid,signal.SIGTERM);self.proc.wait(timeout=5)
  except ProcessLookupError:pass
  except subprocess.TimeoutExpired:os.killpg(self.proc.pid,signal.SIGKILL);self.proc.wait(timeout=5)
  self.log.close()

CHECK = r'''(() => {
 const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,w:r.width,h:r.height,right:r.right+scrollX,bottom:r.bottom+scrollY}};
 const hero=document.querySelector('.hero'),copy=document.querySelector('.hero-copy'),mascot=document.querySelector('.hero-mascot img');
 const colors={}; for (const c of ['brand-ozon','brand-wildberries','brand-alice','brand-chatgpt','brand-deepseek','brand-gemini','brand-qwen']) { const e=document.querySelector('.'+c); colors[c]=e?getComputedStyle(e).color:null; }
 return {
  width:innerWidth,cw:document.documentElement.clientWidth,sw:document.documentElement.scrollWidth,
  hero:rect(hero),copy:rect(copy),mascot:rect(mascot),
  h1:document.querySelector('h1').innerText.replace(/\s+/g,' ').trim(),
  divider:!!document.querySelector('.hero-divider'),kicker:!!document.querySelector('.hero-kicker'),heroSpace:!!document.querySelector('.hero-space'),
  buttons:document.querySelectorAll('.hero-actions .button').length,
  oldContour:document.querySelectorAll('.contour-wrap,.contour-scene,.ai-badge,.market-badge').length,
  headerNav:getComputedStyle(document.querySelector('.header-nav')).display,
  colors,themeControls:document.querySelectorAll('#theme-checkbox,.theme-switch').length,
  colorScheme:document.querySelector('meta[name="color-scheme"]')?.content,
  themeColor:document.querySelector('meta[name="theme-color"]')?.content,
  canonical:document.querySelector('link[rel=canonical]').href,
  font:document.fonts.check('400 16px Rubik','Октопорт'),images:[...document.images].every(i=>i.complete&&i.naturalWidth>0)
 };
})()'''

def checks(d):
 assert d['cw']==d['sw'],('overflow',d)
 assert d['themeControls']==0 and d['colorScheme']=='dark' and d['themeColor']=='#0d1929',d
 assert d['h1']=='Личный помощник на базе любимой Нейросети.',d['h1']
 assert not d['kicker'] and not d['heroSpace'],d
 assert d['divider'] and d['mascot']['w']>0 and d['mascot']['h']>0,d
 assert d['buttons']==2 and d['oldContour']==0,d
 assert d['headerNav']=='none',d['headerNav']
 assert d['canonical']=='https://octoport.ru/' and d['font'] and d['images'],d
 assert d['hero']['w']<=d['cw']+.5 and d['hero']['x']>=0,d['hero']
 assert len({v for v in d['colors'].values() if v})>=5,d['colors']

def hero_shot(browser,name):
 r=browser.ev("(() => {const r=document.querySelector('.hero').getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}})()")
 data=browser.send('Page.captureScreenshot',{'format':'png','captureBeyondViewport':True,'clip':r})
 p=OUT/(browser.name+'-'+name+'.png');p.write_bytes(base64.b64decode(data['data']));return str(p)

def stable_space(browser):
 return browser.ev("(() => {const e=document.querySelector('.hero-mascot img'),r=e.getBoundingClientRect();return [r.width,r.height,getComputedStyle(e).transform]})()")

def stop_safely(signum,frame): raise SystemExit('Interrupted; closing owned browser and HTTP server')
signal.signal(signal.SIGTERM,stop_safely)
results=[];hover=[];b=None
try:
 browsers=[('chrome','/usr/bin/google-chrome')]
 if not args.quick or args.browser:browsers += [('opera','/usr/bin/opera'),('yandex','/opt/yandex/browser/yandex_browser')]
 if args.browser:browsers=[item for item in browsers if item[0]==args.browser]
 for name,binary in browsers:
  b=Browser(name,binary)
  widths=[1440,960,390,320] if args.quick else [1778,1440,1180,960,768,390,320]
  for width in widths:
   b.nav('/',width,1000);d=b.ev(CHECK);d.update(browser=name);checks(d)
   if name=='chrome' and width in [1440,960,390,320]: d['heroShot']=hero_shot(b,f'{width}-hero');d['fullShot']=b.shot(f'{width}-full',full=True)
   results.append(d)
   if width==1440:
    for sel in ['.hero-actions .primary','.hero-actions .secondary']:
     baseline=stable_space(b);r=b.ev(f"(() => {{const e=document.querySelector('{sel}');const r=e.getBoundingClientRect();return {{x:r.x,y:r.y,w:r.width,h:r.height,transform:getComputedStyle(e).transform}}}})()")
     b.send('Input.dispatchMouseEvent',{'type':'mouseMoved','x':r['x']+r['w']/2,'y':r['y']+r['h']/2});time.sleep(.18)
     assert baseline==stable_space(b),('hero background moved',name,sel)
     after=b.ev(f"getComputedStyle(document.querySelector('{sel}')).transform");focused=b.ev(f"(() => {{const e=document.querySelector('{sel}');e.focus({{preventScroll:true}});return document.activeElement===e}})()")
     assert focused and baseline==stable_space(b);hover.append({'browser':name,'control':sel,'background_static':True,'hovered':after!=r['transform'],'focused':focused})
  for path in ['/seller-analytics','/privacy','/support','/install']:
   b.nav(path,320,900);d=b.info();meta=b.ev("({scheme:document.querySelector('meta[name=color-scheme]')?.content,color:document.querySelector('meta[name=theme-color]')?.content,toggles:document.querySelectorAll('#theme-checkbox,.theme-switch').length})")
   assert d['cw']==d['sw'] and d['font'] and all(i['ok'] for i in d['images']);assert meta=={'scheme':'dark','color':'#0d1929','toggles':0};results.append({'browser':name,'url':BASE+path,'utility':True,'cw':d['cw'],'sw':d['sw']})
  b.nav('/',320,900);pos=b.ev("(() => {const e=document.querySelector('.hero-actions .primary');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()")
  b.send('Input.dispatchMouseEvent',{'type':'mousePressed','button':'left','clickCount':1,**pos});b.send('Input.dispatchMouseEvent',{'type':'mouseReleased','button':'left','clickCount':1,**pos});assert b.ev('location.hash')=='#beta'
  b.ev("history.replaceState(null,'',location.pathname);window.scrollTo({top:0,behavior:'instant'});document.querySelector('.site-menu summary').focus()")
  for typ in ['keyDown','keyUp']: b.send('Input.dispatchKeyEvent',{'type':typ,'key':'Enter','code':'Enter','windowsVirtualKeyCode':13,'text':'\r' if typ=='keyDown' else ''})
  assert b.ev("document.querySelector('.site-menu').open")
  errors=[]
  for e in b.events:
   if e.get('method')=='Network.responseReceived':
    rr=e['params']['response']
    if rr['url'].startswith(BASE) and rr['status']>=400:errors.append({'url':rr['url'],'status':rr['status']})
   if e.get('method')=='Runtime.exceptionThrown':errors.append(e)
  assert not errors,errors
  b.close();b=None;print('BROWSER_PASS',name,'states',len(results),flush=True)
 (OUT/'results.json').write_text(json.dumps({'status':'PASS','url':BASE,'results':results,'hover':hover},ensure_ascii=False,indent=2))
 print('HERO_SPACE_R16_PASS',len(results),'states',len(hover),'control pairs',str(OUT),flush=True)
except Exception:
 (OUT/'partial.json').write_text(json.dumps({'status':'FAIL','url':BASE,'results':results,'hover':hover},ensure_ascii=False,indent=2));raise
finally:
 if b:b.close()
 if server:server.shutdown();server.server_close()
