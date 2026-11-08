"""Reviewed external matrix; unknown endpoints, formulas and unsafe rates fail closed."""
import hashlib,json
from pathlib import Path
import re

def _data(path):
 def pairs(items):
  out={}
  for k,v in items:
   if k in out:raise ValueError('duplicate registry key')
   out[k]=v
  return out
 return json.loads(Path(path).read_text(encoding='utf-8'),object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(ValueError('nonfinite')))

def load_registry(path):
 def pairs(items):
  d={}
  for k,v in items:
   if k in d:raise ValueError('duplicate registry key')
   d[k]=v
  return d
 r=json.loads(Path(path).read_text(encoding='utf-8'),object_pairs_hook=pairs)
 source_doc=_data(Path(__file__).with_name('scalar_source_catalog.json'))
 catalog=_data(Path(__file__).with_name('scalar_catalog.json'))
 recipes=catalog['recipes'];sources=source_doc['sources'];platforms=set(source_doc['origins'])
 if (not isinstance(r,dict) or not isinstance(r.get('version'),str)
   or not isinstance(r.get('metric_definitions'),dict) or not 1<=len(r['metric_definitions'])<=512
   or set(r.get('recipes',{}))!=set(recipes)
   or r.get('cache_policy')!='exact_ready_complete_authorized_nonexpired_only'
   or r.get('default_timezone')!='Europe/Moscow'):raise ValueError('registry schema')
 for key,recipe in recipes.items():
  row=r['recipes'][key];spec=sources[recipe['operation']]
  if (row.get('operation')!=recipe['operation'] or row.get('url')!=spec['url'] or row.get('method')!=spec['method']
      or type(row.get('min_interval'))is not int or row['min_interval']<spec['interval']
      or type(row.get('daily_limit'))is not int or not 1<=row['daily_limit']<=spec['daily_limit']):raise ValueError('unreviewed recipe or unsafe rate')
  if 'max_days' in row and (type(row['max_days'])is not int or not 1<=row['max_days']<=recipe['max_days']):raise ValueError('unsafe period cap')
 definitions=r['metric_definitions']
 for name,d in definitions.items():
  if not isinstance(name,str) or not re.fullmatch(r'[a-z][a-z0-9_]{0,79}',name) or not isinstance(d,dict):raise ValueError('metric id')
  if not isinstance(d.get('label'),str) or not 0<len(d['label'])<=160 or not isinstance(d.get('unit'),str):raise ValueError('metric definition')
  if 'notes' in d and (not isinstance(d['notes'],list) or len(d['notes'])>8 or any(not isinstance(x,str) or not 0<len(x)<=500 or any(ord(c)<32 for c in x) for x in d['notes'])):raise ValueError('metric notes')
  if not isinstance(d.get('platforms'),list) or not d['platforms'] or not set(d['platforms'])<=platforms:raise ValueError('metric platform')
  if 'formula' in d:
   if d['formula'] not in {'ratio','ratio_percent','per_calendar_day'} or not d.get('dependencies'):raise ValueError('formula')
   if not set(d['dependencies'])<=set(definitions):raise ValueError('dependencies')
  else:
   for platform in d['platforms']:
    matches=[q for q in recipes.values() if q['platform']==platform and q['family']==d.get('source') and name in q['fields']]
    if len(matches)!=1:raise ValueError('metric source route')
 def visit(n,stack):
  if n in stack:raise ValueError('dependency cycle')
  for child in definitions[n].get('dependencies',[]):visit(child,stack|{n})
 for n in definitions:visit(n,set())
 encoded=json.dumps({'registry':r,'scalar_catalog':catalog,'sources':source_doc},ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
 return r,hashlib.sha256(encoded).hexdigest()
REGISTRY,REGISTRY_HASH=load_registry(Path(__file__).with_name('registry.json'))
DEFINITIONS=REGISTRY['metric_definitions']
def base_metrics(metrics):
 out=set()
 def walk(n):
  if n not in DEFINITIONS:raise ValueError('unknown metric')
  d=DEFINITIONS[n]
  if 'dependencies' in d:
   for child in d['dependencies']:walk(child)
  else:out.add(n)
 for n in metrics:walk(n)
 return sorted(out)
