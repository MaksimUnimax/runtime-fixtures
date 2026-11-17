"""Exact-context source composition only; never installs or starts services."""
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def replace(text,before,after):
    if text.count(before)!=1:raise ValueError('STATION_PARAMETER_CONTEXT_MOVED')
    return text.replace(before,after)

def native_sources(root):
    text=(root/'runtime_port_ipc.py').read_text()
    text=replace(text,"    if op=='current_versions':", "    if op=='station_parameter_authority':\n        from station_parameter_proxy import proof\n        return proof(port,peer,payload)\n    if op=='current_versions':")
    compile(text,'runtime_port_ipc.py','exec')
    return {'runtime_port_ipc.py':text,'station_parameter_proxy.py':(ROOT/'station_parameter_proxy.py').read_text()}

def station_sources(root,catalog):
    text=(root/'service.py').read_text()
    text=replace(text,'        before_save(self)\n','        from station_parameters import before_save as parameter_before_save\n        parameter_before_save(self)\n        before_save(self)\n')
    text=replace(text,'        publish(self)\n','        publish(self)\n        from station_parameters import publish as parameter_publish\n        parameter_publish(self)\n')
    text=replace(text,"            return {'settings': s['settings'],", "            from station_parameters import public_permission as parameter_permission\n            return {'parameter_permission':parameter_permission(self),'settings': s['settings'],")
    text=replace(text,"                return {'command': command, 'ticket':ticket}","                if match and ticket:\n                    from station_parameters import before as parameter_before\n                    answer=parameter_before(self,data,command,ticket)\n                    if answer is not None:return answer\n                return {'command': command, 'ticket':ticket}")
    text=replace(text,'    def tick(self):\n        with self.lock:\n', '    def tick(self):\n        from station_parameters import cleanup_pending\n        cleanup_pending(self)\n        with self.lock:\n')
    text=replace(text,"if site and action not in ('status','qr','poll','devices','select','pair','disconnect'):","if site and action not in ('status','qr','poll','devices','select','pair','disconnect','parameter_permission'):")
    anchor="            response=(self.server.delivery.site(profile['customer_id']).admin(action,data,profile['customer_id']) if site"
    replacement="            if site and action=='parameter_permission':\n                from station_parameters import set_permission\n                result=set_permission(self.server.delivery.site(profile['customer_id']),data,profile['customer_id'],session_cookie(self.headers.get('Cookie'),'__Host-alisa_session'))\n                self.send(200,json.dumps(result,ensure_ascii=False).encode());return\n"+anchor
    text=replace(text,anchor,replacement)
    authority=(root/'station_authority.py').read_text()
    authority=replace(authority,"def authorize(registry, value):\n", "def authorize(registry, value):\n    if type(value)is dict and value.get('op')=='parameter_current':\n        from station_parameters import authority as parameter_authority\n        return parameter_authority(registry,value)\n")
    result={'service.py':text,'station_authority.py':authority,'station_parameters.py':(ROOT/'station_parameters.py').read_text(),
            'parameter_voice_catalog.json':Path(catalog).read_text()}
    for name,body in result.items():
        if name.endswith('.py'):compile(body,name,'exec')
    return result

def ui_sources(root):
    html=(root/'index-site.html').read_text();js=(root/'app.js').read_text()
    html=replace(html,'</main>', '''<section id="parameter-permission"><h2>Коэффициенты голосом</h2>
<p>Отдельное разрешение для этой уже подключённой колонки. Люди с доступом к ней смогут подтвердить изменение коэффициента. Каждая запись требует отдельного голосового подтверждения.</p>
<form id="parameter-permission-form"><label><input type="checkbox" id="parameter-write-enabled">Разрешить запись коэффициентов</label>
<label><input type="checkbox" id="parameter-write-confirmed" required>Подтверждаю выбранное разрешение.</label><button>Сохранить разрешение</button></form>
<p>Скажите «Установи коэффициент потерь 12 процентов», затем «Подтверждаю». Для выбора магазина добавьте «в магазине» и его точное название. Переподключать колонку не требуется.</p></section></main>''')
    js=replace(js,' state=s;\n'," state=s;\n const permission=s.parameter_permission;\n $('parameter-permission').hidden=!permission||!s.paired;\n if(permission){$('parameter-write-enabled').checked=permission.enabled;$('parameter-write-confirmed').checked=false;}\n")
    js+='''\n$('parameter-permission-form').addEventListener('submit',async event=>{
 event.preventDefault();if(!state?.parameter_permission||!$('parameter-write-confirmed').checked)return;
 await run('parameter_permission',{enabled:$('parameter-write-enabled').checked,
 expected_revision:state.parameter_permission.revision,confirmed:true});
});\n'''
    return {'index-site.html':html,'app.js':js}
