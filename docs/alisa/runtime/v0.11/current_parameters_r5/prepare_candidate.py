"""Exact R4 -> R5 patch in an isolated runtime copy only."""
from pathlib import Path
import json,hashlib,shutil,sys
ROOT=Path(__file__).resolve().parent

def change(p,old,new):
 s=p.read_text();assert s.count(old)==1,(p.name,old[:100]);p.write_text(s.replace(old,new))

def prepare(target):
 target=target.resolve();assert target.is_dir()and target!=Path('/')and target!=Path('/opt')and '/opt/'not in str(target)
 for n,h in json.loads((ROOT/'BASELINE_RUNTIME.json').read_text())['files'].items():assert hashlib.sha256((target/n).read_bytes()).hexdigest()==h,('BASELINE_CHANGED',n)
 shutil.copy2(ROOT/'parameter_collection_runtime.py',target/'parameter_collection_runtime.py')
 p=target/'platform_authority_client.py'
 with p.open('a')as f:f.write("\n    def parameter_collection(self,payload):\n        return self._call('parameter_collection',payload)\n")
 p=target/'runtime_port.py'
 change(p,"        engine.execution_policy=self\n","        engine.execution_policy=self\n        from parameter_collection_runtime import attach\n        attach(self)\n")
 change(p,"'replay_retention_seconds':retention.REPLAY_TTL,'read_recomputes':False}","'replay_retention_seconds':retention.REPLAY_TTL,'read_recomputes':False,\n                'parameter_collection':__import__('parameter_collection_runtime').capability(self.engine)}")
 change(p,"        digest=fingerprint({'query':query,'logical_query_id':logical_id,'guard':guard})\n","        digest_payload={'query':query,'logical_query_id':logical_id,'guard':guard}\n        from parameter_collection_runtime import mark\n        if mark()is not None:digest_payload['parameter_admission']=mark()\n        digest=fingerprint(digest_payload)\n")
 with p.open('a')as f:f.write("\n    def parameter_submit(self,task,peer):\n        from parameter_collection_runtime import submit\n        return submit(self,task,peer)\n")
 p=target/'runtime_port_ipc.py'
 change(p,"    if op=='submit':return port.submit(payload,peer)\n","    if op=='submit':return port.submit(payload,peer)\n    if op=='parameter_submit':return port.parameter_submit(payload,peer)\n")
 p=target/'template_runtime.py'
 change(p,"        fragments=plan.get('fragments',[])\n","        from parameter_collection_runtime import authorized as admitted_parameter_current\n        if not admitted_parameter_current(engine,plan):return False\n        fragments=plan.get('fragments',[])\n")
 change(p,"    engine.pin_execution(plan,execution_context);engine.pin_execution(draft,execution_context)\n","    engine.pin_execution(plan,execution_context);engine.pin_execution(draft,execution_context)\n    from parameter_collection_runtime import pin\n    pin(plan)\n")
 change(p,"        if state=='select':\n","        if state=='select':\n            if plan.get('parameter_admission')is not None:\n                from parameter_collection_runtime import decision\n                _compile_and_save_selection(worker,row,plan,progress,decision(plan));return\n")
 p=target/'parameter_source_runtime.py'
 change(p,'    try:return fn(*args)\n    except Rejected:raise','    from repository import Deferred\n    try:return fn(*args)\n    except Deferred:raise\n    except Rejected:raise')
 old="    as_of=datetime.fromtimestamp(engine.repo.clock(),timezone.utc).isoformat()\n    admission=None\n    if draft['parameter_mode']!='preview':"
 new="    as_of=datetime.fromtimestamp(engine.repo.clock(),timezone.utc).isoformat()\n    approved=root.get('parameter_admission')\n    if approved is not None:\n        need(approved['key']==template['parameter_key']and approved['target']==target and draft['parameter_period']['actual']==approved['period']['actual'],'PARAMETER_INTENT_MISMATCH')\n        draft=deepcopy(draft);draft['parameter_period']=deepcopy(approved['period'])\n    admission=None\n    if draft['parameter_mode']!='preview'or approved is not None:"
 change(p,old,new)
 change(p,"            if p['intent']is not None:\n                binder=worker.engine.parameter_intent_authority", "            if p['intent']is not None and p['intent']['mode']!='preview':\n                binder=worker.engine.parameter_intent_authority")
 return True

if __name__=='__main__':prepare(Path(sys.argv[1]));print('R5_NATIVE_CANDIDATE_READY')
