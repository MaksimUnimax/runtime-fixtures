from pathlib import Path
import os,subprocess
base=Path('/opt/alice-market/releases/alisa-runtime-429-wait-r2-20261108');new=Path('/opt/alice-market/releases/alisa-runtime-429-wait-r3-20261108')
assert not new.exists();subprocess.run(['cp','-al',str(base),str(new)],check=True)
p=new/'universal_reads.py';s=p.read_text()
anchor="def identifier_provenance(params,question,calls):"
helper='''def single_ordered_units_report(plan, progress, stamp):
    """Render one verified daily scalar when the planner's finish label is invalid.

    The value comes only from Ozon's received totals; never guess a missing value.
    """
    calls=progress.get('calls',[])
    if len(calls)!=1:return None
    call=calls[0];params=call.get('params',{})
    if call.get('operation')!='analytics_data' or call.get('store_id') not in {s['id'] for s in plan['stores']}:return None
    if params.get('metrics')!=['ordered_units'] or params.get('dimension')!=['day'] or params.get('date_from')!=params.get('date_to') or params.get('date_from')!=plan['calendar_date']:return None
    body=call.get('data',{}).get('result',{})
    if type(body)is not dict or type(body.get('totals'))is not list or len(body['totals'])!=1 or type(body['totals'][0])is not int:return None
    rows=body.get('data')
    if type(rows)is not list or len(rows)!=1 or type(rows[0])is not dict or rows[0].get('metrics')!=body['totals']:return None
    decision={'action':'finish','coverage':'complete','facts':[{'label':'Заказанные единицы за сегодня',
              'expr':{'$path':['calls',0,'data','result','totals',0]}}]}
    return result(plan,{'calls':calls,'decision':decision},stamp)


'''
assert s.count(anchor)==1;s=s.replace(anchor,helper+anchor)
anchor2="""        if exc.code in ('SOURCE_ACCESS','ACCESS','SENSITIVE_INPUT'):raise
        progress['feedback']={'code':exc.code,'rejected_action':decision.get('action'),'received_keys':sorted(decision)[:12],'expected_discovery_keys':['action','platform','cluster','query','offset'],'provider_request_executed':False}"""
replacement="""        if exc.code in ('SOURCE_ACCESS','ACCESS','SENSITIVE_INPUT'):raise
        if exc.code=='READ_FACT_SCHEMA' and decision.get('action')=='finish':
            stamp=datetime.fromtimestamp(worker.repo.clock(),timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
            fallback=single_ordered_units_report(plan,progress,stamp)
            if fallback is not None:
                need(worker.engine.authorized(plan),'SOURCE_ACCESS')
                worker.repo.complete(row['id'],row['owner'],fallback);return
        progress['feedback']={'code':exc.code,'rejected_action':decision.get('action'),'received_keys':sorted(decision)[:12],
            'expected_finish_fact':{'label':'Краткое название без цифр','expr':{'$path':['calls',0,'data','result']}},
            'expected_discovery_keys':['action','platform','cluster','query','offset'],'provider_request_executed':False}"""
assert s.count(anchor2)==1;s=s.replace(anchor2,replacement)
t=p.with_suffix('.py.new');t.write_text(s);os.chmod(t,p.stat().st_mode);os.replace(t,p)
(new/'tests/test_single_metric_fallback.py').write_text('''import unittest
from universal_reads import single_ordered_units_report
class Fallback(unittest.TestCase):
 def test_exact_received_daily_total(self):
  plan={'stores':[{'id':'owner-ozon'}],'calendar_date':'2026-11-08','question':'сколько заказано сегодня'}
  call={'store_id':'owner-ozon','operation':'analytics_data','params':{'metrics':['ordered_units'],'dimension':['day'],'date_from':'2026-11-08','date_to':'2026-11-08'},'data':{'result':{'totals':[17],'data':[{'metrics':[17]}]}}}
  r=single_ordered_units_report(plan,{'calls':[call]},'2026-11-08 10:00 UTC')
  self.assertIn('17',r['pages'][0]);self.assertTrue(r['complete'])
  call['data']['result']['totals']=[18]
  self.assertIsNone(single_ordered_units_report(plan,{'calls':[call]},'2026-11-08 10:00 UTC'))
if __name__=='__main__':unittest.main()
''')
print('PATCHED',new)