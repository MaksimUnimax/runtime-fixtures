"""Versioned catalog modules and durable assignments in the existing native DB.

Only admitted local Python is compiled; release content is bounded JSON. Each
snapshot has its own module globals. No global catalog swap, listener or worker
is created. Existing execution guards and source checks remain authoritative.
"""
import ast
from collections import OrderedDict
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import threading
from types import ModuleType,SimpleNamespace
from uuid import UUID
from .rules import (ReleaseFailure,canonical,digest,exact,hash_value,materialize,need,
                    package,text)

MAX_PACKAGES=100


def code_seal(root):
 root=Path(root).resolve();files={}
 for path in sorted(root.rglob('*')):
  if not path.is_file()or path.suffix not in {'.py','.json','.mjs','.gz'}:continue
  if path.name in {'manifest.json','CURRENT_CORE_MANIFEST.json','BASE_INSTALLED_MANIFEST.json',
                   'SOURCE_SNAPSHOT.json','config.json','config.example.json'}:continue
  name=str(path.relative_to(root))
  if any(part.startswith('.')or part in {'__pycache__','tests','test'}for part in Path(name).parts):continue
  need(not path.is_symlink(),'CATALOG_ENGINE_SOURCE_CHANGED')
  hashed=hashlib.sha256()
  with path.open('rb')as stream:
   for block in iter(lambda:stream.read(1024*1024),b''):hashed.update(block)
  files[name]=hashed.hexdigest()
 need({'engine.py','template_catalog.py','template_runtime.py','catalog_release/native.py',
       'catalog_release/rules.py'}<=set(files),
      'CATALOG_ENGINE_SOURCE_MISSING')
 return digest(files)


class CatalogImports(ast.NodeTransformer):
 def visit_ImportFrom(self,node):
  if node.module!='template_catalog':return node
  need(node.level==0 and all(a.name!='*'for a in node.names),'CATALOG_ENGINE_SOURCE_CHANGED')
  return [ast.copy_location(ast.Assign(
   targets=[ast.Name(id=a.asname or a.name,ctx=ast.Store())],
   value=ast.Attribute(value=ast.Name(id='__catalog_module',ctx=ast.Load()),attr=a.name,ctx=ast.Load())),node)
   for a in node.names]


class CatalogInput(ast.NodeTransformer):
 def __init__(self):self.replaced=0
 def visit_Assign(self,node):
  if len(node.targets)==1 and isinstance(node.targets[0],ast.Name)and node.targets[0].id=='CATALOG':
   need(self.replaced==0,'CATALOG_ENGINE_SOURCE_CHANGED');self.replaced+=1
   node.value=ast.Name(id='__catalog_value',ctx=ast.Load())
  return node


class PinAdmission(ast.NodeTransformer):
 def __init__(self):self.replaced=0
 def visit_FunctionDef(self,node):
  if node.name!='submit':return node
  out=[]
  for statement in node.body:
   out.append(statement)
   if isinstance(statement,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='plan'for t in statement.targets):
    self.replaced+=1
    out.extend(ast.parse("plan['catalog_package_sha256']=__package_sha256\nplan['catalog_engine_sha256']=__engine_sha256").body)
  node.body=out;return node


def module(name,path,tree,namespace):
 result=ModuleType(name);result.__file__=str(path);result.__dict__.update(namespace)
 exec(compile(ast.fix_missing_locations(tree),str(path),'exec'),result.__dict__)
 return result


class SnapshotFactory:
 def __init__(self,root):
  import template_catalog,template_runtime
  from . import rules
  self.root=Path(root).resolve();self.engine_sha256=code_seal(self.root)
  need(Path(__file__).resolve()==self.root/'catalog_release/native.py'and
       Path(rules.__file__).resolve()==self.root/'catalog_release/rules.py',
       'CATALOG_ENGINE_MODULE_MISMATCH')
  need(Path(template_catalog.__file__).resolve()==self.root/'template_catalog.py'and
       Path(template_runtime.__file__).resolve()==self.root/'template_runtime.py',
       'CATALOG_ENGINE_MODULE_MISMATCH')
  need(template_catalog.CATALOG==json.loads((self.root/'template_catalog.json').read_text()),
       'CATALOG_ENGINE_DATA_MISMATCH')
  self.base_catalog=deepcopy(template_catalog.CATALOG);self.base_hash=template_catalog.HASH
  self.gap_type=template_catalog.TemplateGap
  self.runtime_source=(self.root/'template_runtime.py').read_text()
  self.catalog_source=(self.root/'template_catalog.py').read_text()
  # Capture originals before installing routing functions into the base module.
  original={n:getattr(template_runtime,n)for n in ('authorized','submit','gap_result',
   'worker_step','_gap','_compile_and_save_selection')}
  self.base=SimpleNamespace(package_sha256='',template_hash=self.base_hash,
   catalog=template_catalog,runtime=SimpleNamespace(**original),evidence={})

 def build(self,payload):
  need(code_seal(self.root)==self.engine_sha256,'CATALOG_ENGINE_SOURCE_CHANGED')
  value,evidence=materialize(payload,self.base_catalog,engine_sha256=self.engine_sha256,
                           base_template_hash=self.base_hash)
  package_hash=digest(payload)
  tree=ast.parse(self.catalog_source);change=CatalogInput();tree=change.visit(tree)
  need(change.replaced==1,'CATALOG_ENGINE_SOURCE_CHANGED')
  catalog=module('_catalog_'+package_hash,self.root/'template_catalog.py',tree,{'__catalog_value':value})
  # Shared error identity also covers installed clarification/parameter overlays.
  catalog.TemplateGap=self.gap_type
  tree=CatalogImports().visit(ast.parse(self.runtime_source));change=PinAdmission();tree=change.visit(tree)
  need(change.replaced==1,'CATALOG_ENGINE_SOURCE_CHANGED')
  runtime=module('_catalog_runtime_'+package_hash,self.root/'template_runtime.py',tree,
   {'__catalog_module':catalog,'__package_sha256':package_hash,'__engine_sha256':self.engine_sha256})
  return SimpleNamespace(package_sha256=package_hash,template_hash=catalog.HASH,
   catalog=catalog,runtime=runtime,evidence=evidence)


