"""Generation refresh preserves the original source authorization; fixture-only."""
import copy
import importlib.util
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT/'products/alisa/runtime'))
sys.path.insert(0, str(ROOT/'products/alisa/runtime/tests'))
from test_native_store_binding import NativeBindingChecks
spec = importlib.util.spec_from_file_location('refresh', Path(__file__).with_name('requalify.py'))
refresh = importlib.util.module_from_spec(spec); spec.loader.exec_module(refresh)


class RefreshTests(unittest.TestCase):
    def setUp(self):
        self.fixture = NativeBindingChecks(); self.fixture.setUp()
        self.generation = {**self.fixture.generation, 'pid': 42, 'start_ticks': 201}

    def run_refresh(self, **changes):
        return refresh.renewed(changes.get('data', self.fixture.projection), changes.get('config', self.fixture.config),
                               {'ozon': changes.get('material', self.fixture.material)}, changes.get('generation', self.generation))

    def test_only_generation_and_source_mac_change(self):
        original = copy.deepcopy(self.fixture.projection)
        new = self.run_refresh()
        self.assertEqual(self.fixture.projection, original)
        self.assertEqual(new['native_generation'], self.generation)
        self.assertNotEqual(new['bindings'][0]['source_hmac'], original['bindings'][0]['source_hmac'])
        new['native_generation'] = original['native_generation']
        new['bindings'][0]['source_hmac'] = original['bindings'][0]['source_hmac']
        self.assertEqual(new, original)

    def test_same_generation_is_idempotent(self):
        self.assertEqual(self.run_refresh(generation=self.fixture.generation), self.fixture.projection)

    def test_rotated_credentials_are_not_adopted(self):
        for field in self.fixture.material:
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.run_refresh(material={**self.fixture.material, field: '456' if field == 'seller_client_id' else 'fixture-rotated-only'})

    def test_revoked_or_changed_source_is_not_adopted(self):
        config = copy.deepcopy(self.fixture.config); config['execution_enabled'] = False
        with self.assertRaises(ValueError): self.run_refresh(config=config)
        config = copy.deepcopy(self.fixture.config); config['accounts']['native-owner']['stores'][0]['source_revision'] = '2'
        with self.assertRaises(ValueError): self.run_refresh(config=config)

    def test_scope_edit_and_ambiguity_are_not_adopted(self):
        data = copy.deepcopy(self.fixture.projection); data['bindings'][0]['store_id'] = 'fixture-other-store'
        with self.assertRaises(ValueError): self.run_refresh(data=data)
        data = copy.deepcopy(self.fixture.projection); data['bindings'] *= 2
        with self.assertRaises(ValueError): self.run_refresh(data=data)

    def test_different_native_uid_is_rejected(self):
        with self.assertRaises(ValueError): self.run_refresh(generation={**self.generation, 'uid': 123456})


if __name__ == '__main__': unittest.main()
