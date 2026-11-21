"""Executable ADR-005 gate. Deliberately fails on source-specific decoder branches.

This audit covers the generic source/workflow/transport/registry modules and row
bridge. Legacy public decoder names are thin compatibility facades, not new
source logic. Natural-language and projection policies remain a separate scope.
"""
import ast
import hashlib
import json
from pathlib import Path
GENERIC_MODULES=('matrix_core.py','matrix_sources.py','scalar_runtime.py','registry.py','qualification_scope.py','report_contracts.py','failure_explanations.py','dataset_relations.py')
ROW_BRIDGES=('table_analytics.py','http_transport.py','engine.py')


def code_hashes(root):
    return {str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(root.rglob('*.py')) if '__pycache__' not in p.parts}


def audit_source(text, forbidden_literals):
    tree=ast.parse(text)
    found=[]
    for node in ast.walk(tree):
        if isinstance(node,ast.Constant) and isinstance(node.value,str) and node.value in forbidden_literals:
            found.append({'line':node.lineno,'reason':'source-specific literal','value':node.value})
        if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id in ('eval','exec','__import__'):
            found.append({'line':node.lineno,'reason':'executable configuration'})
    return found


def audit(root):
    data=json.loads((root/'source_matrix.json').read_text())
    scalar=json.loads((root/'scalar_source_catalog.json').read_text())
    datasets=json.loads((root/'dataset_sources.json').read_text()) if (root/'dataset_sources.json').exists() else {'sources':{},'origins':{}}
    specs={**data['sources'],**scalar['sources'],**datasets['sources']}
    ops=set(specs);platforms=set(data['origins'])|set(scalar['origins'])|set(datasets['origins'])
    endpoints={s['url'] for s in specs.values()}
    failures={}
    for name in GENERIC_MODULES+(('dataset_pipeline.py',) if (root/'dataset_pipeline.py').exists() else ()):
        result=audit_source((root/name).read_text(),ops|platforms|endpoints)
        if result:failures[name]=result
    for name in ROW_BRIDGES:
        result=audit_source((root/name).read_text(),ops|endpoints)
        if result:failures[name]=result
    return failures

if __name__=='__main__':
    root=Path(__file__).parent;failures=audit(root)
    print(json.dumps({'gate':'M01','status':'FAIL' if failures else 'PASS','failures':failures,
        'scope':'generic row/scalar source engine, workflow, registry and HTTP; voice policies and model envelope separately scoped'}))
    raise SystemExit(bool(failures))
