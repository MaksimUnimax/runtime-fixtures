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
import sys
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
                   'SOURCE_SNAPSHOT.json','config.json','config.example.json',
                   'base_qualification.json','base_qualification_report.json'}:continue
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
  import template_catalog,template_runtime,question_catalog_extension
  from . import rules
  self.root=Path(root).resolve();self.engine_sha256=code_seal(self.root)
  need(Path(__file__).resolve()==self.root/'catalog_release/native.py'and
       Path(rules.__file__).resolve()==self.root/'catalog_release/rules.py',
       'CATALOG_ENGINE_MODULE_MISMATCH')
  need(Path(template_catalog.__file__).resolve()==self.root/'template_catalog.py'and
       Path(template_runtime.__file__).resolve()==self.root/'template_runtime.py',
       'CATALOG_ENGINE_MODULE_MISMATCH')
  for name,loaded in tuple(sys.modules.items()):
   expected=self.root/(name.replace('.','/')+'.py')
   if expected.is_file():
    need(hasattr(loaded,'__file__')and Path(loaded.__file__).resolve()==expected.resolve(),
         'CATALOG_ENGINE_MODULE_MISMATCH')
  need(template_catalog.CATALOG==json.loads((self.root/'template_catalog.json').read_text()),
       'CATALOG_ENGINE_DATA_MISMATCH')
  self.base_catalog=deepcopy(template_catalog.CATALOG);self.base_hash=template_catalog.HASH
  self.gap_type=template_catalog.TemplateGap
  self.runtime_source=(self.root/'template_runtime.py').read_text()
  self.catalog_source=(self.root/'template_catalog.py').read_text()
  self.question_source=(self.root/'question_catalog_extension.py').read_text()
  self.speech_sha256=hashlib.sha256((self.root/'speech_catalog.json').read_bytes()).hexdigest()
  # Capture originals before installing routing functions into the base module.
  original={n:getattr(template_runtime,n)for n in ('authorized','submit','gap_result',
   'worker_step','_gap','_compile_and_save_selection')}
  self.base=SimpleNamespace(package_sha256='',template_hash=self.base_hash,
   catalog=template_catalog,runtime=SimpleNamespace(**original),
   question=SimpleNamespace(read=question_catalog_extension.read),evidence={})

 def qualification(self):
  receipt=self.root/'catalog_release/base_qualification.json'
  report=self.root/'catalog_release/base_qualification_report.json'
  need(receipt.is_file()and report.is_file()and not receipt.is_symlink()and not report.is_symlink(),
       'CATALOG_QUALIFICATION_MISSING')
  need(receipt.stat().st_size<=8192 and report.stat().st_size<=2*1024**2,'CATALOG_QUALIFICATION_INVALID')
  raw=receipt.read_bytes();value=json.loads(raw)
  exact(value,{'schema','engine_sha256','base_template_hash','proof_id','level','report_sha256',
               'scope','tests_run','failures','errors','status'})
  need(value['schema']=='alisa-catalog-base-qualification/v1'and value['status']=='PASS'and
       value['engine_sha256']==self.engine_sha256 and value['base_template_hash']==self.base_hash and
       value['level']=='INTEGRATION_FIXTURE'and value['scope']=='BYTE_IDENTICAL_BASE_BINDINGS'and
       type(value['tests_run'])is int and value['tests_run']>0 and
       type(value['failures'])is int and value['failures']==0 and
       type(value['errors'])is int and value['errors']==0,'CATALOG_QUALIFICATION_INVALID')
  text(value['proof_id'],128);hash_value(value['report_sha256'])
  hashed=hashlib.sha256()
  with report.open('rb')as stream:
   for block in iter(lambda:stream.read(1024*1024),b''):hashed.update(block)
  need(hashed.hexdigest()==value['report_sha256'],'CATALOG_QUALIFICATION_INVALID')
  return {'qualification_sha256':hashlib.sha256(raw).hexdigest(),
   'proof':{'proof_id':value['proof_id'],'level':value['level'],
    'artifact_sha256':value['report_sha256'],'scope':value['scope']}}

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
  question=module('_catalog_question_'+package_hash,self.root/'question_catalog_extension.py',
   CatalogImports().visit(ast.parse(self.question_source)),{'__catalog_module':catalog})
  return SimpleNamespace(package_sha256=package_hash,template_hash=catalog.HASH,
   catalog=catalog,runtime=runtime,question=question,evidence=evidence)


