"""Fault injection at the two externally observable cutover publication edges."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


class InterruptedPublication(unittest.TestCase):
    def exercise(self, edge):
        spec = importlib.util.spec_from_file_location('cutover_under_test', Path(__file__).with_name('activate.py'))
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            m.B = root/'base'; m.B.mkdir()
            m.T = m.B/'new'; m.T.mkdir()
            old = m.B/'old'; old.mkdir()
            (m.B/'web-current').symlink_to(old)
            m.D = root/'evidence'; m.D.mkdir()
            m.E = root/'private.env'
            m.DROPS = {u: root/(str(i)+'.conf') for i,u in enumerate(m.UNITS)}
            (m.T/'manifest.json').write_text('{}')
            alice = {'ALISA_ALICE_CLIENT_ID':'fixture','ALISA_ALICE_CLIENT_SECRET':'fixture-secret',
                     'ALISA_ALICE_SKILL_ID':'fixture-skill','ALISA_ALICE_LINK_ENABLED':'1'}
            before = {'pointers':{'web-current':str(old)}}
            (m.D/'activation.private.json').write_text(json.dumps({'before':before,
                'manifest':m.sha(m.T/'manifest.json'),'alice':alice}))
            native = {'LAB_OAUTH_CLIENT_ID':'fixture','LAB_OAUTH_CLIENT_SECRET':'fixture-secret',
                      'ALICE_SKILL_ID':'fixture-skill'}
            actual_link = m.link
            actual_publish = m.os.link
            injected = []

            def interrupt_pointer(target, suffix):
                actual_link(target,suffix)
                if suffix == 'alice-link-r1':
                    injected.append(edge)
                    raise InterruptedError('signal after actual pointer replacement')

            def interrupt_drop(src, dst, **kw):
                actual_publish(src,dst,**kw)
                if dst == m.DROPS[m.UNITS[0]]:
                    injected.append(edge)
                    # The full file is visible but fresh() has not returned.
                    self.assertEqual(Path(dst).read_bytes(),b'[Service]\nEnvironment=ALISA_ALICE_LINK_ENABLED=1\n')
                    raise InterruptedError('signal after atomic drop-in publication')

            with patch.object(m,'trusted'), patch.object(m,'resources'), patch.object(m,'verify_source'), \
                 patch.object(m,'config',return_value=native), patch.object(m,'snapshot',return_value=before), \
                 patch.object(m,'cmd',return_value='inactive'), patch.object(m,'db',return_value={'mode':'apply'}), \
                 patch.object(m,'link',side_effect=interrupt_pointer if edge=='pointer' else actual_link), \
                 patch.object(m.os,'link',side_effect=interrupt_drop if edge=='dropin' else actual_publish):
                with self.assertRaises(InterruptedError):
                    m.activate()
            self.assertEqual(injected,[edge])
            self.assertEqual((m.B/'web-current').resolve(),old)
            self.assertTrue(all(not p.exists() for p in m.DROPS.values()))
            self.assertTrue(m.E.is_file(),'private additive key material must remain')
            self.assertEqual(m.record['recovery'],'PRIOR_WEB_API_RESTORED_ADDITIVE_SCHEMA_AND_PRIVATE_KEY_RETAINED')
            self.assertFalse(list(root.rglob('*.s06-*')),'no untracked partial publication')

    def test_signal_after_pointer_before_flag_assignment(self):
        self.exercise('pointer')

    def test_signal_after_dropin_before_fresh_returns(self):
        self.exercise('dropin')


if __name__ == '__main__':
    unittest.main()
