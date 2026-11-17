"""Canonical data-only package rules; copied unchanged into the native overlay.

The first release classes are aliases and compositions of existing templates.
New financial expressions, providers and operators need their own qualified core
change. These packages never contain Python, SQL, URLs, credentials or prompts.
"""
from copy import deepcopy
import hashlib
import json
import re
import unicodedata

SCHEMA='alisa-catalog-package/v1'
LIMIT=24576
MAX_ADDITIONS=20
ID=re.compile(r'[A-Za-z][A-Za-z0-9_.-]{0,119}')
HEX=re.compile(r'[0-9a-f]{64}')
FIELDS={'schema','engine_sha256','base_template_hash','additions'}


class ReleaseFailure(Exception):
 def __init__(self,code):self.code=code;super().__init__(code)


def need(value,code='CATALOG_PACKAGE_INVALID'):
 if not value:raise ReleaseFailure(code)


def canonical(value):
 try:return json.dumps(value,ensure_ascii=False,allow_nan=False,sort_keys=True,separators=(',',':')).encode()
 except (ValueError,TypeError,OverflowError,RecursionError):raise ReleaseFailure('CATALOG_PACKAGE_INVALID')from None


def digest(value):return hashlib.sha256(canonical(value)).hexdigest()


def exact(value,keys):need(type(value)is dict and set(value)==set(keys))


def text(value,limit):
 need(type(value)is str and 0<len(value)<=limit and value==value.strip()and
      all(unicodedata.category(c)[0]!='C'for c in value))
 need(not re.search(r'(https?://|sk-[\w-]{12,}|eyJ[\w-]{25,}\.|api.?key|authorization|bearer|парол|токен|секрет)',value,re.I),
      'CATALOG_SENSITIVE_CONTENT')
 return value


def identifier(value):
 need(type(value)is str and ID.fullmatch(value)is not None)
 return value


def hash_value(value):
 need(type(value)is str and HEX.fullmatch(value)is not None)
 return value


def normalize(value):
 return ' '.join(re.sub(r'[^\w]+',' ',unicodedata.normalize('NFKC',value).casefold().replace('ё','е')).split())


def package(value):
 exact(value,FIELDS);need(value['schema']==SCHEMA)
 hash_value(value['engine_sha256']);hash_value(value['base_template_hash'])
 rows=value['additions'];need(type(rows)is list and 1<=len(rows)<=MAX_ADDITIONS)
 seen=set()
 for row in rows:
  need(type(row)is dict and type(row.get('kind'))is str and
       row['kind']in {'ALIAS','COMPOSE_EXISTING'},'CATALOG_CORE_CHANGE_REQUIRED')
  exact(row,{'kind','id','purpose','template_ids','answer_spec'})
  identifier(row['id']);need(row['id']not in seen,'CATALOG_ID_COLLISION');seen.add(row['id'])
  text(row['purpose'],800)
  ids=row['template_ids'];need(type(ids)is list and 1<=len(ids)<=10)
  need(all(identifier(x)for x in ids)and len(set(ids))==len(ids))
  need(row['kind']!='ALIAS'or len(ids)==1)
  # Human semantic review is explicit and hash bound; model output is not proof.
  spec=row['answer_spec'];exact(spec,{'meaning','known_negatives'})
  text(spec['meaning'],1200);need(type(spec['known_negatives'])is list and 1<=len(spec['known_negatives'])<=10)
  for item in spec['known_negatives']:text(item,300)
 need(len(canonical(value))<=LIMIT,'CATALOG_PACKAGE_TOO_LARGE')
 return deepcopy(value)


def materialize(value,base,*,engine_sha256,base_template_hash):
 value=package(value)
 need(value['engine_sha256']==engine_sha256,'CATALOG_ENGINE_MISMATCH')
 need(value['base_template_hash']==base_template_hash,'CATALOG_BASE_MISMATCH')
 need(type(base)is dict and type(base.get('templates'))is dict,'CATALOG_BASE_INVALID')
 result=deepcopy(base);templates=result['templates'];original=set(templates)
 purposes={normalize(t['purpose'])for t in templates.values()}
 inherited=[]
 for row in value['additions']:
  tid=row['id'];need(tid not in templates,'CATALOG_ID_COLLISION')
  phrase=normalize(row['purpose']);need(phrase and phrase not in purposes,'CATALOG_SEMANTIC_COLLISION')
  # References are restricted to the admitted base, not unchecked additions.
  need(set(row['template_ids'])<=original,'CATALOG_SOURCE_UNQUALIFIED')
  sources=[templates[x]for x in row['template_ids']]
  need(all(t['kind']not in {'parameter','information'}for t in sources),'CATALOG_CORE_CHANGE_REQUIRED')
  first=sources[0]
  if row['kind']=='ALIAS':
   template=deepcopy(first);template.update(id=tid,version=1,purpose=row['purpose'])
   if first['kind']=='formula':
    template={'id':tid,'version':1,'kind':'compound','purpose':row['purpose'],
     'platforms':deepcopy(first['platforms']),'input_policy':deepcopy(first['input_policy']),
     'metrics':deepcopy(first['metrics']),'steps':[{'id':'part_1','template':first['id']}]}
  else:
   # One input contract and platform intersection: combining different date
   # axes or inclusion/exclusion semantics requires a separate qualification.
   need(all(t['input_policy']==first['input_policy']for t in sources),'CATALOG_INPUT_CONTRACT_MISMATCH')
   platforms=set(first['platforms'])
   for t in sources[1:]:platforms.intersection_update(t['platforms'])
   need(platforms,'CATALOG_PLATFORM_MISMATCH')
   template={'id':tid,'version':1,'kind':'compound','purpose':row['purpose'],
    'platforms':sorted(platforms),'input_policy':deepcopy(first['input_policy']),
    'metrics':sorted({m for t in sources for m in t['metrics']}),
    'steps':[{'id':'part_'+str(i+1),'template':key}for i,key in enumerate(row['template_ids'])]}
  templates[tid]=template;purposes.add(phrase)
  inherited.append({'template_id':tid,'base_template_ids':row['template_ids'],
   'binding_sha256':[digest(templates[x])for x in row['template_ids']],
   'qualification':'INHERITED_IDENTICAL_BINDINGS','level':'BASE_QUALIFICATION_ONLY'})
 return result,{'package_sha256':digest(value),'engine_sha256':engine_sha256,
  'base_template_hash':base_template_hash,'inherited':inherited,
  'new_provider_calls':False,'new_numeric_or_source_qualification':False}
