#!/usr/bin/env python3
"""Process entry point. Systemd injects only the component's private environment."""
import json
import os
from pathlib import Path
import sys

root=Path(__file__).resolve().parents[1]
component=sys.argv[1]
release=json.loads((root/'manifest.json').read_text())['artifact_id']
os.environ['ALISA_RELEASE']=release
os.environ['PYTHONDONTWRITEBYTECODE']='1'
if component in {'web','admin'}:
    if os.environ.get('ALISA_ENV') not in {'stage','prod'}:raise SystemExit('Missing environment')
    if not os.environ.get('ALISA_PLATFORM_URL'):raise SystemExit('Missing ALISA_PLATFORM_URL')
    if component == 'web':
        token=os.environ.get('ALISA_SERVICE_TOKEN','')
        if len(token)<32 or token.startswith('REPLACE_'):raise SystemExit('Missing ALISA_SERVICE_TOKEN')
        if os.environ.get('ALISA_ENV')=='stage' and os.environ.get('FOUNDATION_PROBE_ENABLED')=='1':
            basic=os.environ.get('ALISA_ENGINEERING_AUTH','')
            if len(basic)<24 or basic.startswith('REPLACE_'):raise SystemExit('Missing ALISA_ENGINEERING_AUTH')
            if not os.environ.get('ALISA_WEB_ORIGIN'):raise SystemExit('Missing ALISA_WEB_ORIGIN')
    os.environ['HOSTNAME']='127.0.0.1'
    os.environ['PORT']='18100' if component=='web' else '18101'
    os.chdir(root/'ui'/component)
    os.execvp('node',['node',str(root/'ui'/component/'apps'/component/'server.js')])
elif component in {'platform','identity','worker','cleanup','lead-mail','identity-mail'}:
    service='identity' if component in {'identity','identity-mail'} else 'platform'
    module='alisa_platform' if service=='platform' else 'octoport_identity'
    directory=root/'services'/service
    os.environ['PYTHONPATH']=str(directory/'src')
    os.environ['DJANGO_SETTINGS_MODULE']=module+'.config.settings'
    python=str(root/'.venv/bin/python')
    if component in {'worker','cleanup','lead-mail','identity-mail'}:os.execv(python,[python,str(directory/'manage.py'),{'worker':'foundation_worker','cleanup':'foundation_cleanup','lead-mail':'leads_deliver','identity-mail':'identity_deliver'}[component]])
    else:os.execv(python,[python,'-m','gunicorn',module+'.config.wsgi:application','--bind','127.0.0.1:'+('18102' if service=='platform' else '18103'),'--workers','1','--timeout','20','--access-logfile','-','--access-logformat','%(m)s %(U)s %(s)s','--error-logfile','-'])
else:raise SystemExit('Unknown component')
