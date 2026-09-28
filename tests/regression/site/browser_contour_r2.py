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
 const scene=document.querySelector('.contour-scene'),copy=document.querySelector('.hero-copy'),hero=document.querySelector('.hero'),page=document.querySelector('.page');
 const badges=[...document.querySelectorAll('.ai-badge,.market-badge')];
 const slogan=document.querySelector('.contour-slogan'),dark=document.querySelector('#theme-checkbox').checked;
 const r3={dark,slogan:slogan.innerText.replace(/\s+/g,' ').trim(),sloganRect:rect(slogan),sloganFont:getComputedStyle(slogan).fontSize,ozon:getComputedStyle(document.querySelector('h1 .brand-ozon')).color,wb:getComputedStyle(document.querySelector('h1 .brand-wildberries')).color,rings:[...document.querySelectorAll('.ai-badge')].map(e=>({color:getComputedStyle(e).borderTopColor,width:getComputedStyle(e).borderTopWidth,style:getComputedStyle(e).borderTopStyle}))};
 const marks=[...document.querySelectorAll('.ai-badge img')].filter(i=>getComputedStyle(i).display!=='none').map(i=>{
  const c=document.createElement('canvas');c.width=c.height=64;const ctx=c.getContext('2d');ctx.drawImage(i,0,0,64,64);const data=ctx.getImageData(0,0,64,64).data;let total=0,color=0,wrong=0;const expected=dark?[235,255,255]:[16,36,60];
  for(let k=0;k<data.length;k+=4)if(data[k+3]>64){total++;if(expected.some((v,j)=>Math.abs(data[k+j]-v)>3))wrong++;if(Math.max(data[k],data[k+1],data[k+2])-Math.min(data[k],data[k+1],data[k+2])>25)color++;}
  return {src:i.getAttribute('src'),filter:getComputedStyle(i).filter,total,colored:color,wrong};
 });
 const markets=[...document.querySelectorAll('.market-badge')].map(e=>{
  const r=rect(e),slot=rect(e.querySelector('.market-logo-slot')),label=e.querySelector('.market-label'),l=rect(label),range=document.createRange();range.selectNodeContents(label);const text=range.getBoundingClientRect();
  return {name:label.innerText,rect:r,slot,labelRect:l,textCenterError:Math.abs(text.x+text.width/2+scrollX-r.x-r.w/2),labelTop:(l.y-r.y)/r.h,slotTop:(slot.y-r.y)/r.h,font:getComputedStyle(label).fontSize,color:getComputedStyle(e).color,bg:getComputedStyle(e).backgroundColor,bgImage:getComputedStyle(e).backgroundImage};
 });
 const under=document.querySelector('.contour-underlay');
 const vector={tag:under.tagName.toLowerCase(),cls:under.getAttribute('class'),color:getComputedStyle(under).color,transform:getComputedStyle(under).transform,uses:[...under.querySelectorAll('use')].map(u=>{const b=u.getBBox();return {href:u.getAttribute('href'),color:getComputedStyle(u).color,w:b.width,h:b.height}})};
 return {r3,width:innerWidth,cw:document.documentElement.clientWidth,sw:document.documentElement.scrollWidth,scene:rect(scene),copy:rect(copy),hero:rect(hero),stacked:rect(scene).y>=rect(copy).bottom,sceneBackground:getComputedStyle(scene).backgroundColor,pageBackground:getComputedStyle(page).backgroundColor,marks,markets,vector,badgeRects:badges.map(rect),h1:document.querySelector('h1').innerText,canonical:document.querySelector('link[rel=canonical]').href,font:document.fonts.check('400 16px Rubik','Октопорт'),images:[...document.images].every(i=>i.complete&&i.naturalWidth>0)};
})()'''

def checks(d):
 assert d['cw']==d['sw'],('overflow',d)
 assert d['sceneBackground']=='rgba(0, 0, 0, 0)',('rectangle background',d['sceneBackground'])
 expected_ink='rgb(235, 255, 255)' if d['r3']['dark'] else 'rgb(5, 32, 57)'
 v=d['vector']
 assert v['tag']=='svg' and 'contour-exact-trace-r12' in v['cls'],('exact-reference vector missing',v)
 assert len(v['uses'])==1 and v['uses'][0]['href'].endswith('contour-exact-trace-r12.svg#underlay'),v
 assert v['color']==expected_ink and v['uses'][0]['color']==expected_ink,('underlay color mismatch',v,expected_ink)
 assert v['uses'][0]['w']>1000 and v['uses'][0]['h']>700,('reference vector did not render',v)
 assert abs(d['scene']['w']/d['scene']['h']-4/3)<.002,('reference aspect ratio',d['scene'])
 assert d['images'] and d['font'],('loading',d)
 assert d['h1']=='Подключите ваш ИИ к Ozon и Wildberries'
 assert d['canonical']=='https://octoport.ru/'
 r3=d['r3']; assert r3['slogan']=='Сложные технологии. Простые решения.',r3
 assert r3['sloganRect']['y']>=d['scene']['bottom']-1,('slogan overlays drawing',r3,d['scene'])
 assert r3['sloganRect']['right']<=d['cw']+.5 and r3['sloganRect']['x']>=0,r3
 assert float(r3['sloganFont'].replace('px',''))>=20,r3
 expected=('rgb(78, 147, 255)','rgb(241, 92, 221)') if r3['dark'] else ('rgb(0, 91, 255)','rgb(189, 12, 165)')
 assert (r3['ozon'],r3['wb'])==expected,('heading colors',r3)
 expected_ring='rgb(235, 255, 255)' if r3['dark'] else 'rgb(5, 32, 57)'
 assert len(r3['rings'])==6 and all(r['color']==expected_ring and float(r['width'].replace('px',''))>=1 and r['style']=='solid' for r in r3['rings']),('reference rings',r3)

 assert len(d['marks'])==6 and len(d['markets'])==2 and len(d['badgeRects'])==8
 if d['width']<=1180:
  assert d['stacked'],('illustration must be below text',d)
  assert d['scene']['w']>=min(780,d['hero']['w'])-.75,('shrunken stacked illustration',d)
 else:
  assert not d['stacked'] and d['scene']['x']>d['copy']['x'],('desktop layout',d)
 for m in d['marks']:
  assert m['filter']=='none' and m['total']>40 and m['wrong']<.05*m['total'],('reference monochrome mark mismatch',m)
 for m in d['markets']:
  r=m['rect'];assert abs(r['w']-r['h'])<.2,('not circle',m)
  assert m['textCenterError']<.8,('uncentered label',m)
  assert abs(m['slot']['x']+m['slot']['w']/2-r['x']-r['w']/2)<.3,('uncentered logo',m)
  assert m['labelRect']['w']<r['w'] and m['labelRect']['bottom']<r['bottom'],('label outside circle',m)
  assert m['bg']==d['pageBackground'] and m['bgImage']=='none',('reference disc fill mismatch',m)
 a,z=d['markets'];assert a['font']==z['font']
 assert abs(a['labelTop']-z['labelTop'])<.005 and abs(a['slotTop']-z['slotTop'])<.005,('marketplace alignment differs',a,z)
 for r in d['badgeRects']:
  assert r['x']>=0 and r['right']<=d['cw']+.5,('badge clipped',r,d['width'])

def scene_shot(browser,name):
 r=browser.ev("(() => {const r=document.querySelector('.contour-scene').getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}})()")
 data=browser.send('Page.captureScreenshot',{'format':'png','captureBeyondViewport':True,'clip':r})
 p=OUT/(browser.name+'-'+name+'.png');p.write_bytes(base64.b64decode(data['data']));return str(p)

def stable_rects(browser):
 return browser.ev("[...document.querySelectorAll('.contour-underlay')].map(e=>{const r=e.getBoundingClientRect();return [r.x+scrollX,r.y+scrollY,r.width,r.height,getComputedStyle(e).transform]})")

def stop_safely(signum,frame):
 raise SystemExit('Interrupted; closing owned browser and HTTP server')
signal.signal(signal.SIGTERM,stop_safely)
results=[];hover=[];pixels=[];b=None
try:
 browsers=[('chrome','/usr/bin/google-chrome')]
 if not args.quick or args.browser:browsers += [('opera','/usr/bin/opera'),('yandex','/opt/yandex/browser/yandex_browser')]
 if args.browser:browsers=[item for item in browsers if item[0]==args.browser]
 for name,binary in browsers:
  b=Browser(name,binary)
  widths=[1232,960,320] if args.quick else [1778,1440,1232,1181,1180,1100,1024,960,900,820,768,760,640,390,320]
  for width in widths:
   b.nav('/',width,1000)
   b.ev('Promise.all([...document.images].map(i=>i.decode().catch(()=>false))).then(()=>true)')
   for dark in [False,True]:
    b.ev("document.getElementById('theme-checkbox').checked="+str(dark).lower());b.ev("document.activeElement.blur();window.scrollTo({top:0,left:0,behavior:'instant'})");time.sleep(.06)
    d=b.ev(CHECK);d.update(browser=name,dark=dark);checks(d)
    if name=='chrome' and width in [1778,1232,1180,1024,960,768,390,320]:
     d['sceneShot']=scene_shot(b,f'{width}-'+('dark' if dark else 'light')+'-scene')
     pixels.append({'path':d['sceneShot'],'background':d['pageBackground']})
     d['fullShot']=b.shot(f'{width}-'+('dark' if dark else 'light'),full=True)
    results.append(d)
    if width==1232:
     if name=='chrome':
      b.ev("document.querySelectorAll('.ai-badge,.market-badge').forEach(e=>e.style.visibility='hidden')")
      scene_shot(b,('dark' if dark else 'light')+'-static-only')
      b.ev("document.querySelectorAll('.ai-badge,.market-badge').forEach(e=>e.style.visibility='')")
     for j in range(8):
      b.ev('document.activeElement.blur()');b.send('Input.dispatchMouseEvent',{'type':'mouseMoved','x':2,'y':2});time.sleep(.20)
      baseline=stable_rects(b)
      r=b.ev(f"(() => {{const e=document.querySelectorAll('.ai-badge,.market-badge')[{j}];e.scrollIntoView({{block:'center',behavior:'instant'}});const r=e.getBoundingClientRect();return {{x:r.x,y:r.y,w:r.width,h:r.height,transform:getComputedStyle(e).transform}}}})()")
      baseline=stable_rects(b)
      b.send('Input.dispatchMouseEvent',{'type':'mouseMoved','x':r['x']+r['w']/2,'y':r['y']+r['h']/2});time.sleep(.23)
      assert baseline==stable_rects(b),('background moved on hover',name,j,dark,baseline,stable_rects(b))
      after=b.ev(f"getComputedStyle(document.querySelectorAll('.ai-badge,.market-badge')[{j}]).transform")
      if after==r['transform']:
       diagnostic=b.ev(f"(() => {{const e=document.querySelectorAll('.ai-badge,.market-badge')[{j}],r=e.getBoundingClientRect();return {{hover:e.matches(':hover'),focus:e.matches(':focus-visible'),rect:[r.x,r.y,r.width,r.height],scrollY,hit:document.elementFromPoint({r['x']+r['w']/2},{r['y']+r['h']/2})?.outerHTML}}}})()")
       raise AssertionError(('hover not activated',name,j,r,after,diagnostic))
      b.ev(f"document.querySelectorAll('.ai-badge,.market-badge')[{j}].focus({{preventScroll:true}})")
      assert baseline==stable_rects(b),('background moved on focus',name,j,dark)
      hover.append({'browser':name,'dark':dark,'badge':j,'background_static':True,'button_hovered':True,'button_focused':True})
      if name=='chrome' and j in [6,7]:scene_shot(b,('dark' if dark else 'light')+f'-hover-{j}')
     b.ev('document.activeElement.blur()');b.send('Input.dispatchMouseEvent',{'type':'mouseMoved','x':2,'y':2});time.sleep(.22)
  for path in ['/seller-analytics','/privacy','/support','/install']:
   b.nav(path,320,900);d=b.info();assert d['cw']==d['sw'] and d['font'] and all(i['ok'] for i in d['images']),('utility regression',name,path,d)
   results.append({'browser':name,'url':BASE+path,'utility':True,'cw':d['cw'],'sw':d['sw']})
  b.nav('/',320,900)
  b.ev("document.getElementById('theme-checkbox').checked=false;document.getElementById('theme-checkbox').focus()")
  for typ in ['keyDown','keyUp']:b.send('Input.dispatchKeyEvent',{'type':typ,'key':' ','code':'Space','windowsVirtualKeyCode':32})
  assert b.ev("document.getElementById('theme-checkbox').checked"),name+' theme keyboard'
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
 (OUT/'results.json').write_text(json.dumps({'status':'PASS','url':BASE,'results':results,'hover':hover,'pixel_samples':pixels},ensure_ascii=False,indent=2))
 print('CONTOUR_EXACT_TRACE_R12_PASS',len(results),'states',len(hover),'hover/focus pairs',str(OUT),flush=True)
except Exception:
 (OUT/'partial.json').write_text(json.dumps({'status':'FAIL','url':BASE,'results':results,'hover':hover},ensure_ascii=False,indent=2));raise
finally:
 if b:b.close()
 if server:server.shutdown();server.server_close()
