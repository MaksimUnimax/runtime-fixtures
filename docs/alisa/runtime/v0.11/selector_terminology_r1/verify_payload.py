"""Inspect the existing complete fixture scenario; never call a live model/API."""
from test_template_integration import MixedExecution
from template_catalog import TEMPLATES
import json

case=MixedExecution('test_financial_template_executes_natural_question_with_two_model_calls')
case.setUp()
try:
    case.test_financial_template_executes_natural_question_with_two_model_calls()
    selected=next(t for t in case.transport.calls[0].body['context']['templates'] if t['id']=='B08.finance_sales')
    assert selected['purpose']==TEMPLATES['B08.finance_sales']['purpose']
    assert 'товарные начисления' in selected['purpose']
    assert 'notes' not in selected
    assert TEMPLATES['B08.finance_sales']['notes']==[]
    final=json.dumps(case.transport.calls[-1].body['messages'],ensure_ascii=False)
    assert 'товарные начисления' not in final
    assert 'ozon_finance' in final
    assert sum(c.operation in ('template_select','model_answer') for c in case.transport.calls)==2
    print(json.dumps({'state':'PASS','selector_has_metric_explanation':True,'final_model_has_no_added_speech_note':True,'original_question_and_api_data_preserved':True,'model_calls_in_fixture':2,'live_calls':0},ensure_ascii=False))
finally:
    case.tearDown()
