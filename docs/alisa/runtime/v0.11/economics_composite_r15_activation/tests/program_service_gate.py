"""Actual socket/timer/instance admission and unit-file recovery fixture.

Production constants are mapped ONLY inside this standalone test to owned
/run units and directories. No production CLI fixture switch is introduced.
The new synthetic service executes the real broker's retained v2/v3 path with
fixture peer/lock/result-store dependencies, and fails on fresh dispatch.
"""
from pathlib import Path
from contextlib import contextmanager, ExitStack
from types import SimpleNamespace
from unittest.mock import patch
import argparse
import fcntl
import hashlib
import json
import os
import re
import shutil
import socket
import stat
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import activate as a


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def command(*args):
    p = subprocess.run(args, capture_output=True, timeout=20)
    need(p.returncode == 0, 'FIXTURE_COMMAND_'+args[0])
    return p.stdout


def property_value(unit, name):
    return command('systemctl','show',unit,'--property='+name,'--value').decode().strip()


def request(endpoint, value, *, ack=False):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as peer:
        peer.settimeout(3)
        peer.connect(str(endpoint))
        stream=peer.makefile('rwb')
        stream.write((json.dumps(value)+'\n').encode());stream.flush()
        reply=json.loads(stream.readline(65537))
        if ack:
            stream.write((json.dumps({'kind':'ack','digest':reply['digest']})+'\n').encode());stream.flush()
        return reply


def wait_idle(fence):
    deadline=time.monotonic()+8
    while True:
        try:
            fence.require_idle();return
        except a.c.Blocked as exc:
            if exc.code != 'PROGRAM_INSTANCE_BUSY' or time.monotonic() >= deadline:
                raise
            time.sleep(.1)


