"""Complete queue scenarios for owner-defined plain answers and API recovery."""
import io,json,tempfile,unittest,urllib.error
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch
from test_runtime import Clock,SCOPE,TODAY,FakeTransport
from engine import Engine,Worker,CallError
from repository import Repository
from semantics import fingerprint,strict_json,Rejected
from model_answer import Settings,DEFAULTS,PENDING,API_DATA
from universal_reads import ReadSurface,COLLECTION_SYSTEM
import model_usage,read_surface

QUESTION='Сводка заказов за октябрь на Озоне'
META={'status':200,'elapsed_ms':1,'bytes':100}
class Transport(FakeTransport):
    model_source='model:fixture-provider'
    def __init__(self):
        super().__init__();self.answer='Обычный ответ.\n\nСкобки { и [ допустимы; 4 штуки.';self.failures=[];self.decisions=[];self.data={'result':[{'id':777,'title':'Акция','participating_products_count':3}]};self.answer_calls=[]
    def prepare(self,*a):return None
    def execute_observed(self,request,store,on_dispatch):
        on_dispatch();return self.execute(request,store)
    def execute(self,request,store):
        if request.operation=='model_answer':
            self.calls.append(request);self.answer_calls.append(request)
            if self.failures:raise self.failures.pop(0)
            if self.on_call:self.on_call(request)
            return {'content':self.answer,'finish_reason':'stop'},META
        if request.operation=='deepseek_read_plan':
            self.calls.append(request)
            return {'content':json.dumps(self.decisions.pop(0)),'finish_reason':'stop'},META
        if request.operation.startswith('read.'):
            self.calls.append(request)
            if isinstance(self.data,Exception):raise self.data
            return self.data,META
        return super().execute(request,store)

