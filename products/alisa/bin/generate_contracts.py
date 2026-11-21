#!/usr/bin/env python3
"""Generate a DTO from the bounded foundation JSON schema; validation stays server-side."""
import argparse
import json
from pathlib import Path

root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
schema=json.loads((root/'contracts/foundation-probe-v1.json').read_text())
fields=[]
for name,field in schema['properties'].items():
    if 'const' in field:type_name=json.dumps(field['const'])
    elif field.get('type')=='string':type_name='string'
    else:raise SystemExit('Unsupported DTO field type')
    fields.append(f'  {name}: {type_name};')
generated='// Generated from contracts/foundation-probe-v1.json. Do not edit.\nexport type FoundationProbeInput = {\n'+'\n'.join(fields)+'\n};\n'
target=root/'packages/contracts/index.ts'
if args.check:
    if not target.exists() or target.read_text()!=generated:raise SystemExit('CONTRACT_DTO_DRIFT')
else:target.write_text(generated)
