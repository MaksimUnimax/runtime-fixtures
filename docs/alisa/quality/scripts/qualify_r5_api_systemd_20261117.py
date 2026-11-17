"""Finite actual-systemd configuration qualification. Never starts its disposable unit."""
import ast
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import uuid

def qualify(installer, h):
    with Path('/run/lock/alisa-stage-rollout.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        return _qualify(installer,h)

def _qualify(installer, h):
    if os.geteuid()!=0 or not Path('/run/systemd/system').is_dir():
        raise RuntimeError('Root and actual systemd required')
    tree=ast.parse(Path(installer).read_text())
    functions=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in {'overlay','expected_static','need'}]
    unit='alisa-r5-overlay-fixture-'+uuid.uuid4().hex+'.service'
    fragment=Path('/run/systemd/system')/unit
    drop=fragment.with_name(unit+'.d')
    assert not fragment.exists() and not drop.exists()
    with tempfile.TemporaryDirectory(prefix='alisa-r5-overlay-',dir='/run') as folder:
        root=Path(folder);base=root/'base';app=root/'candidate';base.mkdir();app.mkdir()
        flags=root/'flags.env';flags.write_text('SYNTHETIC_FLAG=1\n');flags.chmod(0o600)
        for release in [base,app]:
            (release/'.venv/bin').mkdir(parents=True);(release/'.venv/bin/python').symlink_to('/bin/true')
            (release/'infra').mkdir();(release/'infra/launch.py').write_text('# synthetic never executed\n')
        raw=('[Service]\nWorkingDirectory='+str(base)+'\nExecStart=\nExecStart='+str(base)+'/.venv/bin/python '+str(base)+'/infra/launch.py platform\nEnvironmentFile='+str(flags)+'\n').encode()
        old=drop/'10-accepted.conf';selector=drop/'20-candidate.conf'
        g={'BASE':base,'APP':app,'OLD_SELECTOR_SHA':hashlib.sha256(raw).hexdigest(),'SELECTOR':selector,'hashlib':hashlib,'json':json}
        exec(compile(ast.Module(body=functions,type_ignores=[]),str(installer),'exec'),g)
        try:
            fragment.write_text('[Unit]\nDescription=Owned R5 configuration fixture, never started\n[Service]\nType=oneshot\nExecStart=/bin/true\n');fragment.chmod(0o644)
            drop.mkdir(mode=0o755);old.write_bytes(raw);old.chmod(0o644)
            h.run('systemctl','daemon-reload');before=h.static(unit)
            legacy=raw.replace(str(base).encode(),str(app).encode())
            selector.write_bytes(legacy);selector.chmod(0o644);h.run('systemctl','daemon-reload')
            expected=g['expected_static'](before,h.sha(selector));legacy_loaded=h.static(unit)
            drift={k for k in expected if expected[k]!=legacy_loaded[k]}
            if drift!={'EnvironmentFiles'}:raise RuntimeError('Unexpected legacy drift '+repr(drift))
            selector.write_bytes(g['overlay'](raw));selector.chmod(0o644);h.run('systemctl','daemon-reload')
            if h.static(unit)!=g['expected_static'](before,h.sha(selector)):raise RuntimeError('Execution-only overlay differs')
            if h.prop(unit,'MainPID')!='0' or h.prop(unit,'ActiveState')!='inactive':raise RuntimeError('Fixture unexpectedly started')
            return {'legacy_duplicate_reproduced':True,'execution_only_static_matches':True,'fixture_never_started':True}
        finally:
            # Only our randomly named, never-started fixture is removed.
            if fragment.exists():
                if h.prop(unit,'MainPID')!='0':raise RuntimeError('Fixture consumer appeared')
                for p in [selector,old]:
                    if p.exists():p.unlink()
                if drop.exists():drop.rmdir()
                fragment.unlink();h.run('systemctl','daemon-reload')

def main():
    import argparse
    ap=argparse.ArgumentParser();ap.add_argument('--installer',type=Path,required=True);ap.add_argument('--primitives',type=Path,required=True);args=ap.parse_args()
    spec=importlib.util.spec_from_file_location('trusted_installer_primitives',args.primitives);h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
    print(json.dumps(qualify(args.installer,h)))

if __name__=='__main__':main()
