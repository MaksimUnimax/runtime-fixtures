#!/usr/bin/env python3
"""One finite delivery batch on the existing retention service; no new daemon."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import pwd
import subprocess
import sys

def deliver(store,authority):
    from query_gap_outbox import pending,acknowledge
    packet,marks=store.pending()if hasattr(store,'pending')else pending(store)
    result=authority.publish_query_gaps(packet)
    expected=[row['event_id']for row in packet['events']]
    if type(result)is not dict or set(result)!={'accepted','stream_id'}or result['accepted']!=expected or result['stream_id']!=packet['coverage']['stream_id']:
        raise ValueError('INVALID_ACKNOWLEDGEMENT')
    if hasattr(store,'acknowledge'):store.acknowledge(marks)
    else:acknowledge(store,marks)
    return {'event':'query_gaps_publish','status':'ACKNOWLEDGED','events':len(marks)}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--database',type=Path,default=Path('/var/lib/alice-market/template-gaps.sqlite3'))
    parser.add_argument('--state-database',type=Path,default=Path('/var/lib/alice-market/state.sqlite3'))
    parser.add_argument('--config',type=Path,default=Path('/etc/alice-market/market-runtime.json'));args=parser.parse_args()
    try:
        if os.geteuid()==0:raise ValueError('SERVICE_IDENTITY_REQUIRED')
        # The same root-owned admission check used by the existing startup hook.
        spec=importlib.util.spec_from_file_location('admission',Path(__file__).with_name('runtime_versions_sync.py'))
        admission=importlib.util.module_from_spec(spec);spec.loader.exec_module(admission)
        source=Path(subprocess.run(['/usr/bin/systemctl','show','alice-market.service','--value','-p','WorkingDirectory'],
            check=True,capture_output=True,text=True,timeout=3).stdout.strip())
        admission.validate_release(source)
        raw,_=admission.read_file(args.config,admission.MAX_FILE);config=admission.decode(raw)
        sys.path.insert(0,str(source))
        from runtime_port_service import validate,private_credential
        from platform_authority_client import PlatformAuthorityClient
        from template_gaps import GapStore
        port=validate(config)
        if port is None:print(json.dumps({'event':'query_gaps_publish','status':'DISABLED'}));return 0
        directory=Path(os.environ.get('CREDENTIALS_DIRECTORY','/nonexistent'))
        credential=directory/port['authority_credential']
        if not private_credential(credential):raise ValueError('CREDENTIAL_UNAVAILABLE')
        authority=PlatformAuthorityClient(port['authority_socket'],expected_uid=pwd.getpwnam(port['authority_user']).pw_uid,
            service_token=credential.read_text().strip(),service_id=port['service_id'])
        store=GapStore(args.database);store.state_path=args.state_database
        from query_gap_terminal import TerminalStore
        terminal=TerminalStore(args.state_database,store.key,source.name,cases=store);terminal.initialize()
        # Each finite batch has independent commit/ack; a retry cannot duplicate it.
        count=0;failed=False
        for stream in (store,terminal):
            try:count+=deliver(stream,authority)['events']
            except Exception:failed=True
        print(json.dumps({'event':'query_gaps_publish','status':'DEFERRED'if failed else'ACKNOWLEDGED','events':count}));return 1 if failed else 0
    except Exception:
        # Never print a packet, exception, original question, path or credential.
        print(json.dumps({'event':'query_gaps_publish','status':'DEFERRED'}));return 1

if __name__=='__main__':raise SystemExit(main())
