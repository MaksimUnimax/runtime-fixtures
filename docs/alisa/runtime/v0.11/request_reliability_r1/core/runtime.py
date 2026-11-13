"""Private non-root market service entrypoint. Disabled until independently qualified.
--check validates non-secret configuration only; it never reads a token or calls a provider.
"""
from __future__ import annotations
import argparse
import json
import os
import pwd
import signal
import stat
import threading
import time
from pathlib import Path
from engine import Engine,Worker
from repository import Repository
from semantics import Scope,Store,Rejected,strict_json
from registry import REGISTRY_HASH
from http_transport import HTTPTransport
from local_gateway import Gateway

class Configuration:
    def __init__(self,path):self.path=Path(path)
    def read(self):
        d=strict_json(self.path.read_text())
        if (not isinstance(d,dict) or type(d.get('execution_enabled')) is not bool
            or not isinstance(d.get('accounts'),dict) or not isinstance(d.get('credential_bindings'),dict)
            or not isinstance(d.get('qualifications'),dict)):
            raise Rejected('CONFIG_SCHEMA')
        a=d.get('report_archive')
        if a is not None and (type(a)is not dict or set(a)-{'enabled','max_bytes'} or type(a.get('enabled'))is not bool or type(a.get('max_bytes',256*1024*1024))is not int or not 16*1024*1024<=a.get('max_bytes',256*1024*1024)<=1024*1024*1024):
            raise Rejected('CONFIG_SCHEMA')
        from selector_policy import validate as validate_selector_policy
        validate_selector_policy(d.get('selector_prompt'))
        return d
    def scope(self,tenant):
        d=self.read();account=d['accounts'].get(tenant)
        if not isinstance(account,dict) or account.get('active') is not True:
            raise Rejected('TENANT_DENIED')
        stores=tuple(Store(**s) for s in account['stores'])
        return Scope(tenant,account['revision'],stores)
    def ready(self):
        d=self.read()
        if d['execution_enabled'] is not True:
            raise Rejected('LIVE_DISABLED')
        from scalar_runtime import SOURCES,MATRIX
        for operation in SOURCES.sources:
            proof=d['qualifications'].get(operation,{})
            if (proof.get('status') not in ('LIVE_LAB_VERIFIED','READ_ONLY_CANARY') or proof.get('registry_hash')!=REGISTRY_HASH
                or proof.get('scalar_hash')!=MATRIX.hash or not proof.get('evidence_ref')):
                raise Rejected('DECODER_NOT_LIVE_QUALIFIED')
        return d

def main(argv=None):
    parser=argparse.ArgumentParser()
    parser.add_argument('--config',required=True)
    parser.add_argument('--check',action='store_true')
    args=parser.parse_args(argv)
    config=Configuration(args.config)
    d=config.read()
    from runtime_port_service import validate as validate_port
    validate_port(d)
    if args.check:
        for tenant in d['accounts']:config.scope(tenant)
        print(json.dumps({'schema':'PASS','execution_enabled':d['execution_enabled'],
                          'registry_hash':REGISTRY_HASH,'external_calls':0,'secrets_read':False}))
        return 0
    d=config.ready()
    if os.geteuid()==0:
        raise Rejected('NON_ROOT_SERVICE_REQUIRED')
    directory=os.environ.get('CREDENTIALS_DIRECTORY')
    if not directory:raise Rejected('SYSTEMD_CREDENTIALS_REQUIRED')
    os.umask(0o077)
    repo=Repository(d['database'])
    import model_usage, retention
    model_usage.begin_run(repo)
    retention.sweep(repo)
    from universal_reads import ReadSurface
    reads=None  # Owner-ordered temporary TEMPLATE_ONLY mode; no universal planner.
    from model_answer import Settings
    answer_settings=Settings(Path(d['database']).parent/'answer-settings.json')
    from report_archive import Archive
    archive_settings=d.get('report_archive',{})
    archive=Archive(repo,budget=archive_settings.get('max_bytes',256*1024*1024)) if archive_settings.get('enabled')is True else None
    if archive is not None:
        from protected_reads import key
        key(repo)  # Validate encryption before accepting any paid provider work.
    engine=Engine(repo,config.scope,template_mode=True,selector_policy=lambda:config.read().get('selector_prompt'),report_archive=archive,answer_settings=answer_settings,read_surface=reads,table_capabilities=(lambda:config.read().get('table_capabilities',{})) if 'table_capabilities' in d else None,dataset_capabilities=(lambda:config.read().get('dataset_capabilities',{})) if 'dataset_capabilities' in d else None)
    transport=HTTPTransport(directory,d['credential_bindings'],d['qualifications'],enabled=True,qualification_provider=lambda:config.read()['qualifications'],read_surface_policy=lambda:config.read().get('read_surface',{}))
    engine.program_answers=True
    stop=threading.Event()
    def execution_ready():
        if stop.is_set():raise Rejected('WORKER_STOPPING')
        config.ready()
    worker=Worker(engine,transport,execution_ready=execution_ready)
    program_worker=Worker(engine,transport,execution_ready=execution_ready)
    from runtime_port_service import attach as attach_port,close as close_port
    runtime_gateway=gateway=None
    thread=port_thread=program_thread=None
    legacy_identity=None
    def work(selected_worker,lane):
        while not stop.is_set():
            try:
                # Revoking execution authorization stops NEW provider calls.
                config.ready()
                selected_worker.step(lane=lane)
            except Exception:
                print('WORKER_NOT_READY',flush=True)
            stop.wait(1)
    def shutdown(signum,frame):
        stop.set()
        if gateway is not None:threading.Thread(target=gateway.shutdown,daemon=True).start()
        if runtime_gateway is not None and port_thread is not None and port_thread.is_alive():
            threading.Thread(target=runtime_gateway.shutdown,daemon=True).start()
    try:
        runtime_gateway=attach_port(engine,d,directory)
        socket_path=d['socket']
        Path(socket_path).parent.mkdir(parents=True,exist_ok=True)
        peer_uid=pwd.getpwnam(d['web_user']).pw_uid
        gateway=Gateway(socket_path,engine,peer_uid)
        info=Path(socket_path).lstat();legacy_identity=(info.st_dev,info.st_ino)
        thread=threading.Thread(target=work,args=(worker,'regular'),daemon=True);thread.start()
        program_thread=threading.Thread(target=work,args=(program_worker,'program'),daemon=True);program_thread.start()
        if runtime_gateway is not None:
            port_thread=threading.Thread(target=runtime_gateway.serve_forever,kwargs={'poll_interval':.25},daemon=True)
            port_thread.start()
        signal.signal(signal.SIGTERM,shutdown)
        signal.signal(signal.SIGINT,shutdown)
        gateway.serve_forever(poll_interval=.25)
    finally:
        stop.set()
        if thread is not None and thread.ident is not None:thread.join(timeout=transport.max_request_seconds+10)
        if program_thread is not None:program_thread.join(timeout=3)
        if gateway is not None:gateway.server_close()
        if runtime_gateway is not None:
            if port_thread is not None and port_thread.is_alive():
                runtime_gateway.shutdown();port_thread.join(timeout=3)
            close_port(runtime_gateway)
        if legacy_identity is not None:
            try:
                info=Path(socket_path).lstat()
                if (info.st_dev,info.st_ino)==legacy_identity and stat.S_ISSOCK(info.st_mode):Path(socket_path).unlink()
            except FileNotFoundError:pass
    return 0

if __name__=='__main__':
    try:raise SystemExit(main())
    except Rejected as exc:raise SystemExit(exc.code)
