import json,unittest
from datetime import date
from pathlib import Path
from semantics import parse,make_plan,Rejected
from providers import build
from test_runtime import SCOPE

CORPUS=json.loads((Path(__file__).parents[1]/'query_corpus.json').read_text())
class CorpusTests(unittest.TestCase):
    pass

def make_test(case):
    def test(self):
        expected=case['expected']
        if expected['route']=='P3':
            with self.assertRaises(Rejected) as ctx:parse(case['utterance'],date.fromisoformat(CORPUS['today']))
            self.assertEqual(ctx.exception.code,expected['code']);return
        result=parse(case['utterance'],date.fromisoformat(CORPUS['today']))
        self.assertEqual(result['route'],expected['route'])
        for field in ('metrics','period','platforms','group_by','command'):
            if field in expected:self.assertEqual(result[field],expected[field])
        if result['route']=='P1':
            p=make_plan(SCOPE,result,result['metrics'])
            requests=[build(p,s) for s in p['stores']]
            actual=[{'operation':r.operation,'body':r.body} for r in requests]
            self.assertEqual(actual,expected['first_physical_requests'])
    return test
for case in CORPUS['cases']:setattr(CorpusTests,'test_'+case['case_id'],make_test(case))
