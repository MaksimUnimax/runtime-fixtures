import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
CORE = Path(os.environ.get('ALISA_CORE_ROOT', str(Path(__file__).resolve().parents[3] / 'harness-reference/core')))
sys.path.insert(0, str(CORE))
from runtime_adapter import AlisaPipeline


@unittest.skipUnless((CORE / 'runtime.py').is_file(), 'Set ALISA_CORE_ROOT to the installed Alisa core')
class UsageTests(unittest.TestCase):
    def usage(self, receipts):
        from repository import Repository
        with tempfile.TemporaryDirectory() as directory:
            repo = Repository(str(Path(directory) / 'usage.sqlite3'))
            with repo.connection(True) as connection:
                connection.execute('CREATE TABLE rt_job_refs(ref TEXT,jid TEXT)')
                connection.execute("INSERT INTO rt_job_refs VALUES('ref','job')")
                connection.execute("INSERT INTO jobs(id,tenant,key,state,plan,draft,created,updated,due) VALUES('job','test','key','READY',?,?,1,1,1)",
                    (json.dumps({'selection': {'invocations': []}}), json.dumps({'selector_prompt': {'layout': 'catalog_prefix_v2'}})))
                for receipt in receipts:
                    connection.execute('INSERT INTO calls(jid,source,state,dispatched,model_usage,model_context) VALUES(?,?,?,?,?,?)',
                        ('job', 'model:deepseek-flash', 'RECEIVED', 1,
                         None if receipt is None else json.dumps({'usage': receipt}),
                         json.dumps({'stage': 'template_select', 'prompt_layout': 'catalog_prefix_v2'})))
            return AlisaPipeline._usage(SimpleNamespace(repo=repo, catalog_hash='fixture'), 'ref', 0)

    def test_missing_receipt_keeps_answer_usable_and_usage_unknown(self):
        usage, meta = self.usage([None, {'prompt_tokens': 100, 'completion_tokens': 20,
                                      'prompt_cache_hit_tokens': 80, 'prompt_cache_miss_tokens': 20}])
        self.assertIsNone(usage)
        self.assertFalse(meta['usage_complete'])
        self.assertEqual(meta['model_calls'], 2)

    def test_one_cache_component_is_derived_from_reported_total(self):
        for fields in ({'prompt_cache_hit_tokens': 80}, {'prompt_cache_miss_tokens': 20}):
            usage, meta = self.usage([{'prompt_tokens': 100, 'completion_tokens': 20, **fields}])
            self.assertEqual(usage['prompt_cache_hit_tokens'], 80)
            self.assertEqual(usage['prompt_cache_miss_tokens'], 20)
            self.assertTrue(meta['usage_complete'])

    def test_unknown_or_inconsistent_cache_is_not_reported_as_zero(self):
        for fields in ({}, {'prompt_cache_hit_tokens': 80, 'prompt_cache_miss_tokens': 80}):
            usage, meta = self.usage([{'prompt_tokens': 100, 'completion_tokens': 20, **fields}])
            self.assertIsNone(usage)
            self.assertFalse(meta['usage_complete'])


if __name__ == '__main__':
    unittest.main()
