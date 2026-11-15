"""Assemble the full report in an isolated source qualification fixture.

The runtime and platform feature gates remain disabled by default. This builder
does not change any installed release or production configuration.
"""
from pathlib import Path
from hashlib import sha256
import shutil

LEAVES=('tariff_source_runtime.py','order_source_runtime.py',
        'other_source_runtime.py','economics_report_runtime.py')
SUPPORT=('economics_tariffs.py','economics_tariff_catalog.json',
         'economics_orders.py','economics_order_catalog.json',
         'economics_other.py','economics_other_catalog.json')

def change(path,old,new):
    text=path.read_text()
    if text.count(old)!=1:raise RuntimeError('COMPOSITE_TRANSITION_BASELINE_REQUIRED:'+path.name)
    path.write_text(text.replace(old,new))

def prepare(target,platform):
    target=Path(target).resolve();platform=Path(platform).resolve()
    if '/opt/'in str(target)or not target.is_dir():raise RuntimeError('ISOLATED_CANDIDATE_REQUIRED')
    for name in ('engine.py','read_surface.py','period_cost_source_runtime.py','parameter_report_runtime.py'):
        if not(target/name).is_file():raise RuntimeError('COMPOSITE_SOURCE_BASELINE_REQUIRED')
    root=Path(__file__).resolve().parent
    for name in LEAVES:shutil.copy2(root/name,target/name)
    for name in SUPPORT:shutil.copy2(platform/name,target/'parameter_support'/name)
    runtime=target/'runtime.py';text=runtime.read_text()
    previous="    engine.parameter_compound_policy=lambda:config.read().get('parameter_compounds')"
    if text.count(previous)!=1:raise RuntimeError('COMPOSITE_RUNTIME_BASELINE_REQUIRED')
    runtime.write_text(text.replace(previous,previous+"\n    engine.economics_composite_policy=lambda:config.read().get('economics_composites')"))
    # The existing final-answer transition deliberately discards ordinary source
    # progress. Carry only this report's encrypted source cache atomically into
    # that same transition; it never enters API_DATA or the pending result.
    change(target/'repository.py',
        '    def stage_answer(self, jid, owner, result, progress=None):',
        '    def stage_answer(self, jid, owner, result, progress=None, *, economics_sources=None):')
    change(target/'repository.py',
        '            self.reschedule(jid, owner, {API_DATA: data, PENDING: pending})',
        "            staged = {API_DATA: data, PENDING: pending}\n"
        "            if economics_sources is not None:\n"
        "                if type(economics_sources) is not dict:raise Rejected('ECONOMICS_COMPOSITE_STATE')\n"
        "                staged['_economics_sources'] = economics_sources\n"
        "            self.reschedule(jid, owner, staged)")
    before="        worker.repo.stage_answer(row['id'],row['owner'],{'data':result_data,'fetched_at':datetime.fromtimestamp(worker.repo.clock(),timezone.utc).strftime('%Y-%m-%d %H:%M UTC')})"
    after="        source_args = {'economics_sources':progress['_economics_sources']}if '_economics_sources'in progress else{}\n"+before[:-1]+",**source_args)"
    change(target/'template_runtime.py',before,after)
    paths=['runtime.py','repository.py','template_runtime.py',*LEAVES,*('parameter_support/'+name for name in SUPPORT)]
    return {name:sha256((target/name).read_bytes()).hexdigest()for name in paths}
