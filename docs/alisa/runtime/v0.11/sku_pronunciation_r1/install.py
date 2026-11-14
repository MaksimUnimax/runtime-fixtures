"""Apply a reviewed speech setting through the existing authenticated local API."""
import fcntl,hashlib,json,os,sqlite3,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
SETTINGS=Path('/var/lib/alice-market/answer-settings.json')
CONFIG=Path('/etc/alice-market/market-runtime.json')
POINTER=Path('/opt/alice-market/releases/current')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def rpc(config,payload):
    # Use the configured, authorized maintenance IPC peer; never change access.
    client="import json,socket,sys;d=json.load(sys.stdin);s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);s.settimeout(5);s.connect(d['socket']);s.sendall((json.dumps(d['value'],ensure_ascii=False)+chr(10)).encode());r=s.makefile('rb').readline(16001);sys.stdout.buffer.write(r)"
    raw=subprocess.check_output(['runuser','-u',config['web_user'],'--','/usr/bin/python3','-c',client],input=json.dumps({'socket':config['socket'],'value':payload},ensure_ascii=False).encode(),timeout=8)
    value=json.loads(raw)
    if value.get('error'):raise RuntimeError(value['error'])
    return value
with open('/run/lock/alisa-runtime-recovery.lock','a')as lock:
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    assert len(sys.argv[1])==40 and all(c in '0123456789abcdef'for c in sys.argv[1])
    assert sha(ROOT/'change.json')=='cf2ec02010beeed42cf3921774278b8dbc5dc64b70571fb374146cfe372dac56'
    change=json.loads((ROOT/'change.json').read_text())
    assert sha(SETTINGS)==change['expected_file_sha256'],'SETTINGS_CHANGED'
    config=json.loads(CONFIG.read_text());config_sha=sha(CONFIG);release=POINTER.resolve();manifest_sha=sha(release/'manifest.json')
    with sqlite3.connect('file:'+config['database']+'?mode=ro',uri=True)as c:
        assert c.execute("SELECT count(*)FROM jobs WHERE state IN ('QUEUED','RUNNING')").fetchone()[0]==0,'ACTIVE_JOB'
        import time
        for raw, in c.execute("SELECT result FROM jobs WHERE state='READY'AND expires>?AND result IS NOT NULL",(time.time(),)):
            d=json.loads(raw);assert not(isinstance(d,dict)and isinstance(d.get('clarification'),dict)),'ACTIVE_CLARIFICATION'
    before=rpc(config,{'op':'answer_settings'})
    assert before['revision']==change['expected_revision'],'REVISION_CHANGED'
    assert before==json.loads(SETTINGS.read_text()),'IPC_FILE_MISMATCH'
    values={k:before[k]for k in ('request_planning_prompt','answer_prompt','answer_extra_instruction')}
    assert change['append_to_answer_prompt']not in values['answer_prompt'],'ALREADY_APPLIED'
    values['answer_prompt']+=' '+change['append_to_answer_prompt']
    desired={'revision':before['revision']+1,**values}
    before_path=ROOT/'answer-settings.before.json'
    assert not before_path.exists(),'ALREADY_ATTEMPTED'
    before_path.write_bytes(SETTINGS.read_bytes());before_path.chmod(0o600)
    try:
        answer=rpc(config,{'op':'answer_settings_save','revision':before['revision'],**values})
    except (OSError,subprocess.SubprocessError,ValueError):
        # Save may have committed before a lost response. Read only; do not resend.
        answer=rpc(config,{'op':'answer_settings'})
        if answer!=desired:raise RuntimeError('SAVE_OUTCOME_REQUIRES_REVIEW')
    assert answer==desired and json.loads(SETTINGS.read_text())==desired,'SAVE_READBACK_MISMATCH'
    for k in change['preserve']:assert answer[k]==before[k],k
    assert POINTER.resolve()==release and sha(release/'manifest.json')==manifest_sha,'RELEASE_CHANGED'
    assert sha(CONFIG)==config_sha,'CONFIG_CHANGED'
    record={'status':'INSTALLED','source_commit':sys.argv[1],'setting':'answer_prompt','from_revision':before['revision'],'to_revision':answer['revision'],'preserved':change['preserve'],'release_unchanged':True,'config_unchanged':True,'settings_sha256':sha(SETTINGS),'repeat_paid_calls':0}
    (ROOT/'INSTALLED.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(record,ensure_ascii=False))
