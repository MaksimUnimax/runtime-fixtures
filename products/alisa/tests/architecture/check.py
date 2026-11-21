"""Reject imports of a sibling product, direct DB access in UI and external executors."""
import ast
import re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
PROHIBITED=('alice-lab','alice_lab','runtime-fixtures','runtime_fixtures','business-bridge','business_bridge','packages/server','apps/portal','apps/api','/opt/alice-market','/root/octoport-')

def violations(root=ROOT):
    errors=[]
    for directory in ['apps','services','packages']:
        for p in (root/directory).rglob('*'):
            if not p.is_file() or p.suffix not in {'.py','.ts','.tsx','.js','.mjs'}:continue
            if any(x in p.parts for x in ['node_modules','.next','__pycache__']):continue
            text=p.read_text()
            if any(x in text.lower() for x in PROHIBITED):errors.append(str(p.relative_to(root))+': forbidden product dependency')
            if directory in ['apps','packages'] and re.search(r'(psycopg|prisma|drizzle|DATABASE_URL|ALISA_DB_|pg\.Pool)',text):errors.append(str(p.relative_to(root))+': browser/BFF DB dependency')
            if directory=='services' and p.suffix=='.py':
                tree=ast.parse(text)
                for node in ast.walk(tree):
                    if isinstance(node,(ast.Import,ast.ImportFrom)):
                        modules=[a.name for a in node.names] if isinstance(node,ast.Import) else [node.module or '']
                        if any(x.startswith(('sqlite3','requests','httpx','urllib.request','subprocess')) for x in modules):errors.append(str(p.relative_to(root))+': forbidden executor/import')
                if 'services/platform' in str(p) and 'octoport_identity' in text:errors.append(str(p.relative_to(root))+': cross-authority import')
                if 'services/identity' in str(p) and 'alisa_platform' in text:errors.append(str(p.relative_to(root))+': cross-authority import')
    return errors

if __name__=='__main__':
    errors=violations()
    if errors: raise SystemExit('\n'.join(errors))
    print('ARCHITECTURE_BOUNDARY_PASS')
