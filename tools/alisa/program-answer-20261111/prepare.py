"""Prepare an isolated candidate and socket executor, without switching the core."""
from pathlib import Path
import hashlib,json,os,pwd,shutil,subprocess,sys
HERE=Path(__file__).resolve().parent
OLD=Path('/opt/alice-market/releases/alisa-query-insights-r1-20261110')
NEW=Path('/opt/alice-market/candidates/alisa-program-answer-r1-20261111')
PREFIX=Path('/opt/alisa-program/releases/20261111-r1');BASE=Path('/var/lib/alisa-program')
CORE=['model_answer.py','http_transport.py','request_recovery.py','engine.py','runtime.py',
      'model_program.py','model_program_wire.py','model_program_receipts.py']
BROKER=['program_broker.py','program_worker.py','harness.patch.yml']
def command(args):return subprocess.check_output(args,text=True).strip()
def main():
    os.umask(0o022)
    assert command(['systemctl','show','alice-market','-p','WorkingDirectory','--value'])==str(OLD)
    try:pwd.getpwnam('alisa-program')
    except KeyError:subprocess.run(['useradd','--system','--no-create-home','--shell','/usr/sbin/nologin','alisa-program'],check=True)
    user=pwd.getpwnam('alisa-program');BASE.mkdir(exist_ok=True);BASE.chmod(0o700)
    for name in ['jobs','rootfs']: (BASE/name).mkdir(exist_ok=True,mode=0o700)
    root=BASE/'rootfs';root.chmod(0o755)
    for name in ['usr','workspace','tmp','proc','dev','etc','opt/alisa-program/releases/20261111-r1','opt/alisa-dsh-lab/20261110-r1']:
        (root/name).mkdir(parents=True,exist_ok=True);(root/name).chmod(0o755)
    for name,target in [('bin','usr/bin'),('sbin','usr/sbin'),('lib','usr/lib'),('lib64','usr/lib64')]:
        f=root/name
        if not f.exists() and not f.is_symlink():f.symlink_to(target)
    (root/'etc/passwd').write_text(f'root:x:0:0:root:/root:/usr/sbin/nologin\nalisa-program:x:{user.pw_uid}:{user.pw_gid}:Isolated program:/workspace/home:/usr/sbin/nologin\n')
    (root/'etc/group').write_text(f'root:x:0:\nalisa-program:x:{user.pw_gid}:\n');(root/'etc/nsswitch.conf').write_text('passwd: files\ngroup: files\nhosts: files\n')
    if not NEW.exists():shutil.copytree(OLD,NEW)
    for name in CORE+['qa_program_smoke.py']:shutil.copy2(HERE/name,NEW/name);(NEW/name).chmod(0o644)
    shutil.copy2(HERE/'test_program_answers.py',NEW/'tests/test_program_answers.py');(NEW/'tests/test_program_answers.py').chmod(0o644)
    PREFIX.mkdir(parents=True,exist_ok=True);PREFIX.chmod(0o755)
    for name in BROKER:shutil.copy2(HERE/name,PREFIX/name);(PREFIX/name).chmod(0o600 if name=='program_broker.py'else 0o644)
    rule=f'''table inet alisa_program {{
 chain output {{
  type filter hook output priority 0; policy accept;
  meta skuid {user.pw_uid} ip daddr 127.0.0.1 tcp dport 33193 counter accept
  meta skuid {user.pw_uid} counter reject
 }}
}}
'''
    nft=Path('/etc/alisa-program.nft');nft.write_text(rule);nft.chmod(0o600)
    if subprocess.run(['nft','list','table','inet','alisa_program'],capture_output=True).returncode!=0:
        subprocess.run(['nft','-f',str(nft)],check=True)
    units={
      'alisa-program-firewall.service':'''[Unit]
Description=Network isolation for model-written programs
Before=alisa-program.socket
[Service]
Type=oneshot
ExecStart=/bin/sh -c '/usr/sbin/nft list table inet alisa_program >/dev/null 2>&1 || /usr/sbin/nft -f /etc/alisa-program.nft'
RemainAfterExit=yes
''',
      'alisa-program.socket':'''[Unit]
Description=Private official Harness execution socket
Requires=alisa-program-firewall.service
After=alisa-program-firewall.service
[Socket]
ListenStream=/run/alisa-program/runner.sock
SocketUser=alice-market
SocketGroup=alice-lab
SocketMode=0600
DirectoryMode=0755
Accept=yes
MaxConnections=2
RemoveOnStop=yes
[Install]
WantedBy=sockets.target
''',
      'alisa-program@.service':f'''[Unit]
Description=Isolated official Harness turn
Requires=alisa-program-firewall.service
After=alisa-program-firewall.service
[Service]
ExecStart=/usr/bin/python3 -B {PREFIX}/program_broker.py
Environment=PROGRAM_PARENT_UNIT=%n
StandardInput=socket
StandardOutput=socket
StandardError=journal
UMask=0077
KillMode=control-group
TimeoutStopSec=10s
MemoryMax=256M
TasksMax=32
''',
      'alisa-program-cleanup.service':f'''[Unit]
Description=Remove inactive abandoned program directories
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 -B {PREFIX}/program_broker.py --sweep
''',
      'alisa-program-cleanup.timer':'''[Unit]
Description=Clean inactive program directories every fifteen minutes
[Timer]
OnBootSec=15min
OnUnitActiveSec=15min
[Install]
WantedBy=timers.target
'''}
    for name,value in units.items(): (Path('/etc/systemd/system')/name).write_text(value)
    subprocess.run(['systemctl','daemon-reload'],check=True)
    subprocess.run(['systemctl','enable','--now','alisa-program.socket','alisa-program-cleanup.timer'],check=True)
    print(json.dumps({'candidate':str(NEW),'executor':str(PREFIX),'core_switched':False,
                      'sources':{n:hashlib.sha256((NEW/n).read_bytes()).hexdigest()for n in CORE}}))
if __name__=='__main__':main()