class ReleaseRegistry:
 def __init__(self,repo,factory,verify_control):
  need(callable(verify_control),'CATALOG_CONTROL_VERIFIER_REQUIRED')
  self.repo,self.factory,self.verify_control=repo,factory,verify_control
  self.admissions_enabled=True
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
  value=package(payload);snapshot=self.factory.build(value);qualification=self.factory.qualification()
  need(value['qualification_sha256']==qualification['qualification_sha256'],'CATALOG_QUALIFICATION_CHANGED')
  evidence=deepcopy(snapshot.evidence);evidence['qualification_sha256']=qualification['qualification_sha256']
  return {'package_sha256':snapshot.package_sha256,'template_hash':snapshot.template_hash,
   'engine_sha256':self.factory.engine_sha256,'base_template_hash':self.factory.base_hash,
   'speech_sha256':self.factory.speech_sha256,'evidence':evidence,'proof':qualification['proof']}

 def snapshot(self,package_hash):
  if package_hash=='':return self.factory.base
  hash_value(package_hash)
  with self.lock:
   if package_hash in self.cache:
    value=self.cache.pop(package_hash);self.cache[package_hash]=value;return value
  # Never hold the cache lock while entering SQLite. RuntimePort already holds
  # its admission write transaction before selecting the catalog.
  with self.repo.connection()as c:row=c.execute('SELECT * FROM catalog_packages WHERE package_sha256=?',(package_hash,)).fetchone()
  need(row is not None,'CATALOG_PACKAGE_NOT_INSTALLED')
  value=json.loads(row['payload']);need(digest(value)==package_hash,'CATALOG_PACKAGE_HASH_MISMATCH')
  need(row['engine_sha256']==self.factory.engine_sha256,'CATALOG_ENGINE_MISMATCH')
  snapshot=self.factory.build(value);need(snapshot.template_hash==row['template_hash'],'CATALOG_PACKAGE_HASH_MISMATCH')
  with self.lock:
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
  if not self.admissions_enabled:return self.factory.base
  with self.repo.connection()as c:row=c.execute('SELECT package_sha256 FROM catalog_assignments WHERE tenant=?',(tenant,)).fetchone()
  if row and row['package_sha256']:self.factory.qualification()
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
  exact(proof,{'request_id','runtime_tenant','expected_revision','revision','package_sha256','engine_sha256',
               'template_hash','qualification_sha256'})
  need(proof['engine_sha256']==self.factory.engine_sha256,'CATALOG_ENGINE_MISMATCH')
  hash_value(proof['template_hash'])
  qualification=self.factory.qualification()
  need(qualification['qualification_sha256']==proof['qualification_sha256'],'CATALOG_QUALIFICATION_CHANGED')
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
  if command['package']is not None:
   need(command['package']['qualification_sha256']==proof['qualification_sha256'],'CATALOG_QUALIFICATION_CHANGED')
  need(snapshot.package_sha256==proof['package_sha256'],'CATALOG_PACKAGE_HASH_MISMATCH')
  need(snapshot.template_hash==proof['template_hash'],'CATALOG_VALIDATION_HASH_MISMATCH')
  mark=digest({'command':command,'proof':proof})
  with self.repo.connection(True)as c:
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
 need(not hasattr(template_runtime,'_catalog_release_router'),'CATALOG_ALREADY_ATTACHED')
 template_runtime._catalog_release_router=registry
 def call(name,snapshot,args,kwargs):
  try:return getattr(snapshot.runtime,name)(*args,**kwargs)
  except ReleaseFailure as error:raise Rejected(error.code)from None
 def authorized(engine,plan):
  try:return call('authorized',registry.for_plan(plan),(engine,plan),{})
  except ReleaseFailure:return False
 def submit(engine,tenant,*args,**kwargs):
  try:
   # Assignment selection and durable admission share the repository's existing
   # thread-local transaction, also for the legacy voice entry point.
   with registry.repo.connection(True):
    return call('submit',registry.for_tenant(tenant),(engine,tenant,*args),kwargs)
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