class ReleaseRegistry:
 def __init__(self,repo,factory,verify_control):
  need(callable(verify_control),'CATALOG_CONTROL_VERIFIER_REQUIRED')
  self.repo,self.factory,self.verify_control=repo,factory,verify_control
  self.cache=OrderedDict();self.lock=threading.RLock()
  with repo.connection(True)as c:
   for statement in [
    'CREATE TABLE IF NOT EXISTS catalog_packages(package_sha256 TEXT PRIMARY KEY,'
    'template_hash TEXT NOT NULL,engine_sha256 TEXT NOT NULL,payload TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS catalog_assignments(tenant TEXT PRIMARY KEY,revision INTEGER NOT NULL,'
    'package_sha256 TEXT NOT NULL,request_id TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS catalog_commands(request_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL)']:
    c.execute(statement)

 def validate(self,payload):
  value=package(payload);snapshot=self.factory.build(value)
  return {'package_sha256':snapshot.package_sha256,'template_hash':snapshot.template_hash,
   'engine_sha256':self.factory.engine_sha256,'base_template_hash':self.factory.base_hash,
   'evidence':deepcopy(snapshot.evidence)}

 def snapshot(self,package_hash):
  if package_hash=='':return self.factory.base
  hash_value(package_hash)
  with self.lock:
   if package_hash in self.cache:
    value=self.cache.pop(package_hash);self.cache[package_hash]=value;return value
   with self.repo.connection()as c:row=c.execute('SELECT * FROM catalog_packages WHERE package_sha256=?',(package_hash,)).fetchone()
   need(row is not None,'CATALOG_PACKAGE_NOT_INSTALLED')
   value=json.loads(row['payload']);need(digest(value)==package_hash,'CATALOG_PACKAGE_HASH_MISMATCH')
   need(row['engine_sha256']==self.factory.engine_sha256,'CATALOG_ENGINE_MISMATCH')
   snapshot=self.factory.build(value);need(snapshot.template_hash==row['template_hash'],'CATALOG_PACKAGE_HASH_MISMATCH')
   self.cache[package_hash]=snapshot
   while len(self.cache)>4:self.cache.popitem(last=False)
   return snapshot

 def for_plan(self,plan):
  if 'catalog_package_sha256'not in plan:
   need(plan.get('template_execution',{}).get('catalog_hash')==self.factory.base_hash,
        'CATALOG_UNPINNED_PLAN')
   return self.factory.base
  need(plan.get('catalog_engine_sha256')==self.factory.engine_sha256,'CATALOG_ENGINE_MISMATCH')
  value=self.snapshot(plan['catalog_package_sha256'])
  need(plan.get('template_execution',{}).get('catalog_hash')==value.template_hash,'CATALOG_PACKAGE_HASH_MISMATCH')
  return value

 def for_tenant(self,tenant):
  with self.repo.connection()as c:row=c.execute('SELECT package_sha256 FROM catalog_assignments WHERE tenant=?',(tenant,)).fetchone()
  return self.snapshot(row['package_sha256']if row else'')

 def readback(self,tenant):
  with self.repo.connection()as c:row=c.execute('SELECT * FROM catalog_assignments WHERE tenant=?',(tenant,)).fetchone()
  value=self.snapshot(row['package_sha256']if row else'')
  return {'assignment_revision':row['revision']if row else 0,
   'package_sha256':value.package_sha256,'template_hash':value.template_hash,
   'engine_sha256':self.factory.engine_sha256,'last_request_id':row['request_id']if row else None}

 def control_readback(self,ticket):
  proof=self.control_proof(ticket)
  return self.readback(proof['runtime_tenant'])

 def control_proof(self,ticket):
  need(type(ticket)is str and 1<=len(ticket)<=4096,'CATALOG_CONTROL_DENIED')
  proof=self.verify_control(ticket)
  exact(proof,{'request_id','runtime_tenant','expected_revision','revision','package_sha256','engine_sha256','template_hash'})
  need(proof['engine_sha256']==self.factory.engine_sha256,'CATALOG_ENGINE_MISMATCH')
  hash_value(proof['template_hash'])
  return proof

 def apply(self,command,ticket):
  proof=self.control_proof(ticket)
  exact(command,{'request_id','package'});need(type(command['request_id'])is str)
  try:identifier=str(UUID(command['request_id']))
  except (ValueError,TypeError,AttributeError):raise ReleaseFailure('CATALOG_PACKAGE_INVALID')from None
  need(identifier==command['request_id'])
  need(proof['request_id']==identifier and proof['engine_sha256']==self.factory.engine_sha256,
       'CATALOG_CONTROL_DENIED')
  need(type(proof['runtime_tenant'])is str and 0<len(proof['runtime_tenant'])<=256 and
       all(ord(c)>=32 and ord(c)!=127 for c in proof['runtime_tenant']))
  need(type(proof['expected_revision'])is int and 0<=proof['expected_revision']<2147483647 and
       type(proof['revision'])is int and proof['revision']==proof['expected_revision']+1)
  snapshot=self.factory.base if command['package']is None else self.factory.build(package(command['package']))
  need(snapshot.package_sha256==proof['package_sha256'],'CATALOG_PACKAGE_HASH_MISMATCH')
  need(snapshot.template_hash==proof['template_hash'],'CATALOG_VALIDATION_HASH_MISMATCH')
  mark=digest({'command':command,'proof':proof})
  with self.lock,self.repo.connection(True)as c:
   old=c.execute('SELECT * FROM catalog_commands WHERE request_id=?',(identifier,)).fetchone()
   if old:
    need(old['fingerprint']==mark,'CATALOG_IDEMPOTENCY_CONFLICT')
    return json.loads(old['receipt'])
   current=c.execute('SELECT revision FROM catalog_assignments WHERE tenant=?',(proof['runtime_tenant'],)).fetchone()
   need((current['revision']if current else 0)==proof['expected_revision'],'CATALOG_ASSIGNMENT_CONFLICT')
   if snapshot.package_sha256:
    row=c.execute('SELECT payload,template_hash FROM catalog_packages WHERE package_sha256=?',(snapshot.package_sha256,)).fetchone()
    if row:need(row['payload']==canonical(command['package']).decode()and row['template_hash']==snapshot.template_hash,
                'CATALOG_PACKAGE_HASH_MISMATCH')
    else:
     need(c.execute('SELECT COUNT(*) FROM catalog_packages').fetchone()[0]<MAX_PACKAGES,'CATALOG_PACKAGE_CAPACITY')
     c.execute('INSERT INTO catalog_packages VALUES(?,?,?,?)',(snapshot.package_sha256,snapshot.template_hash,
       self.factory.engine_sha256,canonical(command['package']).decode()))
   c.execute('INSERT INTO catalog_assignments VALUES(?,?,?,?) ON CONFLICT(tenant) DO UPDATE SET '
    'revision=excluded.revision,package_sha256=excluded.package_sha256,request_id=excluded.request_id',
    (proof['runtime_tenant'],proof['revision'],snapshot.package_sha256,identifier))
   receipt={'assignment_revision':proof['revision'],'package_sha256':snapshot.package_sha256,
    'template_hash':snapshot.template_hash,'engine_sha256':self.factory.engine_sha256,'last_request_id':identifier}
   c.execute('INSERT INTO catalog_commands VALUES(?,?,?)',(identifier,mark,canonical(receipt).decode()))
  return receipt


