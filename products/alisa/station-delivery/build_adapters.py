"""Reproducible tiny adapters over pinned installed transport; no engine/formula changes."""
from pathlib import Path
import hashlib, json, sys
ROOT = Path(__file__).parent
RELEASE = '/opt/alisa-station/releases/station-auto-r1'

def build():
    original = (ROOT/'gateway_original.py').read_text()
    begin = original.index("            basic={'tenant'")
    end = original.index('\n        except Rejected', begin)
    block = original[begin:end]
    replacement = "            if isinstance(value,dict) and value.get('op') in ('station_status','station_deliver'):\n                from station_status import status\n                result=status(self.server.engine,value)\n            else:\n"+'\n'.join('    '+l for l in block.splitlines())
    (ROOT/'local_gateway.py').write_text(original[:begin]+replacement+original[end:])
    source = (ROOT/'bridge_original.py').read_text().replace('def preview_handle(', 'def request_result(')
    source = source.replace("['text']", '')
    source = source.replace("return 'Для отчета нужна действующая авторизация.'", "return {'text':'Для отчета нужна действующая авторизация.','tts':'Для отчета нужна действующая авторизация.'}")
    start = source.index('        return (', source.index('except ('))
    source = source[:start]+'''        text = 'Исполнитель аналитики временно недоступен. Повторите запрос; повтор того же сообщения не создаст второе задание.'
        return {'text':text,'tts':text,'error':'IPC_UNAVAILABLE'}


def preview_handle(*args, **kwargs):
    return request_result(*args, **kwargs)['text']
'''
    (ROOT/'alice_bridge.py').write_text(source)
    source = (ROOT/'lab_original.py').read_text()
    source = source.replace('import alice_bridge as marketplace', 'sys.path.insert(0,"'+RELEASE+'")\nimport alice_bridge as marketplace\nimport station_client')
    old = 'marketplace.preview_handle(account,cmd,reqkey,bodyhash,conversation_id=hp(SKILL+"|"+sid),message_id=mid)'
    new = 'station_client.handle(marketplace,account,cmd,reqkey,bodyhash,hp(SKILL+"|"+sid),mid,hp((s.get("application") or {}).get("application_id") or "missing:"+sid),digest(token))'
    assert source.count(old)==1
    source = source.replace(old,new)
    source = source.replace('    if kind!="link_complete" and marketplace.handles(cmd):', '    if kind!="link_complete" and not cmd:\n        return 200,response("Привет",count),{"greeting":True}\n    if kind!="link_complete" and marketplace.handles(cmd):')
    source = source.replace('        elif cmd=="выход":', '        elif cmd=="выход":\n            if account:\n                try: station_client.call(dict(op="before",tenant=account,application=hp((s.get("application") or {}).get("application_id") or "missing:"+sid),token_hash=digest(token),command="выход"))\n                except (OSError,ValueError): pass')
    (ROOT/'alice_lab.py').write_text(source)
    manifest={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in ROOT.iterdir() if p.is_file() and p.suffix in ('.py','.js','.css','.html') and p.name!='manifest.json'}
    (ROOT/'manifest.json').write_text(json.dumps(manifest,sort_keys=True,indent=2)+'\n')
if __name__ == '__main__': build()
