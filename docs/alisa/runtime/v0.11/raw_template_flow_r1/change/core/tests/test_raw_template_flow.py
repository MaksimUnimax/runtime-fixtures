"""Whole template execution with fake IO; no linguistic pre-filter is allowed."""
from contextlib import ExitStack
from unittest.mock import patch
from copy import deepcopy
import json
import unittest
import dialogue
from test_template_only import selection, TEXT
import test_template_only as fixtures
from semantics import strict_json, fingerprint
from test_runtime import TODAY
from station_status import status

class RawTemplateFlow(unittest.TestCase):
 setUp=fixtures.Pilot.setUp
 tearDown=fixtures.Pilot.tearDown
 ask=fixtures.Pilot.ask
 finish=fixtures.Pilot.finish
 def test_original_text_reaches_both_models_without_old_word_parsers(self):
  question='  ДайПродажи SKU «Ёж-AbC» за вчеар.  Сравни условия! '
  self.transport.selection=selection(['B01.ordered_units'])
  with ExitStack() as stack:
   for name in ('_normalize_request','_choice','_short_date','_event_axis','_clarifiable'):
    stack.enter_context(patch.object(dialogue,name,side_effect=AssertionError('legacy parser called')))
   row=self.finish(self.ask(question))
  self.assertEqual(row['state'],'READY',row['error'])
  self.assertEqual(strict_json(row['draft'])['question'],question)
  self.assertEqual(self.transport.calls[0].body['context']['original_question'],question)
  final=[x['content'] for x in self.transport.calls[-1].body['messages']]
  self.assertTrue(any(question in text for text in final),final)
  self.assertEqual([r.operation for r in self.transport.calls],['template_select','ozon_orders','model_answer'])
 def test_short_business_text_reaches_selector_instead_of_missing_clarification(self):
  for i,q in enumerate(('Заказы','Вчера','по дате заказа','8 ноября','Что ты умеешь')):
   with self.subTest(question=q):
    self.transport.selection={'action':'unsupported','reason':'insufficient conditions','missing':['period or metric'],'reply':TEXT}
    before=len(self.transport.calls);row=self.finish(self.ask(q))
    self.assertEqual(row['error'],'TEMPLATE_NOT_FOUND')
    self.assertEqual([r.operation for r in self.transport.calls[before:]],['template_select'])
    self.assertEqual(self.transport.calls[-1].body['context']['original_question'],q)
 def test_raw_text_receipt_replay_does_not_repeat_model_or_api(self):
  q=' Заказы SKU Ёж-AbC  за вчера '
  a=self.ask(q);row=self.finish(a);before=len(self.transport.calls)
  replay=self.engine.safe_submit('A',q,str(self.seq),fingerprint(q),TODAY,conversation_id='template-test-session',message_id=self.seq)
  self.assertEqual(replay,a);self.assertEqual(len(self.transport.calls),before)
  changed=self.engine.safe_submit('A',q.lower(),str(self.seq),fingerprint(q.lower()),TODAY,conversation_id='template-test-session',message_id=self.seq)
  self.assertEqual(changed['error'],'CHANGED_REPLAY')
 def test_legacy_pending_job_cannot_call_old_model_parser(self):
  a=self.ask('Заказы за вчера')
  with self.repo.connection(True) as c:c.execute('UPDATE jobs SET plan=NULL WHERE id=?',(a['job_id'],))
  row=self.finish(a)
  self.assertEqual(row['state'],'FAILED');self.assertEqual(row['error'],'TEMPLATE_LEGACY_JOB_DISABLED');self.assertEqual(self.transport.calls,[])
 def test_legacy_compiled_root_cannot_execute_api_or_final_model(self):
  a=self.ask('Заказы за вчера');self.worker.step()
  row=self.repo.get('A',a['job_id']);plan=strict_json(row['plan'])
  with self.repo.connection(True) as c:c.execute('UPDATE jobs SET plan=? WHERE id=?',(json.dumps(plan['fragments'][0]['plan']),a['job_id']))
  row=self.finish(a)
  self.assertEqual(row['state'],'FAILED');self.assertEqual(row['error'],'TEMPLATE_LEGACY_JOB_DISABLED')
  self.assertEqual([r.operation for r in self.transport.calls],['template_select'])
 def test_invalid_selection_is_distinct_from_missing_template_on_delivery(self):
  self.transport.selection='{"broken"';row=self.finish(self.ask('Сколько заказов?'))
  self.assertEqual(row['error'],'TEMPLATE_EXECUTION_FAILED')
  reply=status(self.engine,{'op':'station_status','tenant':'A','conversation_id':'template-test-session','job_id':row['id']})
  self.assertNotEqual(reply['text'],TEXT);self.assertIn('ошибка',reply['text'])
  self.assertEqual(reply['model_result']['status'],'TEMPLATE_EXECUTION_FAILED')
  self.assertEqual(len(self.transport.calls),1)
 def test_plan_control_on_template_job_never_reads_legacy_period_fields(self):
  a=self.ask('Заказы за вчера');self.worker.step()
  result=self.ask('план запроса')
  self.assertIn('SUMMARY.43',result['text']);self.assertEqual(len(self.transport.calls),1)
 def test_exit_cancels_current_reader_without_paid_model_request(self):
  a=self.ask('Заказы за вчера');result=self.ask('Выход')
  self.assertTrue(result.get('end_session'));self.assertNotIn('job_id',result)
  self.assertEqual(self.repo.get('A',a['job_id'])['state'],'CANCELLED');self.assertEqual(self.transport.calls,[])
