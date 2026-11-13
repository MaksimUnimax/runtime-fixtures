"""Independently total archived API fields for a live acceptance case; no requests."""
from pathlib import Path
from decimal import Decimal,ROUND_HALF_UP
import json,sys,sqlite3
ROOT=Path('/root/alice-lab-evidence/answer-model-20261109')
sys.path[:0]=['/opt/alice-market/releases/current',str(ROOT)]
from archive_inputs import values
case=sys.argv[1];metric=sys.argv[2]
p=ROOT/(case.upper().replace('-','')+'_PRIVATE_20261113.json')
d=json.loads(p.read_text());assert d.get('stage')=='FINISHED'and d.get('job_state')=='READY'
pages=[];seen=set()
for item in values(d['job_id']):
 if item['operation']!='ozon_accrual_by_day':continue
 digest=item['content_sha256']
 if digest in seen:continue
 seen.add(digest);pages.append(item['data'])
assert pages and pages[-1]['last_id']==''
rows=[row for page in pages for row in page['accruals']]
assert len({row['accrual_id']for row in rows})==len(rows)
with sqlite3.connect('file:/var/lib/alice-market/state.sqlite3?mode=ro',uri=True)as c:
 plan=json.loads(c.execute('SELECT plan FROM jobs WHERE id=?',(d['job_id'],)).fetchone()[0])
periods=[i['input']['period']for i in plan['selection']['invocations']]
assert len(periods)==1 and periods[0]['from']==periods[0]['to']
assert all(row['date']==periods[0]['from']for row in rows)
totals={k:Decimal(0)for k in ('positive_units','reversal_units','positive_buyer','reversal_buyer','positive_seller','reversal_seller')}
for row in rows:
 if row.get('posting')is None:continue
 for product in row['posting']['products']:
  commission=product.get('commission')
  if commission is None:continue
  quantity=Decimal(str(product['quantity']));assert quantity>0 and quantity==quantity.to_integral_value()
  seller=Decimal(commission['sale_amount']['amount']);buyer=Decimal(commission['sale_price']['amount'])
  assert seller!=0
  for field in ('sale_amount','sale_price','seller_price','bonus','coinvestment'):assert commission[field]['currency']=='RUB'
  assert Decimal(commission['seller_price']['amount'])*quantity==seller
  assert buyer+Decimal(commission['bonus']['amount'])+Decimal(commission['coinvestment']['amount'])==seller
  side='positive'if seller>0 else'reversal';sign=Decimal(1)if seller>0 else Decimal(-1)
  totals[side+'_units']+=quantity;totals[side+'_buyer']+=sign*buyer;totals[side+'_seller']+=sign*seller
mapping={'accrual_sale_units':'positive_units','accrual_reversal_units':'reversal_units','accrual_sale_amount':'positive_buyer','accrual_reversal_amount':'reversal_buyer','accrual_seller_amount':'positive_seller','accrual_reversal_seller_amount':'reversal_seller'}
if metric=='accrual_average_buyer_price':
 expected=(totals['positive_buyer']/totals['positive_units']).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)if totals['positive_units']else None
else:expected=totals[mapping[metric]]
check={'requested_metric':metric,'expected_total':str(expected)if expected is not None else None,'totals':{k:str(v)for k,v in totals.items()},'accrual_rows':len(rows),'pages':len(pages),'last_cursor_empty':True,'periods':periods,'selected_template_ids':d['template_ids']}
d['data_check']=check;p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'case':case,'answer':d['answer'],'seconds':d['job_seconds'],'deepseek_calls':d['deepseek_attempts'],'rub':d['known_rub'],'check':check},ensure_ascii=False))
