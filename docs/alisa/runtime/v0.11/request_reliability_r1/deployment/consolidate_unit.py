"""Offline consolidation; preserves every non-release directive in order."""
import json,hashlib
from pathlib import Path
root=Path(__file__).parent
files=json.loads((root/'systemd-baseline.json').read_text())
lines=[];preserved=[];section=None
for path,content in files.items():
    lines.append('# Observed: '+path)
    for line in content.splitlines():
        if line.startswith('['):section=line;lines.append(line)
        elif '='in line and not line.lstrip().startswith(('#',';')):
            key=line.split('=',1)[0]
            if key not in ('ExecStart','WorkingDirectory'):
                lines.append(line);preserved.append((section,line))
lines+=['[Service]','WorkingDirectory=/opt/alice-market/releases/current','ExecStart=',
        'ExecStart=/usr/bin/python3 -B /opt/alice-market/releases/current/runtime.py --config /etc/alice-market/market-runtime.json']
(root/'alice-market.service').write_text('\n'.join(lines)+'\n')
# Exact ordered non-release assignments (including additive/reset semantics).
observed=[];section=None
for line in lines:
    if line.startswith('['):section=line
    elif '='in line and not line.startswith('#') and line.split('=',1)[0]not in ('ExecStart','WorkingDirectory'):observed.append((section,line))
assert observed==preserved
(root/'service-preservation.json').write_text(json.dumps({'source_files':{p:hashlib.sha256(v.encode()).hexdigest()for p,v in files.items()},'non_release_directives_preserved':True,'count':len(preserved),'installed':False},indent=2)+'\n')
print('preserved',len(preserved),'non-release assignments from',len(files),'source files')
