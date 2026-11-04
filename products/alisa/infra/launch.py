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
if component in {'web','admin'}:
    if os.environ.get('ALISA_ENV') not in {'stage','prod'}:raise SystemExit('Missing environment')
    os.environ['HOSTNAME']='127.0.0.1'
    os.environ['PORT']='18100' if component=='web' else '18101'
    os.chdir(root/'ui'/component)
    os.execvp('node',['node',str(root/'ui'/component/'apps'/component/'server.js')])
elif component in {'platform','identity','worker','cleanup'}:
    service='platform' if component in {'worker','cleanup'} else component
    module='alisa_platform' if service=='platform' else 'octoport_identity'
    directory=root/'services'/service
    os.environ['PYTHONPATH']=str(directory/'src')
    os.environ['DJANGO_SETTINGS_MODULE']=module+'.config.settings'
    python=str(root/'.venv/bin/python')
    if component in {'worker','cleanup'}:os.execv(python,[python,str(directory/'manage.py'),'foundation_worker' if component=='worker' else 'foundation_cleanup'])
    else:os.execv(python,[python,'-m','gunicorn',module+'.config.wsgi:application','--bind','127.0.0.1:'+('18102' if service=='platform' else '18103'),'--workers','1','--timeout','20','--access-logfile','-','--error-logfile','-'])
else:raise SystemExit('Unknown component')
