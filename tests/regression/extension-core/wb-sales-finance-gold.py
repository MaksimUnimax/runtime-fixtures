"""Independent offline gold: Python Decimal/zoneinfo, no JS output as input."""
import sys,json,datetime
from decimal import Decimal
from zoneinfo import ZoneInfo
from pathlib import Path
fixture=json.loads(Path(sys.argv[1]).read_text())
scope=fixture['scope']; zone=ZoneInfo(scope['businessPeriod']['timezone'])
start=datetime.datetime.fromisoformat(scope['businessPeriod']['fromInclusive'])
end=datetime.datetime.fromisoformat(scope['businessPeriod']['toExclusive'])
def instant(value):
 d=datetime.datetime.fromisoformat(value.replace('Z','+00:00'))
 return d if d.tzinfo else d.replace(tzinfo=zone)
rows={side:{} for side in ('sales','finance')}
for page in fixture['pages']:
 if page['response']['rawText']=='':
  assert page['stream']=='finance' and page['response']['httpStatus']==204
  continue
 for row in json.loads(page['response']['rawText'],parse_float=Decimal,parse_int=int):
  key=str(row['saleID'] if page['stream']=='sales' else row['rrdId'])
  if key in rows[page['stream']]:assert row==rows[page['stream']][key]
  rows[page['stream']][key]=row
sales,finance=rows['sales'],rows['finance']
assert len(sales)==5 and len(finance)==5
# Separate handwritten business oracle: source-signed sums, no invented return sign.
manual=[
 {'reportId':'901','currency':'KZT','operation':'Продажа','document':'Продажа','inBusinessEventPeriod':True,'rows':1,'retailAmountSourceSignedSum':'100.10','forPaySourceSignedSum':'70.05','rrdIds':['101']},
 {'reportId':'901','currency':'KZT','operation':'Возврат','document':'Возврат','inBusinessEventPeriod':True,'rows':1,'retailAmountSourceSignedSum':'100.10','forPaySourceSignedSum':'70.05','rrdIds':['102']},
 {'reportId':'901','currency':'KZT','operation':'Продажа','document':'Продажа','inBusinessEventPeriod':False,'rows':1,'retailAmountSourceSignedSum':'220.25','forPaySourceSignedSum':'160.50','rrdIds':['103']},
 {'reportId':'902','currency':'RUB','operation':'Продажа','document':'Продажа','inBusinessEventPeriod':True,'rows':2,'retailAmountSourceSignedSum':'77.70','forPaySourceSignedSum':'55.50','rrdIds':['104','105']}
]
for item in manual:
 selected=[finance[k] for k in item['rrdIds']]
 assert all(str(r['reportId'])==item['reportId'] and r['currency']==item['currency'] and r['sellerOperName']==item['operation'] and r['docTypeName']==item['document'] and (start<=instant(r['saleDt'])<end)==item['inBusinessEventPeriod'] for r in selected)
 for field,out in [('retailAmount','retailAmountSourceSignedSum'),('forPay','forPaySourceSignedSum')]:
  assert format(sum(Decimal(r[field]) for r in selected),'.2f')==item[out]
# Independent arithmetic checks: duplicate103 counted once; zero104 counted once.
assert Decimal(finance['101']['retailAmount'])+Decimal(finance['102']['retailAmount'])+Decimal(finance['103']['retailAmount'])==Decimal('420.45')
assert Decimal(finance['101']['forPay'])+Decimal(finance['102']['forPay'])+Decimal(finance['103']['forPay'])==Decimal('300.60')
assert Decimal(finance['104']['retailAmount'])+Decimal(finance['105']['retailAmount'])==Decimal('77.70')
assert Decimal(finance['104']['forPay'])+Decimal(finance['105']['forPay'])==Decimal('55.50')
expected_pairs=[['S-CAP19-1001','101'],['R-CAP19-1001','102'],['S-CAP19-1002','103'],['S-CAP19-1003','104']]
for sale,fin in expected_pairs:
 a,b=sales[sale],finance[fin]
 assert a['nmId']==b['nmId'] and a['srid']==b['srid'] and instant(a['date'])==instant(b['saleDt'])
assert 'srid' not in sales['S-CAP19-1004'] and 'forPay' not in sales['S-CAP19-1004']
assert sales['S-CAP19-1003']['forPay']==Decimal(0)
assert not start<=instant(sales['S-CAP19-1002']['date'])<end
assert start<=instant(sales['S-CAP19-1002']['lastChangeDate'])<end
out={'method':'Independent Python Decimal + explicit manual four-group arithmetic and semantic oracle; no JS output consumed',
 'financeTotals':manual,'pairs':expected_pairs,'unmatchedSales':['S-CAP19-1004'],'unmatchedFinance':['105'],
 'financeReportSourceSignedSubtotals':{'KZT':{'retailAmount':'420.45','forPay':'300.60'},'RUB':{'retailAmount':'77.70','forPay':'55.50'}},
 'eventPeriodSales':['S-CAP19-1001','R-CAP19-1001','S-CAP19-1003','S-CAP19-1004'],
 'outsideEventPeriodSales':['S-CAP19-1002'],'operationalCurrency':None,'FX':None,'netRevenue':None,'businessCoverageProved':False}
Path(sys.argv[2]).write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print('Independent numeric/semantic gold written; 4 groups / 4 pairs / 2 unmatched events.')
