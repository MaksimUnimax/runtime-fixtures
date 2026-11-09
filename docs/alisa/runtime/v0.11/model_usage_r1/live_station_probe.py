"""One authorized Quasar skill launch; no Delivery object or state-file writes."""
import http.cookiejar,json,os,sys,time,uuid
from pathlib import Path
from cryptography.fernet import Fernet
sys.path.insert(0,'/opt/alisa-station/releases/station-auto-r8-model-usage-r5')
from transport import Yandex,payload,Fault
ROOT=Path('/dev/shm/alisa-model-usage-20261109/live')

def main():
    os.umask(0o077)
    candidates=[]
    for path in Path('/var/lib/alisa-station').glob('users/*/state.json'):
        state=json.loads(path.read_text())
        if state.get('connected')and state.get('binding'):candidates.append((path,state))
    assert len(candidates)==1,'UNAMBIGUOUS_CONNECTED_STATION_REQUIRED'
    path,state=candidates[0]
    assert state.get('selected')and not state.get('uncertain'),'STATION_NOT_READY'
    assert (state.get('job')or{}).get('delivery')not in ('sending','pending'),'ACTIVE_DELIVERY'
    cipher=Fernet(Path('/run/credentials/alisa-station.service/station-key').read_bytes())
    client=Yandex()
    for cookie in json.loads(cipher.decrypt((path.parent/'session.enc').read_bytes())):
        client.jar.set_cookie(http.cookiejar.Cookie(**cookie))
    report={'started_at':time.time(),'stage':'ready','acoustic_confirmation':False}
    out=ROOT/'STATION_PROBE_PRIVATE.json'
    def save():out.write_text(json.dumps(report,ensure_ascii=False,indent=2))
    previous=(state.get('job')or{}).get('jid');sid=None
    try:
        report['stage']='creating_scenario';save()
        body=payload('Октопорт проверка учёта 20261109','октопорт проверка '+uuid.uuid4().hex,state['selected']['id'],
            'спроси навык Октопорт маркет обнови сводка заказов за вчера на Озоне',mode='skill')
        answer=client.api('POST','/m/v4/user/scenarios',body)
        sid=answer.get('scenario_id');assert isinstance(sid,str)and sid,'SCENARIO_ID_MISSING'
        report.update(scenario_id=sid,stage='launching');save()
        client.api('POST','/m/user/scenarios/'+sid+'/actions')
        report.update(launch_acknowledged=True,stage='observing');save()
        deadline=time.monotonic()+150
        while time.monotonic()<deadline:
            current=json.loads(path.read_text());job=current.get('job')or{}
            if job.get('jid')and job['jid']!=previous:
                report.update(new_job_id=job['jid'],new_turn_observed=True,delivery=job.get('delivery'),last_delivery=current.get('last_delivery'))
                save()
                if job.get('delivery')in ('responded_to_skill','failed','manual','unknown'):break
            time.sleep(1)
        report['stage']='observed'
    except Fault as error:
        report.update(stage='blocked',error=error.code)
    except Exception as error:
        report.update(stage='failed',error=type(error).__name__)
    finally:
        if sid:
            try:client.api('DELETE','/m/user/scenarios/'+sid);report['own_scenario_deleted']=True
            except Fault as error:report['cleanup_error']=error.code
        report['finished_at']=time.time();save()
        print(json.dumps({key:value for key,value in report.items()if key not in ('scenario_id','new_job_id')},ensure_ascii=False),flush=True)

if __name__=='__main__':main()
