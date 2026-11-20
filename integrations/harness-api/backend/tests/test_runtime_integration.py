import os
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from runtime_smoke import exercise

CORE = Path(os.environ.get('ALISA_CORE_ROOT', str(Path(__file__).resolve().parents[3] / 'harness-reference/core')))


@unittest.skipUnless((CORE / 'runtime.py').is_file(), 'Set ALISA_CORE_ROOT to the installed Alisa core')
class InstalledRuntimeTests(unittest.TestCase):
    def test_actual_selector_native_source_decoder_direct_answer_and_replay(self):
        value = exercise(CORE)
        self.assertTrue(value['no_final_model'])
        self.assertTrue(value['replay_no_dispatch'])
        self.assertEqual(value['operations'], ['template_select', 'ozon_orders'])
        self.assertEqual(value['metadata']['selector_calls'], 1)
        self.assertEqual(value['metadata']['provider_calls'], 1)
        self.assertEqual(value['usage']['prompt_cache_hit_tokens'], 80)
        self.assertEqual(value['presentation']['summary'], value['text'])
        self.assertNotIn('Проверочные цифры', value['text'])
        self.assertNotIn('Скажите', value['text'])

    def test_native_clarification_keeps_original_job_and_no_final_model(self):
        value = exercise(CORE, clarification=True)
        self.assertEqual(value['operations'], ['template_select', 'template_select', 'ozon_orders'])
        self.assertEqual(value['metadata']['selector_calls'], 2)

    def test_scope_revocation_at_dispatch_stops_provider(self):
        value = exercise(CORE, revoke_before_provider=True)
        self.assertTrue(value['revocation_stopped'])

    def test_completed_result_reopens_after_restart_with_current_owner_session(self):
        value = exercise(CORE, restart_before_read=True)
        self.assertTrue(value['replay_no_dispatch'])
        self.assertEqual(value['operations'], ['template_select', 'ozon_orders'])

    def test_pending_clarification_reopens_after_restart_without_auto_replay(self):
        value = exercise(CORE, clarification=True, restart_before_read=True)
        self.assertEqual(value['operations'], ['template_select', 'template_select', 'ozon_orders'])


if __name__ == '__main__':
    unittest.main()
