"""Authorized existing Station account through the native authenticated IPC peer.
No key/session is read or exported. Live answers stay only in the private tmpfs.
"""
import hashlib,json,os,socket,time,uuid
from pathlib import Path

ROOT=Path('/dev/shm/alisa-answer-model-20261109/live')
def ipc(value):
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)as s:
        s.settimeout(2);s.connect('/run/alice-market/gateway.sock');s.sendall(json.dumps(value,ensure_ascii=False).encode()+b'\n');data=b''
        while not data.endswith(b'\n'):
            chunk=s.recv(4096)
            if not chunk:break
            data+=chunk
            if len(data)>16000:raise ValueError('IPC_SIZE')
    return json.loads(data)

def query(tenant,conversation,command,rid,sequence):
    return ipc(dict(tenant=tenant,conversation_id=conversation,message_id=sequence,command=command,request_id=rid,body_hash=hashlib.sha256(command.encode()).hexdigest()))

def main():
    os.umask(0o077)
    connected=[]
    for p in Path('/var/lib/alisa-station').glob('users/*/state.json'):
        state=json.loads(p.read_text())
        if state.get('connected')and state.get('binding'):connected.append(state)
    assert len(connected)==1,'UNAMBIGUOUS_EXISTING_OWNER_BINDING_REQUIRED'
    tenant=connected[0]['binding']['tenant']
    cases=[
      'Обнови сводка заказов за вчера на Озоне',
      'скажи в каких акциях участвует товар',
      'Обнови какие акции доступны сейчас на Вайлдберриз',
      'Обнови сколько рублей рекламных расходов приходится на одну заказанную единицу за вчера на Озоне',
      'Обнови ДРР за вчера на Озоне и Вайлдберриз',
      'Обнови отношение суммарного расхода рекламы к суммарному числу кликов за вчера по всем рекламным кампаниям Озона, дополнительно выведи оба исходных итога',
      'Обнови доля хранения логистики и эквайринга в финансовых продажах за вчера на Озоне']
    report={'started_at':time.time(),'before':ipc({'op':'model_usage_summary'}),'settings':ipc({'op':'answer_settings'}),'cases':[]}
    output=ROOT/'LIVE_PRIVATE.json'
    def save():output.write_text(json.dumps(report,ensure_ascii=False,indent=2))
    for index,command in enumerate(cases,1):
        conversation='answer-'+uuid.uuid4().hex;rid='answer-live-'+uuid.uuid4().hex;started=time.monotonic()
        accepted=query(tenant,conversation,command,rid,1)
        repeated=query(tenant,conversation,command,rid,1)
        case=dict(request=command,accepted=accepted,ingress_replay_equal=repeated==accepted,conversation=conversation)
        report['cases'].append(case);save()
        jid=accepted.get('job_id')
        if jid:
            while time.monotonic()-started<240:
                status=ipc(dict(op='station_status',tenant=tenant,conversation_id=conversation,job_id=jid))
                if status.get('state')not in ('QUEUED','RUNNING'):break
                time.sleep(1)
            case.update(status=status,elapsed_seconds=round(time.monotonic()-started,2))
            if status.get('state')=='READY':
                first=query(tenant,conversation,'результат',rid+'-result',2)
                page=query(tenant,conversation,'дальше',rid+'-next',3)
                replay=query(tenant,conversation,'дальше',rid+'-next',3)
                case.update(first=first,next_page=page,page_replay_equal=page==replay)
        else:case.update(elapsed_seconds=round(time.monotonic()-started,2))
        case['aggregate_after']=ipc({'op':'model_usage_summary'});save()
        print(json.dumps(dict(case=index,state=case.get('status',{}).get('state'),error=accepted.get('error'),seconds=case['elapsed_seconds'],replay=case['ingress_replay_equal'],page_replay=case.get('page_replay_equal')),ensure_ascii=False),flush=True)
    report['finished_at']=time.time();report['after']=ipc({'op':'model_usage_summary'});save()

if __name__=='__main__':main()
