"""Add isolated economics leaf without duplicating raw model-input snapshots."""
from pathlib import Path
from hashlib import sha256
import shutil,json

def prepare(target,platform):
 target=Path(target).resolve();platform=Path(platform).resolve()
 if '/opt/'in str(target)or not target.is_dir():raise RuntimeError('ISOLATED_CANDIDATE_REQUIRED')
 engine=target/'engine.py'
 if sha256(engine.read_bytes()).hexdigest()!='24b06ced72c2bd1f05c2cad03e093431c100f38665a1887d08221bc95a6c9ab0':raise RuntimeError('PERIOD_SOURCE_WORKER_BASELINE_CHANGED')
 text=engine.read_text()
 before="def _call(self,row,request,store=None,*,on_rejection=None,on_received=None,before_dispatch=None):"
 after="def _call(self,row,request,store=None,*,on_rejection=None,on_received=None,before_dispatch=None,capture_answer_data=True):"
 condition="if store is not None and not request.operation.startswith('read.') and not meta.get('authentication_only'):"
 if text.count(before)!=1 or text.count(condition)!=1:raise RuntimeError('PERIOD_SOURCE_WORKER_BASELINE_CHANGED')
 text=text.replace(before,after).replace(condition,"if capture_answer_data and "+condition[3:])
 engine.write_text(text)
 root=Path(__file__).resolve().parent
 shutil.copy2(root/'period_cost_source_runtime.py',target/'period_cost_source_runtime.py')
 for name in ('economics_periods.py','economics_period_catalog.json'):shutil.copy2(platform/name,target/'parameter_support'/name)
 return {name:sha256((target/name).read_bytes()).hexdigest()for name in ('engine.py','period_cost_source_runtime.py','parameter_support/economics_periods.py','parameter_support/economics_period_catalog.json')}
