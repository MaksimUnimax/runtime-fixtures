"""Private non-root market service entrypoint. Disabled until independently qualified.
--check validates non-secret configuration only; it never reads a token or calls a provider.
"""
from __future__ import annotations
import argparse
import json
import os
import pwd
import signal
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
        for operation in ('ozon_orders','wb_orders'):
            proof=d['qualifications'].get(operation,{})
            if (proof.get('status') not in ('LIVE_LAB_VERIFIED','READ_ONLY_CANARY') or proof.get('registry_hash')!=REGISTRY_HASH
                or not proof.get('evidence_ref')):
                raise Rejected('DECODER_NOT_LIVE_QUALIFIED')
        return d

def main(argv=None):
    parser=argparse.ArgumentParser()
    parser.add_argument('--config',required=True)
    parser.add_argument('--check',action='store_true')
    args=parser.parse_args(argv)
    config=Configuration(args.config)
    d=config.read()
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
    engine=Engine(repo,config.scope)
    transport=HTTPTransport(directory,d['credential_bindings'],d['qualifications'],enabled=True)
    worker=Worker(engine,transport)
    socket_path=d['socket']
    Path(socket_path).parent.mkdir(parents=True,exist_ok=True)
    peer_uid=pwd.getpwnam(d['web_user']).pw_uid
    gateway=Gateway(socket_path,engine,peer_uid)
    stop=threading.Event()
    def work():
        while not stop.is_set():
            try:
                # Revoking execution authorization stops NEW provider calls.
                config.ready()
                worker.step()
            except Exception:
                print('WORKER_NOT_READY',flush=True)
            stop.wait(1)
    thread=threading.Thread(target=work,daemon=True);thread.start()
    def shutdown(signum,frame):
        stop.set()
        threading.Thread(target=gateway.shutdown,daemon=True).start()
    signal.signal(signal.SIGTERM,shutdown)
    signal.signal(signal.SIGINT,shutdown)
    try:
        gateway.serve_forever(poll_interval=.25)
    finally:
        stop.set();thread.join(timeout=30);gateway.server_close()
        try:Path(socket_path).unlink()
        except FileNotFoundError:pass
    return 0

if __name__=='__main__':
    try:raise SystemExit(main())
    except Rejected as exc:raise SystemExit(exc.code)
