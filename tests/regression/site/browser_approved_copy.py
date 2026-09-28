"""Browser acceptance for approved copy, native groups and all five public pages."""
from pathlib import Path
import sys, json, re
P = Path(__file__).with_name('browser_contour_r2.py')
exec(P.read_text().split('CHECK =')[0])
name=args.browser or 'chrome'
binary={'chrome':'/usr/bin/google-chrome','opera':'/usr/bin/opera','yandex':'/opt/yandex/browser/yandex_browser'}[name]
expected_h1={'/':'Подключите Алису, ChatGPT, DeepSeek или другую нейросеть к своему магазину на WB и Ozon.', '/seller-analytics':'Аналитика магазина на WB и Ozon с Октопортом', '/privacy':'Как Октопорт обрабатывает данные', '/support':'Поддержка Октопорта', '/install':'Установка и API-ключи Октопорта'}
results=[]; interactions=0; b=None

def tap(selector):
    b.ev('document.querySelector('+json.dumps(selector)+').scrollIntoView({block:"center",behavior:"instant"})')
    pos=b.ev('(() => {const r=document.querySelector('+json.dumps(selector)+').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()')
    b.send('Input.dispatchMouseEvent',dict(type='mousePressed',button='left',clickCount=1,**pos))
    b.send('Input.dispatchMouseEvent',dict(type='mouseReleased',button='left',clickCount=1,**pos))

def keypress(key,code,vk):
    for kind in ('keyDown','keyUp'):
        b.send('Input.dispatchKeyEvent',{'type':kind,'key':key,'code':code,'windowsVirtualKeyCode':vk,'text':'\r' if key=='Enter' and kind=='keyDown' else ''})

def capture(selector,label):
    box=b.ev('(() => {const r=document.querySelector('+json.dumps(selector)+').getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}})()')
    raw=b.send('Page.captureScreenshot',{'format':'png','clip':box,'captureBeyondViewport':True})
    (OUT/(label+'.png')).write_bytes(base64.b64decode(raw['data']))

try:
    b=Browser(name,binary)
    for width,height in [(1440,1000),(390,844),(320,800)]:
        for route in expected_h1:
            b.nav(route,width,height)
            b.ev('Promise.all([...document.images].map(i=>i.decode().catch(()=>false)))')
            for theme in (['light','dark'] if route=='/' else ['light']):
                if route=='/': b.ev('document.querySelector("#theme-checkbox").checked='+str(theme=='dark').lower())
                d=b.info();assert d['cw']==d['sw'],('overflow',route,width,d)
                assert ' '.join(d['h1'].split())==expected_h1[route],(route,d['h1'])
                assert d['font'] and all(i['ok'] for i in d['images']),('assets',route,width)
                names=b.ev('[...document.querySelectorAll(".brand-ozon,.brand-wildberries")].map(e=>({color:getComputedStyle(e).color,type:e.classList.contains("brand-ozon")?"ozon":"wb"}))')
                palette={'light':{'ozon':'rgb(0, 91, 255)','wb':'rgb(189, 12, 165)'},'dark':{'ozon':'rgb(78, 147, 255)','wb':'rgb(241, 92, 221)'}}[theme]
                assert names and all(n['color']==palette[n['type']] for n in names),(route,names)
                assert d['canonical']=='https://octoport.ru'+route
                # Source serves canonical production URLs too.
                d.update(route=route,width=width,theme=theme)
                if route=='/':
                    d['features_height']=b.ev('document.querySelector("#features").getBoundingClientRect().height')
                    d['how_y']=b.ev('document.querySelector("#how").getBoundingClientRect().top+scrollY')
                    state=b.ev('[...document.querySelectorAll("details.capability-group")].map(e=>({id:e.id,open:e.open,count:e.querySelectorAll("article").length}))')
                    assert len(state)==6 and all(not e['open'] and e['count']==2 for e in state),state
                    if width==390: assert d['features_height']<2200,d
                    if name=='chrome':capture('#features',f'features-{width}-{theme}-closed');capture('.hero',f'hero-{width}-{theme}')
                    b.ev('document.documentElement.style.scrollBehavior="auto"')
                    for group in state:
                        sel='#'+group['id'];tap(sel+' > summary')
                        assert b.ev('document.querySelector('+json.dumps(sel)+').open'),sel
                        assert b.ev('[...document.querySelectorAll('+json.dumps(sel+' article')+')].every(e=>e.getBoundingClientRect().height>0)'),sel
                        assert b.info()['sw']==b.info()['cw'],('open overflow',sel,width)
                        tap(sel+' > summary');assert not b.ev('document.querySelector('+json.dumps(sel)+').open'),sel
                        interactions+=2
                    b.ev('document.querySelector("#capability-sales > summary").focus()');keypress('Enter','Enter',13)
                    b.ev('document.querySelector("#capability-ads > summary").focus()');keypress(' ','Space',32)
                    assert b.ev('document.querySelector("#capability-sales").open && document.querySelector("#capability-ads").open')
                    if name=='chrome':capture('#features',f'features-{width}-{theme}-open')
                    keypress(' ','Space',32);b.ev('document.querySelector("#capability-sales > summary").focus()');keypress('Enter','Enter',13)
                    assert b.ev('[...document.querySelectorAll("details.capability-group")].every(e=>!e.open)')
                    interactions+=4
                elif name=='chrome' and width in (1440,390):
                    b.ev('scrollTo({top:0,behavior:"instant"})');b.shot(route.strip('/')+f'-{width}',True)
                if route=='/support':
                    assert b.ev('document.querySelector(".contact-link").getBoundingClientRect().top')<height
                results.append(d)
    b.nav('/seller-analytics',390,844);tap('.page-actions a[href="/#how"]')
    for _ in range(60):
        state=b.ev('({hash:location.hash,y:document.querySelector("#how")?.getBoundingClientRect().top})')
        if state['hash']=='#how' and state.get('y') is not None and abs(state['y'])<8:break
        time.sleep(.1)
    assert state['hash']=='#how' and abs(state['y'])<8,state
    b.nav('/install#api-keys',390,844)
    for _ in range(60):
        anchor=b.ev('({hash:location.hash,y:document.querySelector("#api-keys").getBoundingClientRect().top})')
        if abs(anchor['y'])<8:break
        time.sleep(.1)
    assert anchor['hash']=='#api-keys' and abs(anchor['y'])<8,anchor
    (OUT/'results.json').write_text(json.dumps({'status':'PASS','states':results,'group_interactions':interactions,'analytics_to_how':state,'api_anchor':anchor},ensure_ascii=False,indent=2))
    print('APPROVED_COPY_BROWSER_PASS',name,len(results),'states',interactions,'group interactions',flush=True)
finally:
    if b:b.close()
    if server:server.shutdown();server.server_close()
