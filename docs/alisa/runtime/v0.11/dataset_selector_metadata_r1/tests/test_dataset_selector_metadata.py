"""Dataset semantics survive the actual selector wire without granting new IO."""
from copy import deepcopy
from unittest.mock import patch
import json,unittest
import template_catalog as tc
import template_protocol as protocol
import selector_policy as policy
from test_selector_prefix_cache import body,wire,decode_v2
import test_template_only as fixture
from test_template_only import selection

class DatasetView(unittest.TestCase):
    def test_campaign_id_reaches_provider_and_availability_stays_dynamic(self):
        context=body('Сколько рекламных кампаний WB сейчас всего?')
        static,dynamic=decode_v2(wire(context))
        row=next(r for r in static['templates']if r['id']=='wb_campaign_inventory')
        self.assertEqual(row['dataset_output']['columns'],[
            {'field':'campaign_id','label':'ID кампании','kind':'number'},
            {'field':'status','label':'статус источника','kind':'number'}])
        self.assertNotIn('available_stores',row)
        self.assertEqual(dynamic['template_availability'][row['id']],[])
        self.assertEqual(dynamic['original_question'],context['context']['original_question'])

    def test_old_discovery_rows_still_roundtrip(self):
        b=body()
        for r in b['context']['templates']:r.pop('dataset_output',None)
        static,dynamic=decode_v2(wire(b))
        restored=[{**r,'available_stores':dynamic['template_availability'][r['id']]}for r in static['templates']]
        self.assertEqual(sorted(restored,key=lambda r:r['id']),sorted(b['context']['templates'],key=lambda r:r['id']))

    def test_projection_excludes_notes_and_execution_secrets(self):
        t=tc.TEMPLATES['wb_campaign_inventory'];column=t['columns'][0]
        with patch.dict(t,{'notes':['PRIVATE_NOTE_SENTINEL'],'credentials':'PRIVATE_SECRET_SENTINEL'}),patch.dict(column,{'source_path':'PRIVATE_PATH_SENTINEL'}):
            serialized=json.dumps(wire(body()),ensure_ascii=False)
        for sentinel in ('PRIVATE_NOTE_SENTINEL','PRIVATE_SECRET_SENTINEL','PRIVATE_PATH_SENTINEL'):
            self.assertNotIn(sentinel,serialized)

    def test_mutating_returned_metadata_does_not_change_catalog(self):
        before=deepcopy(tc.TEMPLATES)
        view=tc.selector_catalog();r=next(r for r in view if r['id']=='accrual_items')
        r['dataset_output']['columns'][0]['label']='modified';r['dataset_output']['group_by'].append('modified')
        self.assertEqual(tc.TEMPLATES,before)

    def test_dataset_roundtrip_and_scalar_view_unchanged(self):
        b=body();s,d=decode_v2(wire(b))
        restored=[{**r,'available_stores':d['template_availability'][r['id']]}for r in s['templates']]
        self.assertEqual(sorted(restored,key=lambda r:r['id']),sorted(b['context']['templates'],key=lambda r:r['id']))
        self.assertTrue(all(('dataset_output'in r)==(r['kind']=='dataset')for r in s['templates']))

    def test_unknown_metadata_or_scalar_injection_rejected(self):
        original=body();dataset=next(r for r in original['context']['templates']if r['kind']=='dataset')
        mutations=[lambda d:d.update(operation='arbitrary_api'),
                   lambda d:d['columns'][0].update(source_path='arbitrary'),
                   lambda d:d['columns'][0].update(kind='python'),
                   lambda d:d.update(group_by=['nonexistent']),
                   lambda d:d.update(stage=[])]
        for mutate in mutations:
            b=deepcopy(original);row=next(r for r in b['context']['templates']if r['id']==dataset['id']);mutate(row['dataset_output'])
            with self.subTest(metadata=row['dataset_output']),self.assertRaises(ValueError):wire(b)
        b=deepcopy(original);scalar=next(r for r in b['context']['templates']if r['kind']=='scalar');scalar['dataset_output']=deepcopy(dataset['dataset_output'])
        with self.assertRaises(ValueError):wire(b)

class WorkerWire(unittest.TestCase):
    setUp=fixture.Pilot.setUp
    tearDown=fixture.Pilot.tearDown
    ask=fixture.Pilot.ask
    def test_native_worker_http_payload_contains_semantics_and_preserves_clarification(self):
        from http_transport import HTTPTransport
        self.engine.selector_policy=lambda:{'layout':policy.PREFIX,'isolation':'tenant_v1'}
        a=self.ask('Сколько рекламных кампаний WB сейчас всего?');sent=[]
        envelope={'model':'deepseek-flash','choices':[{'message':{'content':json.dumps(selection())},'finish_reason':'stop'}]}
        def received(request,**kwargs):
            sent.append(json.loads(request.data))
            if kwargs.get('on_dispatch'):kwargs['on_dispatch']()
            return json.dumps(envelope).encode(),200
        transport=HTTPTransport('/no-real-credentials',{}, {},enabled=True)
        with patch.object(transport,'_credential',return_value='synthetic-only'),patch('http_transport.read_response',side_effect=received):
            __import__('engine').Worker(self.engine,transport).step()
        self.assertEqual(len(sent),1)
        static,dynamic=decode_v2(sent[0]);row=next(r for r in static['templates']if r['id']=='wb_campaign_inventory')
        self.assertIn('campaign_id',{c['field']for c in row['dataset_output']['columns']})
        self.assertEqual(dynamic['original_question'],'Сколько рекламных кампаний WB сейчас всего?')
        clarification=body();clarification['context']['clarification_supported']=True;clarification['system']=protocol.selection_system(clarification['context'])
        clarified=wire(clarification)
        self.assertIn('"action":"clarify"',clarified['messages'][0]['content'])
        self.assertIn('dataset_output',clarified['messages'][0]['content'])

    def test_output_metadata_does_not_authorize_new_input_filters(self):
        self.transport.selection=selection(['wb_campaign_inventory'],'wb1',{'period':None,'filters':{'status':9},'comparison':None,'group_by':'marketplace'})
        from test_template_integration import dataset_caps
        self.engine.dataset_capabilities=dataset_caps
        row=fixture.Pilot.finish(self,self.ask('Кампании со статусом девять'))
        self.assertEqual(row['error'],'TEMPLATE_EXECUTION_FAILED')
        self.assertEqual([r.operation for r in self.transport.calls],['template_select'])

if __name__=='__main__':unittest.main()
