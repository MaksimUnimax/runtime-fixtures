#!/usr/bin/env python3
"""Generate a DTO from the bounded foundation JSON schema; validation stays server-side."""
import argparse
import json
from pathlib import Path

root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
generated=''
for filename,type_name in [('foundation-probe-v1.json','FoundationProbeInput'),('lead-intake-v1.json','LeadIntakeInput'),('lead-confirm-v1.json','LeadConfirmInput')]:
    schema=json.loads((root/'contracts'/filename).read_text());fields=[]
    for name,field in schema['properties'].items():
        if 'const' in field:kind=json.dumps(field['const'])
        elif field.get('type')=='string':kind='string'
        elif field.get('type')=='boolean':kind='boolean'
        elif field.get('type')=='object':kind='Record<string, unknown>'
        else:raise SystemExit('Unsupported DTO field type')
        optional='' if name in schema.get('required',[]) else '?'
        fields.append(f'  {name}{optional}: {kind};')
    generated+='// Generated from contracts/'+filename+'. Do not edit.\nexport type '+type_name+' = {\n'+'\n'.join(fields)+'\n};\n'
target=root/'packages/contracts/index.ts'
if args.check:
    if not target.exists() or target.read_text()!=generated:raise SystemExit('CONTRACT_DTO_DRIFT')
else:target.write_text(generated)