def install(port,controls_enabled=True):
 """Explicit attachment after existing dispatch overlays; import is inert."""
 import runtime_port_ipc,question_catalog_extension
 from semantics import Rejected
 need(not hasattr(port,'catalog_release_registry'),'CATALOG_ALREADY_ATTACHED')
 need(port.engine.template_mode and callable(getattr(port.authority,'_call',None)),
      'CATALOG_CONTROL_VERIFIER_REQUIRED')
 root=Path(sys.modules['template_runtime'].__file__).resolve().parent
 factory=SnapshotFactory(root)
 def verify(ticket):return port.authority._call('catalog_control',{'ticket':ticket})
 registry=ReleaseRegistry(port.repo,factory,verify);port.catalog_release_registry=registry
 registry.admissions_enabled=controls_enabled
 route(registry)
 old_dispatch=runtime_port_ipc.dispatch
 def dispatch(actual,peer,value):
  operation=value.get('operation')if type(value)is dict else None
  if operation not in {'catalog_info','catalog_templates','catalog_validate','catalog_apply','catalog_readback'}:
   return old_dispatch(actual,peer,value)
  actual._peer(peer)
  if not controls_enabled:raise Rejected('CAPABILITY_UNAVAILABLE')
  try:
   exact(value,{'schema_version','operation','payload'})
   from runtime_port_contract import CONTRACT
   need(value['schema_version']==CONTRACT)
   body=value['payload']
   if operation=='catalog_info':
    exact(body,set());qualification=factory.qualification()
    return {'capability':'catalog_release_v1','engine_sha256':factory.engine_sha256,
     'base_template_hash':factory.base_hash,'speech_sha256':factory.speech_sha256,**qualification}
   if operation=='catalog_templates':
    exact(body,{'query','offset'})
    need(type(body['query'])is str and len(body['query'])<=200 and
         type(body['offset'])is int and 0<=body['offset']<=1000)
    rows=[t for t in factory.base.catalog.TEMPLATES.values()if t['kind']not in {'parameter','information'}and
     body['query'].casefold()in (t['id']+' '+t['purpose']).casefold()]
    need(len(rows)<=1000);rows.sort(key=lambda t:t['id']);end=body['offset']+20
    return {'items':[{k:deepcopy(t[k])for k in ['id','purpose','kind','platforms','input_policy']}
     for t in rows[body['offset']:end]],'next_offset':end if end<len(rows)else None}
   if operation=='catalog_validate':
    exact(body,{'package'})
    try:return {'valid':True,**registry.validate(body['package'])}
    except ReleaseFailure as error:return {'valid':False,'code':error.code}
   if operation=='catalog_readback':
    exact(body,{'ticket'});return registry.control_readback(body['ticket'])
   exact(body,{'request_id','package','ticket'})
   return registry.apply({'request_id':body['request_id'],'package':body['package']},body['ticket'])
  except ReleaseFailure as error:
   code=('PERMISSION_DENIED'if'DENIED'in error.code else
         'IDEMPOTENCY_CONFLICT'if'CONFLICT'in error.code else'CATALOG_INCOMPATIBLE')
   raise Rejected(code)from None
 def read(actual,peer,context=None,query=None):
  actual._peer(peer)
  try:
   snapshot=factory.base
   if context is not None:
    _,_,scope=actual._auth(context,peer,'capabilities');snapshot=registry.for_tenant(scope.tenant)
   return snapshot.question.read(actual,peer,context,query)
  except ReleaseFailure:raise Rejected('CATALOG_INCOMPATIBLE')from None
 runtime_port_ipc.dispatch=dispatch;question_catalog_extension.read=read
 return registry


def attach(port,enabled):
 """A disabled publication path still preserves already admitted old plans."""
 need(type(enabled)is bool,'CATALOG_CONFIG_INVALID')
 if not enabled:
  with port.repo.connection()as c:
   retained=c.execute("SELECT 1 FROM sqlite_master WHERE type='table'AND name='catalog_packages'").fetchone()
  if retained is None:return None
 return install(port,controls_enabled=enabled)
