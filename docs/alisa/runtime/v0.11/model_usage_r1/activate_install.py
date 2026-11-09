"""Scoped systemd code switch. Queue data and credentials are never restored."""
import json, sqlite3, subprocess, time
from pathlib import Path
from prepare_install import ROOT, BASE, STATION, TARGET, STARGET, show, digest

def command(*args):subprocess.run(args,check=True,capture_output=True,text=True)

def override(unit,text):
    directory=Path('/etc/systemd/system')/(unit+'.d')
    directory.mkdir(exist_ok=True)
    latest=max(directory.glob('*.conf'),key=lambda p:p.name)
    path=directory/(latest.stem+'z-model-usage.conf')
    assert not path.exists(),'OWN_OVERRIDE_EXISTS_INSPECT_RECEIPT'
    path.write_text('[Service]\n'+text)
    return path

def main():
    receipt=json.loads((ROOT/'PREPARED_R3.json').read_text())
    assert show('alice-market.service','WorkingDirectory')==str(BASE),'ACTIVE_BASE_CHANGED'
    assert show('alisa-station.service','WorkingDirectory')==str(STATION),'STATION_BASE_CHANGED'
    assert receipt['config_sha256']==digest(Path('/etc/alice-market/market-runtime.json')),'CONFIG_CHANGED'
    with sqlite3.connect('file:/var/lib/alice-market/state.sqlite3?mode=ro',uri=True)as c:
        assert c.execute("SELECT COUNT(*) FROM jobs WHERE state IN ('QUEUED','RUNNING')").fetchone()[0]==0,'ACTIVE_JOBS_WAIT'
    for n,h in receipt['source_hashes'].items():
        prefix,name=n.split('/',1);path=(TARGET if prefix=='runtime'else STARGET)/name
        assert digest(path)==h,'PRESTART_SOURCE_MISMATCH'
    app_overrides=[]
    try:
        app_overrides.append(override('alice-market.service',f'WorkingDirectory={TARGET}\nExecStart=\nExecStart=/usr/bin/python3 -B {TARGET}/runtime.py --config /etc/alice-market/market-runtime.json\n'))
        app_overrides.append(override('alisa-station.service',f'WorkingDirectory={STARGET}\nExecStart=\nExecStart=/usr/bin/python3 -B {STARGET}/service.py --state /var/lib/alisa-station --key /run/credentials/alisa-station.service/station-key\n'))
        maintenance=override('alice-market-retention.service',f'ExecStart=\nExecStart=/usr/bin/python3 -B {TARGET}/retention.py --database /var/lib/alice-market/state.sqlite3 --status-file /var/lib/alice-market/retention-status.json\n')
        receipt['app_overrides']=[str(p)for p in app_overrides];receipt['maintenance_override']=str(maintenance)
        (ROOT/'ACTIVATING_R3.json').write_text(json.dumps(receipt,indent=2))
        command('systemctl','daemon-reload')
        command('systemctl','restart','alice-market.service')
        command('systemctl','restart','alisa-station.service')
        command('systemctl','start','alice-market-retention.service')
        time.sleep(1)
        for unit in ['alice-market.service','alisa-station.service']:
            assert show(unit,'ActiveState')=='active',unit+'_FAILED'
        assert show('alice-market.service','WorkingDirectory')==str(TARGET),'RUNTIME_NOT_SELECTED'
        assert show('alisa-station.service','WorkingDirectory')==str(STARGET),'STATION_NOT_SELECTED'
        assert show('alice-market-retention.timer','ActiveState')=='active','RETENTION_TIMER_INACTIVE'
        assert receipt['config_sha256']==digest(Path('/etc/alice-market/market-runtime.json')),'CONFIG_MODIFIED'
        for n,h in receipt['source_hashes'].items():
            prefix,name=n.split('/',1);path=(TARGET if prefix=='runtime'else STARGET)/name
            assert digest(path)==h,'INSTALLED_SOURCE_MISMATCH'
        receipt['state']='INSTALLED';receipt['at']=time.time()
        (ROOT/'INSTALLED_R3.json').write_text(json.dumps(receipt,indent=2))
        print(json.dumps(dict(state='INSTALLED',runtime=TARGET.name,station=STARGET.name,source=receipt['source_commit'])))
    except BaseException as error:
        # Each recovery is attempted even if another recovery step fails.
        recovery_errors=[]
        for p in app_overrides:
            try:p.unlink(missing_ok=True)
            except Exception as failure:recovery_errors.append(type(failure).__name__)
        for args in [('systemctl','daemon-reload'),('systemctl','restart','alice-market.service'),('systemctl','restart','alisa-station.service')]:
            try:command(*args)
            except Exception as failure:recovery_errors.append(type(failure).__name__)
        restored={}
        for unit,base in [('alice-market.service',BASE),('alisa-station.service',STATION)]:
            try:restored[unit]=show(unit,'ActiveState')=='active' and show(unit,'WorkingDirectory')==str(base)
            except Exception:restored[unit]=False
        state='ROLLED_BACK' if all(restored.values()) and not recovery_errors else 'ROLLBACK_FAILED'
        (ROOT/'ROLLED_BACK_R3.json').write_text(json.dumps(dict(state=state,error=type(error).__name__,recovery_errors=recovery_errors,restored=restored)))
        raise

if __name__=='__main__':main()
