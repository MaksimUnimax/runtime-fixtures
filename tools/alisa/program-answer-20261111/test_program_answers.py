"""Queue-level routing, full data preservation and pinned retry behaviour."""
import unittest
from unittest.mock import patch
import test_model_answer as answer_tests
from model_answer import API_DATA,PENDING
from semantics import canonical_json,strict_json
from repository import Deferred

class ProgramRouting(unittest.TestCase):
    def setUp(self):
        self.flow=answer_tests.AnswerFlow('test_original_question_plain_answer_and_actual_api_data');self.flow.setUp()
        self.flow.engine.program_answers=True
    def tearDown(self):self.flow.tearDown()
    def pending(self,size):
        f=self.flow;a=f.ask()
        for _ in range(20):
            r=f.repo.get('A',a['job_id'])
            f.clock.advance(max(0,r['due']-f.clock())+1);f.worker.step()
            r=f.repo.get('A',a['job_id']);p=strict_json(r['progress'])if r['progress']else{}
            if PENDING in p:break
        else:raise AssertionError('API stage did not complete')
        value={'blob':'x'*(size-len(canonical_json({'blob':''})))}
        p[API_DATA]=value
        with f.repo.connection(True)as c:c.execute('UPDATE jobs SET progress=? WHERE id=?',(canonical_json(p),r['id']))
        return a,value
    def test_9999_goes_direct_and_10000_transfers_the_complete_document(self):
        for size in [9999,10000]:
            if size==10000:self.flow.seq+=100;self.flow.save(answer_extra_instruction='Уточнение для ответа.')
            a,data=self.pending(size)
            with patch('model_program.run',return_value={'content':'Ответ модели.','finish_reason':'stop'})as run:
                r=self.flow.run_job(a)
            self.assertEqual(r['state'],'READY',r['error'])
            if size<10000:self.assertFalse(run.called)
            else:
                self.assertEqual(run.call_count,1);self.assertEqual(run.call_args.args[3],data)
                self.assertEqual(run.call_args.args[2][1]['content'],'Уточнение для ответа.')
                self.assertTrue(any(m['content']==strict_json(r['draft'])['original_question']for m in run.call_args.args[2]))
    def test_retry_keeps_program_route_and_prompt_snapshot(self):
        f=self.flow;a,data=self.pending(11000)
        with patch('model_program.run',side_effect=Deferred(f.clock()+20)):f.worker.step()
        row=f.repo.get('A',a['job_id']);self.assertEqual(row['state'],'QUEUED')
        self.assertEqual(strict_json(row['progress'])['_answer_execution'],'program_v1')
        f.engine.program_answers=False;f.save(answer_prompt='Следующая редакция.')
        with patch('model_program.run',return_value={'content':'Ответ.','finish_reason':'stop'})as run:r=f.run_job(a)
        self.assertEqual(r['state'],'READY');self.assertEqual(run.call_count,1)
        self.assertNotEqual(run.call_args.args[2][0]['content'],'Следующая редакция.')

class ProgramWire(unittest.TestCase):
    def test_partial_received_usage_is_preserved_without_blind_retry(self):
        import json
        from types import SimpleNamespace
        from engine import CallError
        from model_program_wire import execute
        from request_recovery import retry_due
        usage={'input_tokens':100,'cache_read_input_tokens':200,'cache_creation_input_tokens':0,'output_tokens':30}
        raw=('data: '+json.dumps({'type':'message_start','message':{'model':'deepseek-flash'}})+'\n\n'+
             'data: '+json.dumps({'type':'message_delta','usage':usage,'delta':{'stop_reason':'end_turn'}})+'\n\n').encode()
        transport=SimpleNamespace(enabled=True,model_source='model:deepseek-flash',max_request_seconds=90,_credential=lambda name:'synthetic')
        request=SimpleNamespace(operation='model_answer_program',body={'payload':{'model':'deepseek-flash','stream':True,'messages':[]}})
        with patch('model_program_wire.read_response',return_value=(raw,200)):
            with self.assertRaises(CallError)as caught:execute(transport,request,None)
        error=caught.exception
        self.assertTrue(error.unknown);self.assertEqual(error.model_usage['usage']['total_tokens'],330)
        self.assertIsNone(retry_due(None,None,request,error,True))

if __name__=='__main__':unittest.main()

