"""Switch the current deployment between jobs, with automatic rollback."""
from pathlib import Path
import fcntl,hashlib,json,os,shutil,sqlite3,subprocess,sys,time
BASE=Path('/opt/alice-market/releases/alisa-query-insights-r1-20261110')
CANDIDATE=Path('/opt/alice-market/candidates/alisa-program-answer-r1-20261111')
RELEASE=Path('/opt/alice-market/releases/alisa-program-answer-r1-20261111')
RULE=' Кратко ответь только на вопрос пользователя. Оставь лишь запрошенные сведения. Не озвучивай ход вычислений, технические подробности и пути файлов. Не добавляй причины и объяснения, которых нет в полученных данных.'
def run(*args):return subprocess.check_output(args,text=True).strip()
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    lock=open('/run/lock/alisa-market-config.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    assert run('systemctl','show','alice-market','-p','WorkingDirectory','--value')==str(BASE)
    regression=Path('/root/alisa-program-regression-r2.log').read_text()
    assert '\nOK\n'in regression and 'FAILED ('not in regression
    assert '"mode": "cancel", "passed": true'in Path('/root/alisa-program-smoke-r2.log').read_text()
    assert '\nOK\n'in Path('/root/alisa-program-route-tests-r2.log').read_text()
    # The candidate is a copy of the active release, never an older git checkout.
    changed={'engine.py','http_transport.py','model_answer.py','request_recovery.py','runtime.py'}
    for old in BASE.iterdir():
        if old.is_file()and old.suffix in {'.py','.json'}and old.name not in changed:
            assert (CANDIDATE/old.name).exists()and digest(old)==digest(CANDIDATE/old.name),old.name
    if RELEASE.exists():
        for name in changed|{'model_program.py','model_program_wire.py','model_program_receipts.py'}:assert digest(RELEASE/name)==digest(CANDIDATE/name),name
    else:shutil.copytree(CANDIDATE,RELEASE)
    for name in ['qa_program_smoke.py','qa_program_live.py','qa_program_live_input.json']:(RELEASE/name).unlink(missing_ok=True)
    from program_package import admit
    admit(RELEASE,BASE,sys.argv[1])
    subprocess.run(['/usr/bin/python3','-I','-B','/usr/local/libexec/alisa/runtime_versions_sync.py','--source',str(RELEASE),'--check'],check=True)
    subprocess.run(['/usr/bin/python3','-B',str(RELEASE/'runtime.py'),'--config','/etc/alice-market/market-runtime.json','--check'],check=True)
    dropins=[Path(x)for x in run('systemctl','show','alice-market','-p','DropInPaths','--value').split()]
    deployment=[p for p in dropins if 'WorkingDirectory='+str(BASE)in p.read_text()][-1]
    before=deployment.read_bytes();settings=Path('/var/lib/alice-market/answer-settings.json');prior=settings.read_bytes();owner=settings.stat()
    backup=Path('/root/alisa-program-rollout-backup-'+str(time.time_ns()));backup.mkdir(exist_ok=False,mode=0o700)
    (backup/'deployment.conf').write_bytes(before);(backup/'answer-settings.json').write_bytes(prior)
    (backup/'deployment-path.txt').write_text(str(deployment))
    subprocess.run(['systemctl','stop','alice-market'],check=True)
    switched=False
    try:
        cfg=json.loads(Path('/etc/alice-market/market-runtime.json').read_text())
        c=sqlite3.connect('file:'+cfg['database']+'?mode=ro',uri=True)
        assert c.execute("SELECT COUNT(*) FROM jobs WHERE state IN('QUEUED','RUNNING')OR(state='READY'AND delivered=0)").fetchone()[0]==0,'Wait for pending jobs'
        c.close()
        sys.path.insert(0,str(RELEASE));from model_answer import Settings,DEFAULTS
        store=Settings(settings);s=store.read();revision=s.pop('revision')
        if RULE.strip()not in s['answer_prompt']:s['answer_prompt']+=RULE
        store.save(revision,**{k:s[k]for k in DEFAULTS});os.chown(settings,owner.st_uid,owner.st_gid)
        text=before.decode().replace(str(BASE),str(RELEASE));deployment.write_text(text)
        subprocess.run(['systemctl','daemon-reload'],check=True);subprocess.run(['systemctl','start','alice-market'],check=True);switched=True
        for _ in range(30):
            if run('systemctl','is-active','alice-market')=='active' and Path(cfg['socket']).exists():break
            time.sleep(.5)
        else:raise RuntimeError('Gateway did not start')
        pid=run('systemctl','show','alice-market','-p','MainPID','--value');time.sleep(2)
        assert pid!='0'and run('systemctl','show','alice-market','-p','MainPID','--value')==pid
        assert run('systemctl','show','alice-market','-p','WorkingDirectory','--value')==str(RELEASE)
        assert run('systemctl','is-active','alisa-station')=='active'
        assert run('systemctl','is-active','alisa-program.socket')=='active'
        result={'installed':True,'release':str(RELEASE),'threshold_characters':10000,'settings_revision':revision+1,
                'settings_sha256':digest(settings),'deployment_path':str(deployment),'voice_tests_remain_paused':True,
                'core_files':{p.name:digest(p)for p in RELEASE.iterdir()if p.is_file()and p.suffix in{'.py','.json'}}}
        (backup/'INSTALLED.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps({k:v for k,v in result.items()if k!='core_files'}))
    except BaseException:
        subprocess.run(['systemctl','stop','alice-market'],check=False)
        deployment.write_bytes(before);settings.write_bytes(prior);settings.chmod(owner.st_mode&0o777);os.chown(settings,owner.st_uid,owner.st_gid)
        subprocess.run(['systemctl','daemon-reload'],check=True);subprocess.run(['systemctl','start','alice-market'],check=True)
        raise
if __name__=='__main__':main()
