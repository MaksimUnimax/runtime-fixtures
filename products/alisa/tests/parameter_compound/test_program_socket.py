"""Actual program sockets and retained results; provider output is synthetic."""
import importlib.util, unittest
if importlib.util.find_spec('parameter_report_runtime') is None:
 raise unittest.SkipTest('Requires the explicit isolated R8 runtime candidate; not an installed-feature assertion')

from pathlib import Path
from copy import deepcopy
from contextlib import contextmanager,ExitStack
from socketserver import UnixStreamServer,ThreadingMixIn,StreamRequestHandler
from threading import Thread,Event
from types import SimpleNamespace
from unittest.mock import patch,Mock
from django.db import connections
from django.test import TransactionTestCase
import builtins,fcntl,hashlib,json,os,socket,sys,time
from parameter_compound import test_worker as worker_fixture
from semantics import strict_json,canonical_json
from repository import Deferred
from engine import CallError
import model_program,parameter_report_runtime as report

RECOVERY=Path(__file__).resolve().parents[4]/'docs/alisa/runtime/v0.11/current_parameters_r8/program_recovery'

def producer_module(name):
 spec=importlib.util.spec_from_file_location('socket_test_'+name,RECOVERY/(name+'.py'))
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

class ProgramSocket(TransactionTestCase):
 setUp=worker_fixture.Compound.setUp
 tearDown=worker_fixture.Compound.tearDown
 start=worker_fixture.Compound.start
 delivery=worker_fixture.Compound.delivery
 filled=worker_fixture.Compound.filled
 tick=worker_fixture.Compound.tick
 finish=worker_fixture.Compound.finish
 ready=worker_fixture.Compound.ready
 provider_ops=worker_fixture.Compound.provider_ops

 @contextmanager
 def broker(self,disconnect_first=False,revoke_before_call=False):
  owner=self;requests=[];acks=[];failures=[];path=self.e.root/'program-test.sock'
  class Handler(StreamRequestHandler):
   def handle(self):
    try:
     request=json.loads(self.rfile.readline(524288));requests.append(request)
     if revoke_before_call:
      from django.utils import timezone
      owner.e.session.revoked_at=timezone.now();owner.e.session.save()
      self.wfile.write((json.dumps({'kind':'call','payload':{'messages':[]}})+'\n').encode());self.wfile.flush()
      line=self.rfile.readline(4096)
      if line:acks.append(json.loads(line))
      return
     if len(requests)==1:
      owner.e.save('0.25',1)
      if disconnect_first:return
     content='Синтетический ответ исполнителя.'
     reply={'kind':'complete','content':content,'digest':hashlib.sha256(content.encode()).hexdigest()}
     if request['protocol']==3:reply.update(job_id=request['job_id'],fingerprint=request['fingerprint'])
     self.wfile.write((json.dumps(reply)+'\n').encode());self.wfile.flush()
     line=self.rfile.readline(4096)
     if line:acks.append(json.loads(line))
    except Exception as error:failures.append(type(error).__name__)
    finally:connections.close_all()
  class Server(ThreadingMixIn,UnixStreamServer):daemon_threads=True
  server=Server(str(path),Handler);os.chmod(path,0o600);thread=Thread(target=server.serve_forever,kwargs={'poll_interval':.01},daemon=True);thread.start()
  original=model_program.run
  def actual(*args,**kwargs):return original(*args,socket_path=str(path),**kwargs)
  try:
   with patch('model_program.selected',return_value=True),patch('model_program.run',side_effect=actual):yield requests,acks,failures
  finally:server.shutdown();server.server_close();thread.join(2)

 def snapshot(self):
  row=self.e.row()
  return {'state':row['state'],'owner':row['owner'],'progress':strict_json(row['progress'])if row['progress']else{}}

 @contextmanager
 def producer(self,*,seed=None,lose_delivery=False,lose_ack=False,alter_reply=None):
  """Actual serve()/Results on an owned socket; every dispatch path is denied.

  Only the accepted descriptor, OS username and fixed filesystem roots are
  redirected. SO_PEERCRED, protocol validation, binding/read and ACK run intact.
  Seeding represents a synthetic result already durably produced before delivery.
  """
  owner=self;module=producer_module('program_broker');results=producer_module('program_results')
  base=self.e.root/'retained-program';store=results.Results(base/'results');path=self.e.root/'retained.sock';lock=self.e.root/'program.lock'
  state=SimpleNamespace(requests=[],replies=[],acks=[],snapshots=[],errors=[],denied=[],done=[],inputs=[],seeded=[],store=store,binding=results.binding,path=path,lock=lock)
  accepted=[None];original_start=results.Results.start
  def deny(name):
   def forbidden(*args,**kwargs):state.denied.append(name);raise AssertionError('Forbidden fixture dispatch: '+name)
   return forbidden
  def seed_complete(request,content='Синтетический сохранённый ответ.'):
   key=request['job_id'];fingerprint=results.binding(request)
   original_start(store,key,fingerprint);saved=store.complete(key,fingerprint,content)
   state.seeded.append((key,fingerprint));return saved
  state.seed_complete=seed_complete
  def fixture_open(name,*args,**kwargs):
   if str(name)!='/run/lock/alisa-program.lock':return deny('open')(name)
   return builtins.open(lock,*args,**kwargs)
  def principal(name):
   if name!='alice-market':return deny('principal')(name)
   return SimpleNamespace(pw_uid=os.getuid())
  class Handler(StreamRequestHandler):
   def handle(self):
    done=Event();state.done.append(done)
    try:
     first=self.rfile.readline(32*1024*1024+1);request=json.loads(first)
     state.requests.append(request);state.snapshots.append(owner.snapshot())
     if seed is not None:seed(request,state)
     if lose_delivery and len(state.requests)==1:return
     handler=self
     class Stream:
      pending=first
      def readline(self,limit):
       if self.pending is not None:line=self.pending;self.pending=None;return line
       line=handler.rfile.readline(limit)
       if line:
        ack=json.loads(line)
        state.acks.append({'message':ack,'request':request,'committed':owner.snapshot()})
        if lose_ack and len(state.acks)==1:return b''
       return line
      def write(self,raw):
       reply=json.loads(raw)
       if alter_reply is not None:reply=alter_reply(reply)
       state.replies.append(reply);return handler.wfile.write((json.dumps(reply,ensure_ascii=False)+'\n').encode())
      def flush(self):handler.wfile.flush()
     class Peer:
      def getsockopt(self,*args):return handler.request.getsockopt(*args)
      def settimeout(self,value):handler.request.settimeout(value)
      def makefile(self,mode):
       owner.assertEqual(mode,'rwb');return Stream()
     accepted[0]=Peer();module.serve()
    except Exception as error:
     state.errors.append((type(error).__name__,str(error)))
     try:self.wfile.write(b'{"kind":"error","code":"PROGRAM_EXECUTOR_FAILED"}\n');self.wfile.flush()
     except OSError:pass
    finally:connections.close_all();done.set()
  server=UnixStreamServer(str(path),Handler);os.chmod(path,0o600)
  thread=Thread(target=server.serve_forever,kwargs={'poll_interval':.01},daemon=True)
  original=model_program.run
  def actual(*args,**kwargs):
   before=len(state.requests);state.inputs.append((deepcopy(args[2]),deepcopy(args[3]),kwargs.get('generation')))
   try:return original(*args,socket_path=str(path),**kwargs)
   finally:
    # Keep the next Worker tick behind the previous broker ACK/EOF, so its
    # snapshot observes the durable callback rather than a subsequent claim.
    if len(state.requests)>before:owner.assertTrue(state.done[-1].wait(3),'broker did not finish')
  def exchange(request,ack=False):
   before=len(state.requests)
   with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)as client:
    client.settimeout(3);client.connect(str(path))
    with client.makefile('rwb')as stream:
     stream.write((json.dumps(request)+'\n').encode());stream.flush();reply=json.loads(stream.readline(524288))
     if ack:
      owner.assertEqual(reply['kind'],'complete');stream.write((json.dumps({'kind':'ack','digest':reply['digest']})+'\n').encode());stream.flush()
   if len(state.requests)>before:owner.assertTrue(state.done[-1].wait(3),'broker did not finish')
   return reply
  state.exchange=exchange
  prior_umask=os.umask(0o077)
  try:
   with ExitStack()as stack:
    for name,value in {'BASE':base,'open':fixture_open,'pwd':SimpleNamespace(getpwnam=principal),
       'socket':SimpleNamespace(socket=lambda *,fileno:accepted[0]if fileno==0 else deny('descriptor')(),SOL_SOCKET=socket.SOL_SOCKET,SO_PEERCRED=socket.SO_PEERCRED),
       'subprocess':SimpleNamespace(run=deny('subprocess.run'),Popen=deny('Popen'),DEVNULL=-3),
       'command':deny('command'),'active':deny('systemctl'),'remove_job':deny('remove_job'),'ThreadingHTTPServer':deny('HTTP/provider')}.items():
     stack.enter_context(patch.object(module,name,value,create=True))
    stack.enter_context(patch.object(results.Results,'start',deny('Results.start')))
    stack.enter_context(patch.dict(sys.modules,{'program_results':results}))
    stack.enter_context(patch('model_program.selected',return_value=True));stack.enter_context(patch('model_program.run',side_effect=actual))
    thread.start()
    try:yield state
    finally:server.shutdown();server.server_close();thread.join(3);owner.assertFalse(thread.is_alive())
  finally:os.umask(prior_umask);path.unlink(missing_ok=True)

 def claimed_program(self):
  """Reach the real answer checkpoint, then claim it for boundary-only calls."""
  self.filled();self.e.engine.program_answers=True;self.start();captured=[]
  def capture(worker,row,messages,data,**kwargs):
   captured.append((worker,deepcopy(messages),deepcopy(data),kwargs['generation']))
   raise Deferred(self.e.clock()+1)
  with patch('model_program.selected',return_value=True),patch('model_program.run',side_effect=capture):
   for _ in range(80):
    self.tick()
    if captured:break
   else:self.fail('no program answer checkpoint')
  current=self.e.row();self.e.clock.advance(max(1,current['due']-self.e.clock()+1));row=self.e.repo.claim()
  self.assertIsNotNone(row);worker,messages,data,generation=captured[0]
  envelope={'protocol':2,'job_id':hashlib.sha256((row['tenant']+'\0'+row['id']+'\0parameter-revision:'+generation).encode()).hexdigest(),
    'resume_only':False,'messages':messages,'document':canonical_json(data),'model':worker.transport.model_source.removeprefix('model:'),
    'user_id':'alisa_p_'+hashlib.sha256(('alisa-program-tenant-v1\0'+row['tenant']).encode()).hexdigest()}
  return worker,row,messages,data,generation,envelope

 def set_progress(self,row,changes,remove=()):
  with self.e.repo.connection(True)as connection:
   saved=self.e.repo._owned(connection,row['id'],row['owner']);progress=strict_json(saved['progress'])
   for key in remove:progress.pop(key,None)
   progress.update(deepcopy(changes));connection.execute('UPDATE jobs SET progress=? WHERE id=?',(canonical_json(progress),row['id']))
  return progress

 def test_actual_unix_lane_discards_stale_generation_and_acknowledges(self):
  self.filled();self.e.engine.program_answers=True;self.start()
  with self.broker()as(requests,acks,failures):self.ready()
  self.assertEqual(failures,[]);self.assertEqual(len(requests),2);self.assertNotEqual(requests[0]['job_id'],requests[1]['job_id'])
  self.assertEqual([r['resume_only']for r in requests],[False,False]);self.assertEqual(len(acks),2);self.assertEqual(self.provider_ops(),['ozon_orders'])
  new=json.loads(requests[-1]['document']);self.assertEqual(new['compound_parameter_context'][0]['estimates']['estimated_retained_units']['value'],'3')
 def test_actual_unix_lane_recovers_old_result_before_new_generation(self):
  self.filled();self.e.engine.program_answers=True;self.start()
  with self.broker(disconnect_first=True)as(requests,acks,failures):self.ready()
  self.assertEqual(failures,[]);self.assertEqual(len(requests),3);self.assertEqual(requests[0]['job_id'],requests[1]['job_id']);self.assertNotEqual(requests[1]['job_id'],requests[2]['job_id'])
  self.assertEqual([r['resume_only']for r in requests],[False,True,False]);self.assertEqual(len(acks),2);self.assertEqual(self.provider_ops(),['ozon_orders'])

 def test_plugin_call_after_session_revocation_is_not_dispatched(self):
  self.filled();self.e.engine.program_answers=True;self.start()
  with self.broker(revoke_before_call=True)as(requests,acks,failures):row=self.finish()
  self.assertEqual(row['state'],'FAILED');self.assertEqual(len(requests),1);self.assertEqual(acks,[])
  self.assertNotIn('model_answer_program',[c.operation for c in self.e.transport.calls]);self.assertEqual(self.provider_ops(),['ozon_orders'])

 def test_real_retained_binding_recovers_then_commits_stale_discard_before_ack(self):
  self.filled();self.e.engine.program_answers=True;self.start()
  old_text='Старый ответ до изменения коэффициента.';new_text='Новый ответ после изменения коэффициента.'
  def seed(request,producer):
   if request['protocol']==2 and not request['resume_only']:
    producer.seed_complete(request,old_text if not producer.seeded else new_text)
    if len(producer.seeded)==1:self.e.save('0.25',1)
  with self.producer(seed=seed,lose_delivery=True)as producer:row=self.ready()
  old,recovery,new=producer.requests;fingerprint=producer.binding(old)
  self.assertEqual(recovery,{'protocol':3,'job_id':old['job_id'],'fingerprint':fingerprint,'resume_only':True})
  self.assertNotEqual(old['job_id'],new['job_id']);self.assertEqual([old['resume_only'],new['resume_only']],[False,False])
  self.assertEqual(producer.inputs[0][2],producer.inputs[1][2]);self.assertNotEqual(producer.inputs[1][2],producer.inputs[2][2])
  # The old producer really rejects rebuilding v2 with today's document while
  # retaining the original job/generation; this is the pre-fix failure boundary.
  rebuilt=dict(old,document=canonical_json(producer.inputs[1][1]),resume_only=True)
  self.assertNotEqual(producer.binding(rebuilt),fingerprint)
  with self.assertRaisesRegex(ValueError,'job_binding'):producer.store.read(old['job_id'],producer.binding(rebuilt))
  first=producer.snapshots[0]['progress']
  self.assertTrue(first['_program_started']);self.assertEqual(first['_program_request_binding'],{'job_id':old['job_id'],'fingerprint':fingerprint})
  self.assertEqual(set(first['_program_request_binding']),{'job_id','fingerprint'})
  self.assertEqual(len(producer.acks),2);stale=producer.acks[0]['committed']
  self.assertEqual(stale['state'],'QUEUED');self.assertIsNone(stale['owner'])
  for key in ('_program_started','_program_started_at','_program_recovery_at','_program_request_binding','_compound_answer_fences','_compound_answer_generation'):
   self.assertNotIn(key,stale['progress'])
  self.assertEqual(producer.acks[1]['committed']['state'],'READY')
  self.assertEqual(producer.store.read(old['job_id'],fingerprint)['state'],'acknowledged')
  self.assertEqual(json.loads(new['document'])['compound_parameter_context'][0]['estimates']['estimated_retained_units']['value'],'3')
  self.assertIn(new_text,row['result']);self.assertNotIn(old_text,row['result'])
  self.assertEqual(producer.errors,[]);self.assertEqual(producer.denied,[]);self.assertEqual(len(producer.seeded),2)
  self.assertEqual(self.provider_ops(),['ozon_orders']);self.assertNotIn('model_answer_program',[c.operation for c in self.e.transport.calls])

 def test_recovery_rejects_changed_echo_digest_and_calls_without_ack(self):
  worker,row,messages,data,generation,envelope=self.claimed_program();change=[lambda reply:reply]
  with self.producer(alter_reply=lambda reply:change[0](reply))as producer:
   saved=producer.seed_complete(envelope);pair={'job_id':envelope['job_id'],'fingerprint':producer.binding(envelope)}
   self.set_progress(row,{'_program_started':True,'_program_request_binding':pair})
   cases=[('job',lambda reply:dict(reply,job_id='f'*64),'PROGRAM_RECOVERY_RESPONSE'),
    ('binding',lambda reply:dict(reply,fingerprint='e'*64),'PROGRAM_RECOVERY_RESPONSE'),
    ('digest',lambda reply:dict(reply,digest='d'*64),'PROGRAM_RECOVERY_RESPONSE'),
    ('content',lambda reply:dict(reply,content=reply['content']+'!'),'PROGRAM_RECOVERY_RESPONSE'),
    ('extra',lambda reply:dict(reply,model='injected'),'PROGRAM_RECOVERY_RESPONSE'),
    ('call',lambda reply:{'kind':'call','payload':{'messages':[]}},'PROGRAM_REPLAY_FORBIDDEN')]
   for label,mutate,code in cases:
    with self.subTest(boundary=label):
     change[0]=mutate;callback=Mock()
     with self.assertRaises(CallError)as raised:model_program.run(worker,row,messages,data,generation=generation,on_complete=callback)
     self.assertEqual(raised.exception.code,code);self.assertTrue(raised.exception.unknown);callback.assert_not_called()
     self.assertEqual(producer.acks,[]);self.assertEqual(producer.store.read(pair['job_id'],pair['fingerprint']),saved)
  self.assertEqual(producer.errors,[]);self.assertEqual(producer.denied,[])
  self.assertNotIn('model_answer_program',[c.operation for c in self.e.transport.calls])

 def test_saved_binding_is_rejected_before_connect_for_wrong_job_or_shape(self):
  worker,row,messages,data,generation,envelope=self.claimed_program();results=producer_module('program_results')
  pair={'job_id':envelope['job_id'],'fingerprint':results.binding(envelope)}
  identities=[hashlib.sha256((tenant+'\0'+job+'\0parameter-revision:'+gen).encode()).hexdigest()
   for tenant,job,gen in [(row['tenant']+'-other',row['id'],generation),(row['tenant'],row['id']+'-other',generation),(row['tenant'],row['id'],generation+'-other')]]
  cases=[(dict(pair,job_id=key),True)for key in identities]+[(dict(pair,fingerprint=None),True),(dict(pair,document='forbidden'),True),(pair,False)]
  for saved,started in cases:
   with self.subTest(record=saved,started=started):
    self.set_progress(row,{'_program_started':started,'_program_request_binding':saved});probe=Mock();callback=Mock()
    with patch.object(model_program,'socket',SimpleNamespace(socket=Mock(return_value=probe),AF_UNIX=socket.AF_UNIX,SOCK_STREAM=socket.SOCK_STREAM)):
     with self.assertRaises(CallError)as raised:model_program.run(worker,row,messages,data,generation=generation,on_complete=callback)
    self.assertEqual(raised.exception.code,'PROGRAM_RECOVERY_BINDING');self.assertTrue(raised.exception.unknown)
    probe.connect.assert_not_called();callback.assert_not_called()

 def test_producer_retrieval_retention_binding_and_exact_wire_never_start_work(self):
  worker,row,messages,data,generation,envelope=self.claimed_program()
  with self.producer()as producer:
   saved=producer.seed_complete(envelope);pair={'job_id':envelope['job_id'],'fingerprint':producer.binding(envelope)}
   request={'protocol':3,**pair,'resume_only':True};self.set_progress(row,{'_program_started':True,'_program_request_binding':pair})
   for state in ('missing','started','expired','acknowledged'):
    with self.subTest(retention=state):
     if state=='missing':producer.store.path(pair['job_id']).unlink()
     elif state=='started':producer.store.save(pair['job_id'],{'state':'started','fingerprint':pair['fingerprint'],'at':time.time(),'workspace':None})
     elif state=='expired':producer.store.save(pair['job_id'],dict(saved,at=time.time()-3601))
     else:
      producer.store.save(pair['job_id'],saved);producer.store.ack(pair['job_id'],pair['fingerprint'],saved['digest'])
     callback=Mock()
     with self.assertRaises(CallError)as raised:model_program.run(worker,row,messages,data,generation=generation,on_complete=callback)
     self.assertEqual(raised.exception.code,'PROGRAM_RESULT_UNAVAILABLE');self.assertTrue(raised.exception.unknown);callback.assert_not_called()
   producer.store.save(pair['job_id'],saved)
   cases=[(dict(request,fingerprint='f'*64),'job_binding'),(dict(request,model='forbidden'),'protocol'),
    (dict(request,resume_only=False),'protocol'),(dict(request,job_id='../escape'),'binding'),(dict(request,fingerprint='x'*64),'binding')]
   for value,error in cases:
    with self.subTest(request=value):
     self.assertEqual(producer.exchange(value)['kind'],'error');self.assertEqual(producer.errors[-1],('ValueError',error))
     self.assertEqual(producer.store.read(pair['job_id'],pair['fingerprint']),saved)
   self.assertEqual(producer.exchange(dict(request,job_id='0'*64)),{'kind':'unknown'})
  self.assertEqual(producer.acks,[]);self.assertEqual(producer.denied,[])

 def test_busy_clears_only_fresh_binding_and_legacy_resume_never_backfills(self):
  worker,row,messages,data,generation,envelope=self.claimed_program()
  with self.producer()as producer:
   pair={'job_id':envelope['job_id'],'fingerprint':producer.binding(envelope)}
   for resume in (False,True):
    with self.subTest(resume=resume):
     self.set_progress(row,{'_program_started':True,'_program_request_binding':pair}if resume else{},remove=()if resume else('_program_started','_program_started_at','_program_request_binding'))
     with builtins.open(producer.lock,'a')as held:
      fcntl.flock(held,fcntl.LOCK_EX|fcntl.LOCK_NB)
      with self.assertRaises(Deferred):model_program.run(worker,row,messages,data,generation=generation,on_complete=Mock())
     progress=self.snapshot()['progress']
     if resume:self.assertEqual(progress['_program_request_binding'],pair);self.assertTrue(progress['_program_started'])
     else:
      for key in ('_program_started','_program_started_at','_program_request_binding'):self.assertNotIn(key,progress)
     self.assertIn('_compound_answer_generation',progress)
   saved=producer.seed_complete(envelope)
   self.set_progress(row,{'_program_started':True},remove=('_program_request_binding',))
   response=model_program.run(worker,row,messages,data,generation=generation,on_complete=None)
   self.assertEqual(response['content'],saved['content']);self.assertEqual(producer.requests[-1],dict(envelope,resume_only=True))
   self.assertNotIn('_program_request_binding',self.snapshot()['progress'])
   changed=deepcopy(data);changed['compound_parameter_context'][0]['estimates']['estimated_retained_units']['value']='3'
   with self.assertRaises(Deferred):model_program.run(worker,row,messages,changed,generation=generation,on_complete=Mock())
   self.assertEqual(producer.errors,[('ValueError','job_binding')]);self.assertEqual(producer.requests[-1]['protocol'],2)
   self.assertTrue(producer.requests[-1]['resume_only']);self.assertNotIn('_program_request_binding',self.snapshot()['progress'])
  self.assertEqual(producer.acks,[]);self.assertEqual(producer.denied,[])

 def test_failed_callback_transaction_and_stale_reschedule_retain_without_ack(self):
  worker,row,messages,data,generation,envelope=self.claimed_program()
  with self.producer()as producer:
   saved=producer.seed_complete(envelope);pair={'job_id':envelope['job_id'],'fingerprint':producer.binding(envelope)}
   progress=self.set_progress(row,{'_program_started':True,'_program_request_binding':pair});fences=deepcopy(progress['_compound_answer_fences'])
   def rollback(response):
    with self.e.repo.connection(True)as connection:
     connection.execute('UPDATE jobs SET progress=? WHERE id=?',(canonical_json({'must_rollback':True}),row['id']))
     raise RuntimeError('injected commit boundary failure')
   for callback in (Mock(side_effect=RuntimeError('injected callback failure')),rollback):
    with self.subTest(callback=type(callback).__name__):
     with self.assertRaises(Deferred):model_program.run(worker,row,messages,data,generation=generation,on_complete=callback)
     self.assertEqual(producer.acks,[]);self.assertNotIn('must_rollback',self.snapshot()['progress'])
     self.assertEqual(self.snapshot()['progress']['_program_request_binding'],pair);self.assertEqual(producer.store.read(pair['job_id'],pair['fingerprint']),saved)
   self.e.save('0.25',1)
   def stale(response):report.fence_answer(worker,row,deepcopy(progress),fences)
   with patch.object(self.e.repo,'reschedule',side_effect=RuntimeError('injected stale commit failure')):
    with self.assertRaises(Deferred):model_program.run(worker,row,messages,data,generation=generation,on_complete=stale)
   self.assertEqual(producer.acks,[]);self.assertEqual(self.snapshot()['progress']['_program_request_binding'],pair)
   model_program.run(worker,row,messages,data,generation=generation,on_complete=stale)
   self.assertEqual(producer.acks[0]['committed']['state'],'QUEUED');self.assertNotIn('_program_request_binding',producer.acks[0]['committed']['progress'])
   self.assertEqual(producer.store.read(pair['job_id'],pair['fingerprint'])['state'],'acknowledged')
  self.assertEqual(producer.errors,[]);self.assertEqual(producer.denied,[])

 def test_lost_ack_keeps_result_after_ready_and_retrieves_without_dispatch(self):
  self.filled();self.e.engine.program_answers=True;self.start()
  def seed(request,producer):
   if request['protocol']==2 and not request['resume_only']:producer.seed_complete(request)
  with self.producer(seed=seed,lose_ack=True)as producer:
   row=self.ready();original=producer.requests[0];fingerprint=producer.binding(original)
   self.assertEqual(producer.acks[0]['committed']['state'],'READY');self.assertEqual(producer.store.read(original['job_id'],fingerprint)['state'],'complete')
   reply=producer.exchange({'protocol':3,'job_id':original['job_id'],'fingerprint':fingerprint,'resume_only':True},ack=True)
   self.assertEqual(reply['job_id'],original['job_id']);self.assertEqual(reply['fingerprint'],fingerprint)
   self.assertEqual(reply['digest'],hashlib.sha256(reply['content'].encode()).hexdigest())
   self.assertEqual(producer.store.read(original['job_id'],fingerprint)['state'],'acknowledged')
  self.assertEqual(self.e.row()['result'],row['result']);self.assertEqual(len(producer.seeded),1);self.assertEqual(len(producer.requests),2)
  self.assertEqual(producer.errors,[]);self.assertEqual(producer.denied,[]);self.assertEqual(self.provider_ops(),['ozon_orders'])