class AnswerFlow(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.clock=Clock();self.scope=SCOPE
        self.settings=Settings(self.root/'answer-settings.json');self.repo=Repository(self.root/'db.sqlite',self.clock)
        self.reads=ReadSurface(lambda:{'enabled':True,'pin':read_surface.PIN,'max_model_steps':None,'max_provider_calls':None})
        self.engine=Engine(self.repo,lambda t:self.scope,read_surface=self.reads,answer_settings=self.settings)
        self.transport=Transport();self.worker=Worker(self.engine,self.transport);self.seq=0
    def tearDown(self):self.tmp.cleanup()
    def save(self,**changes):
        setting=self.settings.read();rev=setting.pop('revision');return self.settings.save(rev,**dict(setting,**changes))
    def ask(self,q=QUESTION,conversation=None):
        self.seq+=1
        return self.engine.safe_submit('A',q,str(self.seq),fingerprint(q),TODAY,conversation_id=conversation,message_id=self.seq if conversation else None)
    def run_job(self,answer):
        self.assertIn('job_id',answer,answer)
        for _ in range(50):
            row=self.repo.get('A',answer['job_id'])
            if row['state']not in ('QUEUED','RUNNING'):return row
            self.clock.advance(max(0,row['due']-self.clock())+1);self.worker.step()
        self.fail('job did not terminate')
    def collect(self):
        self.transport.decisions=[{'action':'read','store_id':'oz1','operation':'ozon_actions_list','params':{}},{'action':'data_ready'}]
    def test_original_question_plain_answer_and_actual_api_data(self):
        a=self.ask();r=self.run_job(a);self.assertEqual(r['state'],'READY',r['error'])
        messages=self.transport.answer_calls[0].body['messages']
        self.assertEqual(messages[0]['content'],DEFAULTS['answer_prompt']);self.assertEqual(messages[1]['content'],QUESTION)
        self.assertEqual(len(messages),3);self.assertIn('123.45',messages[2]['content'])
        self.assertEqual(''.join(strict_json(r['result'])['pages']),self.transport.answer)
        self.assertEqual(self.engine.control('A','результат')['text'],self.transport.answer)
        self.assertEqual([x.operation for x in self.transport.calls],['ozon_orders','model_answer'])
    def test_extra_empty_nonempty_clear_and_restart(self):
        self.save(answer_extra_instruction='  \n ');self.run_job(self.ask());self.assertEqual(len(self.transport.answer_calls[-1].body['messages']),3)
        text='  Пиши кратко.\nСохраняй смысл.  ';self.save(answer_extra_instruction=text)
        self.assertEqual(Settings(self.settings.path).read()['answer_extra_instruction'],text)
        self.run_job(self.ask());self.assertEqual(self.transport.answer_calls[-1].body['messages'][1]['content'],text)
        self.save(answer_extra_instruction='');self.run_job(self.ask());self.assertEqual(len(self.transport.answer_calls[-1].body['messages']),3)
        self.assertEqual(self.settings.path.stat().st_mode&0o777,0o600)
    def test_three_prompt_settings_stale_save_and_real_planning_body(self):
        self.save(request_planning_prompt='Выбери шаблоны.\nУчитывай период.',answer_prompt='Ответь подробно по данным.')
        with self.assertRaises(Rejected):self.settings.save(0,**DEFAULTS)
        q='Каков объем заказанных единиц за октябрь на озоне';r=self.run_job(self.ask(q));self.assertEqual(r['state'],'READY',r['error'])
        first=next(r for r in self.transport.calls if r.operation=='deepseek_parse')
        self.assertEqual(first.body['instruction'],'Выбери шаблоны.\nУчитывай период.')
        self.assertEqual(self.transport.answer_calls[-1].body['messages'][0]['content'],'Ответь подробно по данным.')
    def test_final_retry_same_job_without_repeated_api_and_with_snapshot(self):
        a=self.ask();self.worker.step();self.assertIn(PENDING,strict_json(self.repo.get('A',a['job_id'])['progress']))
        self.save(answer_extra_instruction='Первое уточнение');self.transport.failures=[CallError('HTTP_503',status=503)]
        self.worker.step();self.save(answer_extra_instruction='Новое уточнение')
        # Restart the queue and settings objects before retrying.
        self.repo=Repository(self.repo.path,self.clock);self.engine=Engine(self.repo,lambda t:self.scope,read_surface=self.reads,answer_settings=Settings(self.settings.path));self.worker=Worker(self.engine,self.transport)
        r=self.run_job(a);self.assertEqual(r['state'],'READY',r['error'])
        self.assertEqual(self.transport.answer_calls[0].body,self.transport.answer_calls[1].body)
        self.assertEqual([x.operation for x in self.transport.calls].count('ozon_orders'),1)
        summary=model_usage.summary(self.repo);self.assertEqual((summary['attempts'],summary['requests'],summary['average']),(2,1,2))
    def test_cache_replay_result_and_next_do_not_call_model(self):
        a=self.ask();self.run_job(a);count=len(self.transport.calls)
        b=self.ask();self.assertEqual(b['job_id'],a['job_id']);self.assertEqual(b['cache'],'HIT')
        for q in ('результат','дальше','статус отчета'):self.engine.control('A',q)
        self.assertFalse(self.worker.step());self.assertEqual(len(self.transport.calls),count)
    def test_different_original_question_and_changed_prompt_have_separate_answers(self):
        a=self.ask();self.run_job(a)
        b=self.ask(QUESTION.lower());self.assertNotEqual(a['job_id'],b['job_id']);self.run_job(b)
        self.save(answer_prompt='Новая задача ответа');c=self.ask();self.assertNotEqual(c['job_id'],a['job_id'])
    def test_old_server_rendered_cache_not_reused(self):
        legacy=Engine(self.repo,lambda t:self.scope);self.seq+=1;a=legacy.submit('A',QUESTION,'old',fingerprint(QUESTION),TODAY);Worker(legacy,FakeTransport()).step()
        self.engine=Engine(self.repo,lambda t:self.scope,read_surface=self.reads,answer_settings=self.settings);self.worker=Worker(self.engine,self.transport)
        b=self.ask();self.assertNotEqual(a['job_id'],b['job_id']);self.assertEqual(self.run_job(b)['state'],'READY')
    def test_universal_promotions_no_finish_expression_and_all_rows(self):
        self.collect();self.transport.data={'result':[{'id':700+i,'title':'Акция '+str(i),'participating_products_count':i}for i in range(40)]}
        a=self.ask('Скажи, в каких акциях участвуют товары на Озоне?');r=self.run_job(a);self.assertEqual(r['state'],'READY',r['error'])
        self.assertEqual([c.operation for c in self.transport.calls].count('read.ozon.ozon_actions_list'),1)
        self.assertIn('Акция 39',self.transport.answer_calls[0].body['messages'][-1]['content'])
        self.assertEqual(next(c for c in self.transport.calls if c.operation=='deepseek_read_plan').body['system'],COLLECTION_SYSTEM)
    def test_access_revoked_before_final_model(self):
        a=self.ask();self.worker.step();self.scope=replace(self.scope,revision='revoked');r=self.run_job(a)
        self.assertEqual(r['error'],'SOURCE_ACCESS');self.assertFalse(self.transport.answer_calls)
    def test_cancel_after_data_does_not_generate(self):
        self.ask();self.worker.step();self.repo.cancel('A');self.assertFalse(self.worker.step());self.assertFalse(self.transport.answer_calls)
    def test_429_and_503_marketplace_retry_before_model_sees_error(self):
        self.collect();self.transport.data=CallError('HTTP_429',status=429,retry_at=self.clock()+300)
        a=self.ask('В каких акциях мои товары на Озоне?')
        for _ in range(8):
            self.clock.advance(1);self.worker.step()
            if any(c.operation.startswith('read.')for c in self.transport.calls):break
        r=self.repo.get('A',a['job_id']);self.assertEqual(r['state'],'QUEUED');self.assertGreater(r['due'],self.clock());self.assertFalse(self.transport.answer_calls)
        self.transport.data={'result':[]};r=self.run_job(a);self.assertEqual(r['state'],'READY',r['error'])
        self.assertNotIn('HTTP_429',self.transport.answer_calls[0].body['messages'][-1]['content'])
    def test_unknown_api_error_becomes_model_data_no_repeated_read(self):
        self.collect();self.transport.data=CallError('HTTP_418',status=418)
        a=self.ask('В каких акциях мои товары на Озоне?');r=self.run_job(a)
        self.assertEqual(r['state'],'READY');self.assertEqual(r['error'],'HTTP_418')
        self.assertIn('418',self.transport.answer_calls[0].body['messages'][-1]['content'])
        self.assertEqual(self.engine.control('A','результат')['text'],self.transport.answer)
        self.assertEqual([c.operation for c in self.transport.calls].count('read.ozon.ozon_actions_list'),1)
    def test_premium_denial_plain_model_notice_then_revocation_blocks_delivery(self):
        from provider_denial import diagnose_denial
        d=diagnose_denial('read.ozon.ozon_actions_list','https://api-seller.ozon.ru/v1/actions',403,b'{"code":7,"message":"This method is available only for users with Premium subscription"}')
        self.assertIn('model_response',d,d)
        self.collect();self.transport.data=CallError(d.get('tier_public_code',d['public_code']),status=403,feedback={'model_response':d['model_response']})
        a=self.ask('В каких акциях мои товары на Озоне?');r=self.run_job(a);self.assertEqual(r['state'],'READY',r['error'])
        prompt=self.transport.answer_calls[0].body['messages'][-1]['content'];self.assertIn('Premium',prompt);self.assertNotIn('Тестовая акция',prompt)
        self.assertEqual(self.engine.control('A','результат')['text'],self.transport.answer)
        self.scope=replace(self.scope,revision='revoked');self.assertNotEqual(self.engine.control('A','результат')['text'],self.transport.answer)
    def test_plain_long_word_and_json_looking_text_not_validated(self):
        self.transport.answer='x'*901+'\n{"arbitrary": true}\n'+('text '*300)
        r=self.run_job(self.ask());pages=strict_json(r['result'])['pages']
        self.assertTrue(all(0<len(x)<=850 for x in pages));self.assertEqual(''.join(pages),self.transport.answer)

    def test_two_marketplaces_keep_both_api_payloads_and_request_periods(self):
        r=self.run_job(self.ask('сводка заказов за октябрь вместе'))
        self.assertEqual(r['state'],'READY',r['error'])
        content=self.transport.answer_calls[-1].body['messages'][-1]['content']
        self.assertIn('ozon_orders',content);self.assertIn('wb_orders',content)
        self.assertIn('selectedPeriod',content);self.assertIn('date_from',content)

    def test_permission_notice_replay_next_ttl_and_station_delivery(self):
        self.collect();self.transport.data=CallError('HTTP_403',status=403)
        self.transport.answer='Пояснение отказа. '*120
        a=self.ask('В каких акциях мои товары на Озоне?',conversation='answer-session-one')
        row=self.run_job(a);self.assertEqual(row['state'],'READY',row['error'])
        from station_status import status
        value={'op':'station_status','tenant':'A','conversation_id':'answer-session-one','job_id':a['job_id']}
        self.assertEqual(status(self.engine,value)['state'],'READY')
        with self.repo.reader_scope('A','answer-session-one'):
            first=self.engine.safe_submit('A','результат','notice-control',fingerprint('результат'),TODAY)
            second=self.engine.safe_submit('A','дальше','notice-next',fingerprint('дальше'),TODAY)
            self.assertNotEqual(first['text'],second['text'])
        self.scope=replace(self.scope,revision='revoked')
        with self.repo.reader_scope('A','answer-session-one'):
            replay=self.engine.safe_submit('A','результат','notice-control',fingerprint('результат'),TODAY)
        self.assertEqual(replay['error'],'SOURCE_ACCESS')
        with self.assertRaises(Rejected):status(self.engine,value)
        self.scope=SCOPE;self.clock.advance(100000)
        with self.repo.reader_scope('A','answer-session-one'):
            expired=self.engine.safe_submit('A','результат','notice-control',fingerprint('результат'),TODAY)
        self.assertEqual(expired['error'],'RESULT_EXPIRED')

    def test_prior_success_does_not_leak_in_permission_notice(self):
        self.collect();self.transport.decisions=[
            {'action':'read','store_id':'oz1','operation':'ozon_actions_list','params':{}},
            {'action':'read','store_id':'oz1','operation':'seller_actions_list','params':{'limit':100,'offset':0}}]
        original=self.transport.execute
        def execute(request,store):
            if request.operation=='read.ozon.seller_actions_list':
                self.transport.calls.append(request);raise CallError('HTTP_403',status=403)
            return original(request,store)
        self.transport.execute=execute;self.transport.data={'result':[{'id':777,'title':'PRIVATE_EARLIER_DATA','participating_products_count':3}]}
        a=self.ask('В каких акциях мои товары на Озоне?');r=self.run_job(a)
        self.assertEqual(r['state'],'READY',r['error'])
        self.assertNotIn('PRIVATE_EARLIER_DATA',self.transport.answer_calls[0].body['messages'][-1]['content'])

    def test_clarification_preserves_original_case_and_followup(self):
        a=self.ask('Сколько товаров Заказали на Озоне?',conversation='answer-clarification')
        self.assertTrue(a.get('clarification_required'),a)
        b=self.ask('За Октябрь',conversation='answer-clarification');r=self.run_job(b)
        self.assertEqual(r['state'],'READY',r['error'])
        content=[m['content']for m in self.transport.answer_calls[-1].body['messages']]
        self.assertIn('Сколько товаров Заказали на Озоне?',content);self.assertIn('За Октябрь',content)

    def test_partial_data_answer_does_not_bypass_later_source_denial(self):
        self.collect();self.transport.data=CallError('HTTP_418',status=418)
        a=self.ask('В каких акциях мои товары на Озоне?');r=self.run_job(a)
        plan=strict_json(r['plan']);ref=plan['read_source_refs'][0]
        self.repo.deny(ref['source'],ref['revision'])
        self.assertNotEqual(self.engine.control('A','результат')['text'],self.transport.answer)

    def test_revocation_between_control_text_and_receipt_never_returns_unprotected_text(self):
        self.collect();self.transport.data=CallError('HTTP_403',status=403)
        a=self.ask('В каких акциях мои товары на Озоне?');self.run_job(a)
        with patch.object(self.engine,'scope_current',side_effect=[True,False]):
            reply=self.engine.safe_submit('A','результат','race-receipt',fingerprint('результат'),TODAY)
        self.assertEqual(reply['error'],'SOURCE_ACCESS')
        with self.repo.connection() as c:self.assertIsNone(c.execute('SELECT * FROM control_inbox WHERE rid=?',('race-receipt',)).fetchone())

    def test_cold_auth_dependency_is_excluded_from_universal_answer(self):
        from scalar_runtime import MATRIX
        from providers import Request
        auth=next(iter(MATRIX.auth.values()))['operation'];prepared=[];original=self.transport.execute
        def prepare(request,store):
            if not prepared:
                prepared.append(True);return Request(auth,'ozon:cabinet-oz-1:auth','oz1',{},0,None)
        def execute(request,store):
            if request.operation==auth:
                self.transport.calls.append(request);return {'authorized':True},dict(META,authentication_only=True)
            return original(request,store)
        self.transport.prepare=prepare;self.transport.execute=execute;self.collect()
        r=self.run_job(self.ask('В каких акциях мои товары на Озоне?'));self.assertEqual(r['state'],'READY',r['error'])
        context=self.transport.answer_calls[-1].body['messages'][-1]['content']
        self.assertNotIn('authorized',context);self.assertIn('participating_products_count',context)

class Adapter(unittest.TestCase):
    def test_payload_is_plain_text_without_output_schema(self):
        from http_transport import HTTPTransport
        from providers import Request
        from model_answer import messages
        seen=[]
        def http(request,**kw):
            seen.append(json.loads(request.data));return json.dumps({'choices':[{'message':{'content':'Обычный текст { без JSON'},'finish_reason':'stop'}]}).encode(),200
        transport=HTTPTransport('/unused',{}, {},enabled=True)
        with patch.object(transport,'_credential',return_value='synthetic-provider-key'),patch('http_transport.read_response',side_effect=http):
            value,meta=transport.execute(Request('model_answer','model:fixture','',{'messages':messages('Вопрос',{'rows':[1,2]})},0,None),None)
        self.assertEqual(value['content'],'Обычный текст { без JSON');self.assertNotIn('response_format',seen[0]);self.assertNotIn('tools',seen[0]);self.assertEqual(len(seen[0]['messages']),3)

if __name__=='__main__':unittest.main()