def route(registry):
 """Route by admitted plan first; assignment is consulted only on new submit."""
 import template_runtime
 from semantics import Rejected,strict_json
 def call(name,snapshot,args,kwargs):
  try:return getattr(snapshot.runtime,name)(*args,**kwargs)
  except ReleaseFailure as error:raise Rejected(error.code)from None
 def authorized(engine,plan):
  try:return call('authorized',registry.for_plan(plan),(engine,plan),{})
  except ReleaseFailure:return False
 def submit(engine,tenant,*args,**kwargs):
  try:return call('submit',registry.for_tenant(tenant),(engine,tenant,*args),kwargs)
  except ReleaseFailure as error:raise Rejected(error.code)from None
 def on_plan(name):
  def wrapped(worker,row,plan,*args,**kwargs):
   try:return call(name,registry.for_plan(plan),(worker,row,plan,*args),kwargs)
   except ReleaseFailure as error:raise Rejected(error.code)from None
  return wrapped
 def gap_result(engine,row):
  if not row.get('plan'):return None
  try:return call('gap_result',registry.for_plan(strict_json(row['plan'])),(engine,row),{})
  except ReleaseFailure as error:raise Rejected(error.code)from None
 template_runtime.authorized=authorized;template_runtime.submit=submit;template_runtime.gap_result=gap_result
 for name in ['worker_step','_gap','_compile_and_save_selection']:
  setattr(template_runtime,name,on_plan(name))
