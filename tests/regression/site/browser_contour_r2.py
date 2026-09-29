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
 const scene=document.querySelector('.contour-scene'),copy=document.querySelector('.hero-copy'),hero=document.querySelector('.hero');
 const badges=[...document.querySelectorAll('.ai-badge,.market-badge')];
 const under=document.querySelector('.contour-underlay');
 const marks=[...document.querySelectorAll('.ai-badge img,.market-badge img')].map(i=>({src:i.getAttribute('src'),display:getComputedStyle(i).display,ok:i.complete&&i.naturalWidth>0}));
 return {
   width:innerWidth,cw:document.documentElement.clientWidth,sw:document.documentElement.scrollWidth,
   scene:rect(scene),copy:rect(copy),hero:rect(hero),stacked:rect(scene).y>=rect(copy).bottom,
   sceneBackground:getComputedStyle(scene).backgroundImage,
   under:{tag:under.tagName.toLowerCase(),cls:under.className,src:under.getAttribute('src'),rect:rect(under),transform:getComputedStyle(under).transform,ok:under.complete&&under.naturalWidth>0},
   badges:badges.map(e=>({cls:e.className,rect:rect(e),border:getComputedStyle(e).borderTopColor,bg:getComputedStyle(e).backgroundColor,transform:getComputedStyle(e).transform})),
   marks,themeControls:document.querySelectorAll('#theme-checkbox,.theme-switch').length,
   colorScheme:document.querySelector('meta[name="color-scheme"]')?.content,
   themeColor:document.querySelector('meta[name="theme-color"]')?.content,
   slogan:document.querySelector('.contour-slogan')?.innerText.replace(/\s+/g,' ').trim(),
   h1:document.querySelector('h1').innerText,
   canonical:document.querySelector('link[rel=canonical]').href,
   font:document.fonts.check('400 16px Rubik','Октопорт'),
   images:[...document.images].every(i=>i.complete&&i.naturalWidth>0)
 };
})()'''

def checks(d):
 assert d['cw']==d['sw'],('overflow',d)
 assert d['themeControls']==0,d
 assert d['colorScheme']=='dark' and d['themeColor']=='#0d1929',d
 assert d['sceneBackground']=='none',d['sceneBackground']
 assert abs(d['scene']['w']/d['scene']['h']-4/3)<.002,('reference aspect ratio',d['scene'])
 assert d['under']['tag']=='img' and 'contour-owner-static-r13' in d['under']['cls'],d['under']
 assert d['under']['src'].endswith('/assets/contour-owner-static-r13.svg') and d['under']['ok'],d['under']
 assert d['under']['transform']=='none',d['under']
 assert d['images'] and d['font'],('loading',d)
 assert len(d['badges'])==8 and len(d['marks'])==8,(d['badges'],d['marks'])
 assert all(m['display']!='none' and m['ok'] and m['src'].endswith('-r4-dark.svg') for m in d['marks']),d['marks']
 assert all(b['border']=='rgb(244, 247, 251)' and b['bg']=='rgba(0, 0, 0, 0)' for b in d['badges']),d['badges']
 assert ' '.join(d['h1'].split())=='Личный помощник на базе любимой Нейросети. Алиса, ChatGPT, DeepSeek, Gemini, Qwen и т.д.'
 assert d['canonical']=='https://octoport.ru/'
 assert d['slogan']=='Сложные технологии. Простые решения.'
 if d['width']<=1180:
  assert d['stacked'],('illustration must be below text',d)
  assert d['scene']['w']>=min(780,d['hero']['w'])-.75,('shrunken stacked illustration',d)
 else:
  assert not d['stacked'] and d['scene']['x']>d['copy']['x'],('desktop layout',d)
 for b in d['badges']:
  r=b['rect']; assert r['x']>=0 and r['right']<=d['cw']+.5,('badge clipped',r,d['width'])

def scene_shot(browser,name):
 r=browser.ev("(() => {const r=document.querySelector('.contour-scene').getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}})()")
 data=browser.send('Page.captureScreenshot',{'format':'png','captureBeyondViewport':True,'clip':r})
 p=OUT/(browser.name+'-'+name+'.png');p.write_bytes(base64.b64decode(data['data']));return str(p)

def stable_underlay(browser):
 return browser.ev("(() => {const e=document.querySelector('.contour-underlay'),r=e.getBoundingClientRect();return [r.x+scrollX,r.y+scrollY,r.width,r.height,getComputedStyle(e).transform]})()")

def stop_safely(signum,frame):
 raise SystemExit('Interrupted; closing owned browser and HTTP server')
signal.signal(signal.SIGTERM,stop_safely)

results=[];hover=[];b=None
try:
 browsers=[('chrome','/usr/bin/google-chrome')]
 if not args.quick or args.browser:browsers += [('opera','/usr/bin/opera'),('yandex','/opt/yandex/browser/yandex_browser')]
 if args.browser:browsers=[item for item in browsers if item[0]==args.browser]
 for name,binary in browsers:
  b=Browser(name,binary)
  widths=[1440,960,390,320] if args.quick else [1778,1440,1232,1180,960,768,390,320]
  for width in widths:
   b.nav('/',width,1000)
   b.ev('Promise.all([...document.images].map(i=>i.decode().catch(()=>false))).then(()=>true)')
   d=b.ev(CHECK);d.update(browser=name);checks(d)
   if name=='chrome' and width in [1440,960,390,320]:
    d['sceneShot']=scene_shot(b,f'{width}-scene')
    d['fullShot']=b.shot(f'{width}-full',full=True)
   results.append(d)
   if width in [1440,1232]:
    for j in range(8):
     b.ev('document.activeElement.blur()');b.send('Input.dispatchMouseEvent',{'type':'mouseMoved','x':2,'y':2});time.sleep(.12)
     baseline=stable_underlay(b)
     r=b.ev(f"(() => {{const e=document.querySelectorAll('.ai-badge,.market-badge')[{j}];e.scrollIntoView({{block:'center',behavior:'instant'}});const r=e.getBoundingClientRect();return {{x:r.x,y:r.y,w:r.width,h:r.height,transform:getComputedStyle(e).transform}}}})()")
     baseline=stable_underlay(b)
     b.send('Input.dispatchMouseEvent',{'type':'mouseMoved','x':r['x']+r['w']/2,'y':r['y']+r['h']/2});time.sleep(.18)
     assert baseline==stable_underlay(b),('background moved on hover',name,j,baseline,stable_underlay(b))
     after=b.ev(f"getComputedStyle(document.querySelectorAll('.ai-badge,.market-badge')[{j}]).transform")
     hovered=after!=r['transform']
     if name=='chrome': assert hovered,('hover not activated',name,j,r,after)
     focused=b.ev(f"(() => {{const e=document.querySelectorAll('.ai-badge,.market-badge')[{j}];e.focus({{preventScroll:true}});return document.activeElement===e}})()")
     assert focused,('focus failed',name,j)
     assert baseline==stable_underlay(b),('background moved on focus',name,j)
     hover.append({'browser':name,'badge':j,'background_static':True,'button_hovered':hovered,'button_focused':focused})
  for path in ['/seller-analytics','/privacy','/support','/install']:
   b.nav(path,320,900);d=b.info()
   meta=b.ev("({scheme:document.querySelector('meta[name=color-scheme]')?.content,color:document.querySelector('meta[name=theme-color]')?.content,toggles:document.querySelectorAll('#theme-checkbox,.theme-switch').length})")
   assert d['cw']==d['sw'] and d['font'] and all(i['ok'] for i in d['images']),('utility regression',name,path,d)
   assert meta=={'scheme':'dark','color':'#0d1929','toggles':0},(path,meta)
   results.append({'browser':name,'url':BASE+path,'utility':True,'cw':d['cw'],'sw':d['sw']})
  b.nav('/',320,900)
  clickpos=b.ev("(() => {const e=document.querySelector('.ai-badge');e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()")
  b.send('Input.dispatchMouseEvent',{'type':'mousePressed','button':'left','clickCount':1,**clickpos});b.send('Input.dispatchMouseEvent',{'type':'mouseReleased','button':'left','clickCount':1,**clickpos})
  assert b.ev('location.hash')=='#how',name+' badge pointer click'
  b.ev("history.replaceState(null,'',location.pathname);window.scrollTo({top:0,behavior:'instant'})")
  b.ev("document.querySelector('.site-menu summary').focus()")
  for typ in ['keyDown','keyUp']:b.send('Input.dispatchKeyEvent',{'type':typ,'key':'Enter','code':'Enter','windowsVirtualKeyCode':13,'text':'\r' if typ=='keyDown' else ''})
  assert b.ev("document.querySelector('.site-menu').open"),name+' menu keyboard'
  errors=[]
  for e in b.events:
   if e.get('method')=='Network.responseReceived':
    rr=e['params']['response']
    if rr['url'].startswith(BASE) and rr['status']>=400:errors.append({'url':rr['url'],'status':rr['status']})
   if e.get('method')=='Runtime.exceptionThrown':errors.append(e)
  assert not errors,errors
  b.close();b=None
  print('BROWSER_PASS',name,'states',len(results),flush=True)
 (OUT/'results.json').write_text(json.dumps({'status':'PASS','url':BASE,'results':results,'hover':hover},ensure_ascii=False,indent=2))
 print('CONTOUR_OWNER_DARK_R13_PASS',len(results),'states',len(hover),'hover/focus pairs',str(OUT),flush=True)
except Exception:
 (OUT/'partial.json').write_text(json.dumps({'status':'FAIL','url':BASE,'results':results,'hover':hover},ensure_ascii=False,indent=2));raise
finally:
 if b:b.close()
 if server:server.shutdown();server.server_close()
