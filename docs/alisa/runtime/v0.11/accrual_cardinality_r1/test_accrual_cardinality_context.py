"""The final model receives canonical identity semantics and unmodified source data."""
import json,unittest
from copy import deepcopy
from unittest.mock import patch
import template_catalog as tc
import dataset_pipeline as dp
from semantics import strict_json
import test_template_integration as integration
from test_template_only import selection,INPUT

class ContextDelivery(unittest.TestCase):
    setUp=integration.MixedExecution.setUp
    tearDown=integration.MixedExecution.tearDown
    run_request=integration.MixedExecution.run_request

    def check_context(self,data):
        contracts=data['calculation_context']
        self.assertEqual(len(contracts),1)
        self.assertEqual(contracts[0]['selected_template_id'],'accrual_items')
        contract=contracts[0]['contract']
        self.assertEqual(contract,tc.TEMPLATES['accrual_items']['calculation_contract'])
        self.assertEqual(contract['source_recipe_sha256'],dp.SOURCES.fingerprint('ds_ozon_accrual_rows'))
        self.assertEqual(data['responses'][0]['operation'],'ds_ozon_accrual_rows')
        raw=data['responses'][0]['data']['accruals'][0]['posting']['products'][0]
        self.assertEqual(raw['sku'],101)
        self.assertIn('commission',raw)
        self.assertEqual(raw['quantity'],2)
        self.assertNotIn('expected_cardinality',data)

    def test_direct_model_wire_retains_raw_data_and_supplies_contract(self):
        self.transport.selection=selection(['accrual_items'],inputs=deepcopy(INPUT))
        question='По скольким SKU были товарные начисления за второе ноября?'
        row=self.run_request(question)
        self.assertEqual(row['state'],'READY',row['error'])
        self.assertIsNone(row['error'])
        request=next(r for r in self.transport.calls if r.operation=='model_answer')
        data=json.loads(request.body['messages'][-1]['content'].split('\n',1)[1])
        self.check_context(data)
        self.assertIn(question,[m['content']for m in request.body['messages']])
        selector=next(r for r in self.transport.calls if r.operation=='template_select')
        self.assertNotIn('alisa-accrual-items-cardinality/v1',json.dumps(selector.body,ensure_ascii=False))
        self.assertEqual([r.operation for r in self.transport.calls],['template_select','ds_ozon_accrual_rows','model_answer'])

    def test_program_lane_gets_same_contract_and_original_question(self):
        self.engine.program_answers=True
        self.transport.selection=selection(['accrual_items'],inputs=deepcopy(INPUT))
        captured=[]
        def program(worker,row,messages,api_data,**kwargs):
            captured.append((messages,deepcopy(api_data)))
            kwargs['on_complete']({'content':'Проверка передачи контекста.','finish_reason':'stop'})
        question='Сколько разных SKU в товарных начислениях за второе ноября?'
        with patch('model_program.selected',return_value=True),patch('model_program.run',side_effect=program):
            row=self.run_request(question)
        self.assertEqual(row['state'],'READY',row['error'])
        self.assertIsNone(row['error'])
        self.assertEqual(len(captured),1)
        messages,data=captured[0]
        self.check_context(data)
        self.assertIn(question,[m['content']for m in messages])
        self.assertEqual([r.operation for r in self.transport.calls],['template_select','ds_ozon_accrual_rows'])

if __name__=='__main__':unittest.main()
