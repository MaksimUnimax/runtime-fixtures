"""Finite code-only installation preparation; no credential or DB snapshot."""
import hashlib, json, shutil, subprocess
from pathlib import Path

ROOT=Path('/root/alice-lab-evidence/model-usage-20261109')
CANDIDATE=Path('/dev/shm/alisa-model-usage-20261109/model-feedback-final')
BASE=Path('/opt/alice-market/releases/alisa-model-usage-r5-repair-20261109')
OLD=BASE
STATION=Path('/opt/alisa-station/releases/station-auto-r8-model-usage-r5')
TARGET=Path('/opt/alice-market/releases/alisa-model-usage-r6-feedback-20261109')
STARGET=Path('/opt/alisa-station/releases/station-auto-r8-model-usage-r6')
SOURCE=None

def show(unit, prop):
    return subprocess.check_output(['systemctl','show',unit,'-p',prop,'--value'],text=True).strip()

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    global SOURCE
    import os,re
    SOURCE=os.environ['ALISA_MODEL_USAGE_SOURCE_SHA']
    assert re.fullmatch('[0-9a-f]{40}',SOURCE),'SOURCE_SHA_REQUIRED'
    assert show('alice-market.service','WorkingDirectory')==str(BASE),'ACTIVE_BASE_CHANGED'
    assert show('alisa-station.service','WorkingDirectory')==str(STATION),'STATION_BASE_CHANGED'
    selected=['engine.py','repository.py','http_transport.py','shared_http.py','retention.py','local_gateway.py','runtime.py']
    base_manifest=json.loads((BASE/'manifest.json').read_text())
    assert all(digest(BASE/n)==h for n,h in base_manifest['files'].items()),'BASE_MANIFEST_CHANGED'
    need=sum(p.stat().st_size for p in CANDIDATE.rglob('*')if p.is_file())
    assert shutil.disk_usage('/').free-need>3072*1024**2,'DISK_RESERVE'
    import os
    assert os.statvfs('/').f_favail>200000,'INODE_RESERVE'
    ROOT.mkdir(mode=0o700,exist_ok=True)
    expected=json.loads((ROOT/'source-hashes.json').read_text())
    assert all(digest(CANDIDATE/n)==h for n,h in expected.items()),'EXACT_SOURCE_MISMATCH'
    for src,dst,prefix in [(BASE,TARGET,'runtime'),(STATION,STARGET,'station')]:
        assert not dst.exists(),'TARGET_ALREADY_EXISTS_INSPECT_RECEIPT'
        shutil.copytree(src,dst,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
        # Start from the ENTIRE installed base, including nested catalogs/tests.
        for name in expected:
            kind,rel=name.split('/',1)
            if kind==prefix:
                (dst/rel).parent.mkdir(parents=True,exist_ok=True)
                shutil.copyfile(CANDIDATE/name,dst/rel)
        changed={name.split('/',1)[1]for name in expected if name.startswith(prefix+'/')}
        for original in src.rglob('*'):
            if original.is_file() and '__pycache__'not in original.parts:
                rel=str(original.relative_to(src))
                if rel not in changed and rel!='manifest.json':
                    assert digest(original)==digest(dst/rel),'UNOWNED_BASE_FILE_CHANGED'
        manifest=dict(artifact_id=dst.name,source_commit=SOURCE,base_artifact=BASE.name if dst==TARGET else STATION.name,
            files={str(p.relative_to(dst)):digest(p)for p in sorted(dst.rglob('*'))if p.is_file()and p.name!='manifest.json'})
        (dst/'manifest.json').write_text(json.dumps(manifest,indent=2))
    config=Path('/etc/alice-market/market-runtime.json')
    original=json.loads(config.read_text());old_pin=original['read_surface']['pin']
    new_pin=subprocess.check_output(['/usr/bin/python3','-B','-c','import read_surface;print(read_surface.PIN)'],cwd=TARGET,text=True).strip()
    original['read_surface']['pin']=new_pin
    import tempfile
    fd,temporary=tempfile.mkstemp(prefix='model-usage-policy-',dir='/dev/shm')
    try:
        os.fchmod(fd,0o640);os.fchown(fd,0,__import__('grp').getgrnam('alice-lab').gr_gid)
        with os.fdopen(fd,'w')as stream:json.dump(original,stream)
        subprocess.run(['runuser','-u','alice-market','--','/usr/bin/python3','-B','/opt/alice-market/releases/runtime-policy-guard-20261108/check.py','--release',str(TARGET),'--config',temporary],check=True)
    finally:Path(temporary).unlink(missing_ok=True)
    receipt=dict(state='PREPARED',source_commit=SOURCE,runtime=str(TARGET),station=str(STARGET),base=str(BASE),
        config_sha256=digest(config),old_pin=old_pin,new_pin=new_pin,source_hashes=expected)
    (ROOT/'PREPARED_R6.json').write_text(json.dumps(receipt,indent=2))
    Path('/opt/alice-market/.model-usage-7d-owner.lock').write_text(json.dumps(dict(owner='controller-model-usage-20261109',status='PREPARED',
        scope='Dispatch marker, seven-day accounting, OWNER UI; preserve active read-r5 and all matrices',runtime=str(TARGET),evidence=str(ROOT)),indent=2))
    print(json.dumps(dict(state='PREPARED',source=SOURCE,files=len(expected),bytes=need)))

if __name__=='__main__':main()
