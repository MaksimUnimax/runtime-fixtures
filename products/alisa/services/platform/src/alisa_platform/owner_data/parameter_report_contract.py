"""Registered arithmetic for a limited economic projection, not net profit."""
from copy import deepcopy
from decimal import Decimal,localcontext
from pathlib import Path
import json,hashlib
from . import parameter_contract as c,parameter_dependencies as dependencies
CATALOG=json.loads(Path(__file__).with_name('parameter_report_catalog.json').read_text())
HASH=hashlib.sha256(c.CANON(CATALOG).encode()).hexdigest()


def definition(tid):
 c.need(type(tid)is str and tid in CATALOG['reports'],'PARAMETER_REPORT_UNKNOWN')
 result=deepcopy(CATALOG['reports'][tid]);dependencies.profile(result['profile']);return result


def normalized_input(value):
 c.need(type(value)is dict and set(value)<={'period','comparison','filters','group_by','parameter_periods'},'PARAMETER_REPORT_INPUT')
 c.dates(value.get('period'));c.need(value.get('comparison')is None and type(value.get('filters',{}))is dict and not value.get('filters',{})and value.get('group_by','marketplace')=='marketplace','PARAMETER_REPORT_SCOPE_UNSUPPORTED')
 periods=value.get('parameter_periods',{});c.need(type(periods)is dict,'PARAMETER_REPORT_INPUT')
 return {'period':deepcopy(value['period']),'parameter_periods':deepcopy(periods)}


def evaluate(tid,inputs,parameters):
 rule=definition(tid);c.need(type(inputs)is dict and set(inputs)==set(rule['metrics']),'PARAMETER_REPORT_SOURCE')
 bindings=dependencies.profile(rule['profile'])['bindings']
 c.need(type(parameters)is dict and set(parameters)=={b['slot']for b in bindings},'PARAMETER_DEPENDENCIES_PENDING')
 for binding in bindings:
  parameter=c.definition(binding['parameter']);c.validate_value(parameter,parameters[binding['slot']],parameter['unit'])
 def expr(tree):
  c.need(type(tree)is dict and len(tree)==1,'PARAMETER_REPORT_FORMULA');op,args=next(iter(tree.items()))
  if op=='input':c.need(args in inputs,'PARAMETER_REPORT_SOURCE');return c.number(inputs[args])
  if op=='parameter':c.need(args in parameters,'PARAMETER_DEPENDENCIES_PENDING');return c.number(parameters[args])
  if op=='constant':return c.number(args)
  c.need(op in('multiply','subtract','add')and type(args)is list and len(args)==2,'PARAMETER_REPORT_FORMULA')
  a,b=map(expr,args);return a*b if op=='multiply'else a-b if op=='subtract'else a+b
 with localcontext()as ctx:
  ctx.prec=60
  for value in inputs.values():c.need(c.number(value)>=0 and c.number(value)==c.number(value).to_integral(),'PARAMETER_REPORT_SOURCE')
  return {name:{'value':c.decimal_text(expr(info['formula'])),'unit':info['unit'],'estimated':True}for name,info in rule['outputs'].items()}