def gate(root, broker_source, result_source):
    need(os.geteuid()==0 and root.parent in (Path('/run'),Path('/root'))
         and re.fullmatch(r'alisa-r15-program-ci-[0-9]+-[0-9]+',root.name), 'FIXTURE_SCOPE')
    need(root.is_dir() and not root.is_symlink() and root.stat().st_uid==0, 'FIXTURE_ROOT')
    need(hashlib.sha256(broker_source.read_bytes()).hexdigest()==a.program_pair.FILES['program_broker.py'], 'BROKER_PIN')
    need(hashlib.sha256(result_source.read_bytes()).hexdigest()==a.program_pair.FILES['program_results.py'], 'RESULTS_PIN')
    need(shutil.rmtree.avoids_symlink_attacks, 'FIXTURE_CLEANUP_SUPPORT')
    report=[]
    for case in ('rollback','apply','busy','expired'):
        folder=root/case;folder.mkdir(mode=0o700)
        stem=root.name+'-'+case
        names={'socket':stem+'.socket','timer':stem+'-cleanup.timer',
               'cleanup':stem+'-cleanup.service','template':stem+'@.service','probe':stem+'@probe.service'}
        units=Path('/run/systemd/system');masks=Path('/run/systemd/system.control')
        need(all(not os.path.lexists(d/n) for d in (units,masks) for n in names.values()), 'FIXTURE_UNIT_EXISTS')
        need(all(property_value(n,'LoadState')=='not-found' for k,n in names.items() if k != 'template'),'FIXTURE_UNIT_LOADED')
        for n in ('old','source','candidates','locks','store'):(folder/n).mkdir(mode=0o700)
        for n in ('results','jobs'):(folder/'store'/n).mkdir(mode=0o700)
        stage_lock=folder/'locks/alisa-stage-rollout.lock';program_lock=folder/'locks/alisa-program.lock'
        stage_lock.write_bytes(b'');stage_lock.chmod(0o600);program_lock.write_bytes(b'');program_lock.chmod(0o600)
        endpoint=folder/'runner.sock'
        old_code="import sys,json\nif sys.argv[1:]==['--sweep']:raise SystemExit(0)\njson.loads(sys.stdin.readline())\nprint(json.dumps({'kind':'legacy'}),flush=True)\n"
        (folder/'old/program_broker.py').write_text(old_code)
        (folder/'source/broker_source.py').write_bytes(broker_source.read_bytes())
        (folder/'source/program_results.py').write_bytes(result_source.read_bytes())
        wrapper='''import builtins,importlib.util,json,os,sys\nfrom pathlib import Path\nfrom types import SimpleNamespace\nroot=Path(__file__).resolve().parent.parent\nif sys.argv[1:]==['--sweep']:raise SystemExit(0)\np=Path(__file__).with_name('broker_source.py')\nspec=importlib.util.spec_from_file_location('fixture_retained_broker',p)\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nm.BASE=root/'store'\nm.pwd=SimpleNamespace(getpwnam=lambda name:SimpleNamespace(pw_uid=os.getuid(),pw_gid=os.getgid()))\noriginal_open=builtins.open\nm.open=lambda path,*args,**kw:original_open(root/'locks/alisa-program.lock' if str(path)=='/run/lock/alisa-program.lock' else path,*args,**kw)\ndef forbidden(*args,**kw):\n (root/'FRESH_DISPATCH_FORBIDDEN').write_text('invoked')\n raise RuntimeError('fresh dispatch forbidden')\nm.subprocess=SimpleNamespace(run=forbidden,Popen=forbidden)\nm.active=lambda name:False\ntry:m.serve()\nexcept BaseException:\n print(json.dumps({'kind':'error','code':'FIXTURE_BROKER_REJECTED'}),flush=True)\n raise SystemExit(1)\n'''
        (folder/'source/program_broker.py').write_text(wrapper)
        body={'protocol':2,'job_id':'a'*64,'resume_only':True,'messages':[{'role':'user','content':'synthetic'}],
              'document':'{}','model':'synthetic-no-provider','user_id':'alisa_p_'+'b'*64}
        fields={k:body[k] for k in ('job_id','user_id','messages','document','model')}
        fp=hashlib.sha256(json.dumps(fields,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
        content='synthetic retained answer';digest=hashlib.sha256(content.encode()).hexdigest()
        result=folder/'store/results'/('a'*64+'.json')
        raw=(json.dumps({'state':'complete','fingerprint':fp,'at':time.time(),'content':content,'digest':digest})+'\n').encode()
        result.write_bytes(raw);result.chmod(0o600)
        template=('[Unit]\nDescription=Owned R15 socket fixture\n[Service]\n'
                  'ExecStart=/usr/bin/python3 -B {root}/program_broker.py\nStandardInput=socket\n'
                  'StandardOutput=socket\nStandardError=journal\nRuntimeMaxSec=10\nTimeoutStopSec=2\n'
                  'KillMode=control-group\nMemoryMax=64M\nTasksMax=16\nNoNewPrivileges=yes\nPrivateNetwork=yes\n')
        cleanup='[Service]\nType=oneshot\nExecStart=/usr/bin/python3 -B {root}/program_broker.py --sweep\n'
        old={names['template']:template.format(root=folder/'old').encode(),names['cleanup']:cleanup.format(root=folder/'old').encode()}
        new={names['template']:template.format(root=folder/'new').encode(),names['cleanup']:cleanup.format(root=folder/'new').encode()}
        definitions={**old,
            names['socket']:('[Socket]\nListenStream='+str(endpoint)+'\nSocketUser=root\nSocketGroup=root\nSocketMode=0600\nAccept=yes\nRemoveOnStop=yes\n').encode(),
            names['timer']:('[Timer]\nOnBootSec=1h\nOnUnitActiveSec=1h\nUnit='+names['cleanup']+'\n').encode()}
        for name,data in new.items():p=folder/'candidates'/name;p.write_bytes(data);p.chmod(0o444)
        owned={};exclusion=None;fence=None;host=None
        try:
            for name,data in definitions.items():
                p=units/name
                with p.open('xb') as f:f.write(data)
                p.chmod(0o644);owned[p]=a.path_state(p)
            command('systemctl','daemon-reload');command('systemctl','start',names['socket'],names['timer'])
            need(request(endpoint,body)=={'kind':'legacy'},'OLD_SOCKET')
            @contextmanager
            def fixture_stage_lock():
                with stage_lock.open('r+b') as f:
                    fcntl.flock(f.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB);yield f
            def fixture_lock_state(info):
                a.c.need(stat.S_ISREG(info.st_mode) and info.st_uid==0 and info.st_nlink==1
                         and not info.st_mode&0o022,'UNTRUSTED_LOCK')
                return a._lock_identity(info)
            with ExitStack() as patches:
                values=[(a.c,'LOCK',stage_lock),(a,'lock',fixture_stage_lock),
                    (a,'_lock_parent_state',lambda:a._lock_identity(stage_lock.parent.lstat())),
                    (a,'_lock_file_state',fixture_lock_state),(a.ProgramPairExclusion,'PROGRAM_LOCK',program_lock),
                    (a.ProgramPairUnitTransaction,'UNIT_ROOT',units),
                    (a.ProgramPairUnitTransaction,'BEFORE',{n:a.c.digest(v) for n,v in old.items()}),
                    (a.program_pair,'CHANGING_UNITS',tuple(old)),
                    (a.program_pair,'ROOT',str(folder/'new')),(a.program_pair,'PEER_USER','root'),(a.program_pair,'PEER_GROUP','root'),
                    (a.program_pair,'UNIT_ROOT',str(units)),(a.program_pair,'SOCKET_UNIT',names['socket']),
                    (a.program_pair,'CLEANUP_UNIT',names['cleanup']),(a.program_pair,'ENDPOINT',str(endpoint)),
                    (a.program_pair,'UNIT_QUERIES',{names['probe']:names['template'],names['cleanup']:names['cleanup'],names['socket']:names['socket']}),
                    (a.program_pair,'FILES',{p.name:a.c.digest(p.read_bytes()) for p in (folder/'source').iterdir()}),
                    (a.ProgramPairDeployment,'OLD_ROOT',folder/'old'),
                    (a.ProgramPairDeployment,'OLD_PINS',{p.name:a.c.digest(p.read_bytes()) for p in (folder/'old').iterdir()}),
                    (a.program_pair,'UNIT_FILES',{**{n:a.c.digest(v) for n,v in new.items()},names['socket']:a.c.digest(definitions[names['socket']])}),
                    (a.c,'UNIT_PATHS',tuple(command('systemctl','show','--property=UnitPath','--value').decode().split()))]
                attrs={'UNIT_ROOT':units,'MASK_ROOT':masks,'SOCKET':names['socket'],'TIMER':names['timer'],
                       'CLEANUP':names['cleanup'],'TEMPLATE':names['template'],'PROBE':names['probe'],
                       'INSTANCE_PREFIX':stem+'@','WORKER_PREFIX':stem+'-run-','ENDPOINT':endpoint,
                       'OLD_ROOT':folder/'old','TIMER_SHA':a.c.digest(definitions[names['timer']])}
                values.extend((a.ProgramPairServiceFence,k,v) for k,v in attrs.items())
                for obj,key,value in values:patches.enter_context(patch.object(obj,key,value))
                exclusion=patches.enter_context(a.ProgramPairExclusion())
                records=[]
                fence=a.ProgramPairServiceFence(exclusion,lambda n,v:records.append((n,v)))
                wait_idle(fence);fence.before()
                if case=='busy':
                    peer=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);peer.connect(str(endpoint))
                    try:
                        time.sleep(.15)
                        try:fence.close();raise RuntimeError('ACTIVE_INSTANCE_ACCEPTED')
                        except a.c.Blocked as error:need(error.code=='PROGRAM_INSTANCE_BUSY','BUSY_ERROR')
                        need(not fence.masks,'BUSY_CHANGED_MASKS')
                        need(all((units/n).read_bytes()==v for n,v in definitions.items()),'BUSY_CHANGED_UNIT')
                    finally:peer.close()
                    wait_idle(fence);report.append('active_instance_refused_without_stop_or_file_change');continue
                counts=[]
                def readiness():
                    counts.append('checked');return {'fixture':'idle; no production database loaded'}
                product=SimpleNamespace(tool_pin='b'*64,prepared_hash='c'*64,bundle=folder/'fixture-product',counts=readiness)
                class FixtureDeployment(a.ProgramPairDeployment):
                    # Owner/product policy and existing SDK are substituted.
                    # Masks, stop, jobs/PIDs, publication, unit writes, reload,
                    # rollback, marker and compatibility checks remain real.
                    def product_snapshot(self):return {'fixture_product':'unchanged'}
                    def sdk_context(self):return {'fixture_sdk':'no-dispatch'}
                host=FixtureDeployment(product,folder/'source',folder/'candidates',folder/'deployment',exclusion)
                host.planned=host.make_plan();host.plan_hash=a.c.digest(a.c.encoded(host.planned))
                now=int(time.time())
                host.coordination={'schema':'alisa-r15-maintenance-coordination/v1','source_commit':a.c.PRODUCT,
                    'activation_plan_sha256':host.plan_hash,'tool_sha256':product.tool_pin,'prepared_sha256':product.prepared_hash,
                    'nonce':'d'*32,'issued_at':now,'expires_at':now+120,'coordination':'OWNER_BROWSER_AND_VOICE_WINDOW_CONFIRMED'}
                original_close=host.fence_socket_and_cleanup
                def checked_close():
                    original_close();host.services.require()
                    denied=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
                    try:
                        try:denied.connect(str(endpoint));raise RuntimeError('CLOSED_SOCKET_CONNECTED')
                        except (FileNotFoundError,ConnectionRefusedError):pass
                    finally:denied.close()
                    for name in (names['socket'],names['timer']):
                        pp=subprocess.run(['systemctl','start',name],capture_output=True,timeout=5)
                        need(pp.returncode!=0 and property_value(name,'LoadState')=='masked','MASK_START_BYPASSED')
                    need(result.read_bytes()==raw,'RETAINED_RESULT_CHANGED_DURING_FENCE')
                host.fence_socket_and_cleanup=checked_close
                if case=='rollback':
                    real_reload=host.reload_and_verify_new
                    def fail_after_real_reload():
                        real_reload();raise RuntimeError('INJECTED_AFTER_NEW_UNIT_RELOAD_BEFORE_ADMISSION')
                    host.reload_and_verify_new=fail_after_real_reload
                if case=='expired':
                    real_marker=host.mark_admission_possible
                    def expire_after_marker():
                        real_marker();host.coordination['expires_at']=int(time.time())
                    host.mark_admission_possible=expire_after_marker
                status=a.program_pair.rollout_pair(host)
                expected={'rollback':'PROGRAM_PAIR_PRE_ADMISSION_RESTORED',
                          'expired':'PROGRAM_PAIR_RECOVERY_REQUIRES_REVIEW'}.get(case,'PROGRAM_PAIR_TECHNICAL_PASS')
                need(status==expected,'DEPLOYMENT_PHASE_RESULT_'+status)
                need(len(counts)>=2,'READINESS_BOUNDARY_NOT_CALLED')
                need(result.read_bytes()==raw,'RESULT_STORE_MUTATED_BY_ADAPTER')
                report.append('full_deployment_'+case+'_with_actual_services_and_publication')
                if case=='expired':
                    host.services.require()
                    need(not endpoint.exists(),'EXPIRED_WINDOW_REOPENED_SOCKET')
                    need(all((units/n).read_bytes()==v for n,v in new.items()),'POST_MARKER_AUTOMATIC_DOWNGRADE')
                    report.extend(['expired_window_keeps_actual_socket_and_timer_masked',
                                   'post_marker_expiry_requires_review_without_downgrade'])
                    continue
            if case=='rollback':
                need(request(endpoint,body)=={'kind':'legacy'},'OLD_LISTENER_NOT_RESTORED')
                report.extend(['actual_socket_and_timer_masked','manual_start_refused_while_masked','unit_reload_exact_new',
                               'preadmission_real_file_restore','old_socket_reopened','retained_result_unchanged_on_rollback'])
            else:
                for req in (body,{'protocol':3,'job_id':body['job_id'],'fingerprint':fp,'resume_only':True}):
                    response=request(endpoint,req)
                    need(response.get('kind')=='complete' and response.get('content')==content and response.get('digest')==digest,'RETAINED_RECOVERY')
                    if req['protocol']==3:need(response.get('job_id')==body['job_id'] and response.get('fingerprint')==fp,'V3_BINDING')
                    time.sleep(.1)
                need(result.read_bytes()==raw,'UNACKED_RESULT_REMOVED')
                req={'protocol':3,'job_id':'c'*64,'fingerprint':'d'*64,'resume_only':True}
                need(request(endpoint,req).get('kind')=='unknown','UNKNOWN_RETRIEVAL')
                need(not (folder/'FRESH_DISPATCH_FORBIDDEN').exists(),'FRESH_EXECUTOR_INVOKED')
                report.extend(['new_socket_reopened','actual_retained_v2','actual_retained_v3_bound_answer',
                               'unknown_retrieval_without_dispatch','unacked_result_retained'])
        finally:
            if sys.exc_info()[0] is not None:
                print(json.dumps({'fixture_failure_states':{k:{prop:property_value(n,prop) for prop in
                    ('LoadState','ActiveState','SubState','Job','NeedDaemonReload')} for k,n in names.items()
                    if k != 'template'}}), file=sys.stderr)
            # Own unique fixture scope only. No production names are used here.
            for name in (names['socket'],names['timer']):
                p=masks/name
                if os.path.lexists(p):
                    actual=a.path_state(p)
                    owners=[x for x in (fence,host.services if host else None) if x is not None]
                    need(any(x.masks.get(name)==actual for x in owners),'CLEANUP_FOREIGN_MASK')
                    p.unlink()
            command('systemctl','daemon-reload')
            subprocess.run(['systemctl','stop',names['socket'],names['timer'],names['cleanup']],capture_output=True,timeout=15)
            rows=json.loads(command('systemctl','list-units','--all','--full','--plain','--no-legend','--no-pager','--output=json',stem+'@*.service'))
            for row in rows:
                name=row['unit'];need(name.startswith(stem+'@') and name.endswith('.service'),'CLEANUP_UNIT_SCOPE')
                subprocess.run(['systemctl','stop',name],capture_output=True,timeout=15)
                subprocess.run(['systemctl','reset-failed',name],capture_output=True,timeout=5)
            for name in names.values():subprocess.run(['systemctl','reset-failed',name],capture_output=True,timeout=5)
            for p,before in owned.items():
                allowed=[before]
                if host is not None and host.transaction is not None:
                    allowed.append(host.transaction.ours.get(p.name))
                need(a.path_state(p) in allowed and p.read_bytes() in
                     (definitions[p.name],new.get(p.name,b'')),'CLEANUP_LATER_WRITER')
                p.unlink()
            command('systemctl','daemon-reload')
            need(all(property_value(n,'LoadState')=='not-found' for k,n in names.items() if k != 'template'),'FIXTURE_NOT_UNLOADED')
            need(not (folder/'FRESH_DISPATCH_FORBIDDEN').exists(),'FRESH_EXECUTOR_INVOKED')
            shutil.rmtree(folder)
    return {'status':'PASS','checks':report,'checks_count':len(report),'real_systemd':True,
            'tool_sha256':a.tool_hash(),'test_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'real_retained_protocols':[2,3],'product_readiness_and_sdk':'fixture substitutes; not live qualification','provider_calls':0,'production_configuration_read':False,
            'fixture_units_removed':True,'fixture_result_data_removed':True}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,required=True)
    parser.add_argument('--broker-source',type=Path,required=True);parser.add_argument('--result-source',type=Path,required=True)
    args=parser.parse_args()
    print(json.dumps(gate(args.root,args.broker_source,args.result_source),sort_keys=True))
