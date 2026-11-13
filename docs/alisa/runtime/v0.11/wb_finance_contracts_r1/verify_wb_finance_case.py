"""Read archived WB daily financial fields; update only acceptance evidence."""
from pathlib import Path
from decimal import Decimal
from datetime import date,timedelta
import sys,json,sqlite3
ROOT=Path('/root/alice-lab-evidence/answer-model-20261109')
sys.path[:0]=['/opt/alice-market/releases/current',str(ROOT)]
from archive_inputs import values
case,field=sys.argv[1:3];p=ROOT/(case.upper().replace('-','')+'_PRIVATE_20261113.json');d=json.loads(p.read_text())
assert d.get('stage')=='FINISHED'and d.get('job_state')=='READY'
pages=[];seen=set()
for item in values(d['job_id']):
 if item['operation']!='wb_finance'or item['content_sha256']in seen:continue
 seen.add(item['content_sha256']);assert type(item['data'])is list;pages.append(item['data'])
assert len(pages)==1 and len(pages[0])<1000
rows=pages[0];assert len({r['reportId']for r in rows})==len(rows)
with sqlite3.connect('file:/var/lib/alice-market/state.sqlite3?mode=ro',uri=True)as c:
 plan=json.loads(c.execute('SELECT plan FROM jobs WHERE id=?',(d['job_id'],)).fetchone()[0])
periods=[i['input']['period']for i in plan['selection']['invocations']];assert len(periods)==1
start,end=(date.fromisoformat(periods[0][key])for key in ('from','to'))
assert 0<=(end-start).days<366
covered=set();amounts=[]
for row in rows:
 assert row['currency']=='RUB'
 assert row['dateFrom']==row['dateTo']
 day=date.fromisoformat(row['dateFrom']);assert day.isoformat()==row['dateFrom']and start<=day<=end
 covered.add(day)
 amount=Decimal(str(row[field]));assert amount.is_finite();amounts.append(amount)
assert covered=={start+timedelta(days=i)for i in range((end-start).days+1)},'FINANCIAL_REPORT_NOT_READY'
expected=sum(amounts,Decimal(0))
check={'field':field,'expected_total':str(expected),'report_rows':len(rows),'single_page':True,'full_period_coverage':True,'currency':'RUB','periods':periods,'selected_template_ids':d['template_ids']}
d['data_check']=check;p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'case':case,'answer':d['answer'],'seconds':d['job_seconds'],'deepseek_calls':d['deepseek_attempts'],'rub':d['known_rub'],'check':check},ensure_ascii=False))
