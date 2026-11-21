"""Legacy decoder names kept for compatibility only.
All source schemas and workflow rules are delegated to the generic ScalarMatrix;
new sources do not add functions here. Numeric helpers remain public utilities.
"""
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
import re
from semantics import Rejected

CURRENCIES={'RUB','BYN','KZT','AMD','KGS','UZS','CNY','USD','EUR'}
from scalar_runtime import MATRIX
WB_FIELDS=MATRIX.recipe('wb_finance')['fields']

def numeric(value,integer=False,signed=False):
    if isinstance(value,bool) or not isinstance(value,(str,int,float,Decimal)):raise Rejected('NUMBER_TYPE')
    try:v=Decimal(str(value))
    except InvalidOperation:raise Rejected('NUMBER_FORMAT') from None
    if not v.is_finite() or abs(v)>Decimal('1e18') or (not signed and v<0) or (integer and v!=v.to_integral_value()):raise Rejected('NUMBER_RANGE')
    return v

def currency(value,expected):
    if value not in CURRENCIES:raise Rejected('FINANCE_CURRENCY')
    if expected is not None and expected!=value:raise Rejected('FINANCE_CURRENCY_CHANGED')
    return value

def result(values,rows,cur,complete=True,progress=None):
    return {'values':{k:format(v,'f') for k,v in values.items()},'rows':rows,
            'currency':cur,'complete':complete,'progress':progress}

def _decode(name,data,task,store=None,progress=None):
    import providers
    r=MATRIX.recipe(name)
    store=store or {'platform':r['platform'],'currency':None,'id':'compat','identity':'compat'}
    plan={'period':task['period'],'filters':{}};task={**task,'recipe':name}
    progress=MATRIX.compatibility_progress(plan,store,task,progress)
    return providers._legacy_decode_task(data,plan,store,task,progress)

def decode_ozon_finance(data,task,store):return _decode('ozon_finance',data,task,store)
def decode_wb_finance(data,task,store,progress=None):return _decode('wb_finance',data,task,store,progress)
def decode_balance(data,task,store):return _decode('wb_balance',data,task,store)
def decode_ozon_stocks(data,task,progress=None):return _decode('ozon_stocks',data,task,progress=progress)
def decode_wb_stocks(data,task,progress=None):return _decode('wb_stocks',data,task,progress=progress)
def decode(data,plan,store,task,progress=None):return _decode(task['recipe'],data,task,store,progress)
def validate_task_id(value):
    from matrix_core import uuid_text,MatrixError
    try:return uuid_text(value)
    except MatrixError:raise Rejected('PROVIDER_TASK_ID') from None
