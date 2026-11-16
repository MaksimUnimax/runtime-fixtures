"""Publication metadata changes preserve the admitted core and execution recipes."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from copy import deepcopy

ROOT = Path(__file__).resolve().parents[1]
FROZEN = ROOT.parents[2] / 'docs/alisa/runtime/v0.11/rt_job_r02'
spec = importlib.util.spec_from_file_location('activity_overlay', ROOT / 'question_catalog/build_overlay.py')
builder = importlib.util.module_from_spec(spec); spec.loader.exec_module(builder)
IDS = ['B14.card_views', 'B14.cart_additions']


class ActivityMetadata(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.catalog = json.loads((FROZEN/'template_catalog.json').read_text())
        self.blocks = json.loads((FROZEN/'base_blocks.json').read_text())
        self.save()

    def save(self):
        (self.root/'template_catalog.json').write_text(json.dumps(self.catalog))
        (self.root/'base_blocks.json').write_text(json.dumps(self.blocks))

    def output(self):
        return {name: json.loads(text) for name, text in builder.activity_sources(self.root).items()}

    def test_activity_axis_versions_and_unchanged_execution(self):
        result = self.output()
        for tid in IDS:
            row = result['template_catalog.json']['templates'][tid]
            self.assertEqual(row['version'], 2)
            self.assertEqual(row['input_policy']['time_axis'], 'analytics_period')
            expected = deepcopy(self.catalog['templates'][tid])
            expected['version'] = 2; expected['input_policy']['time_axis'] = 'analytics_period'
            self.assertEqual(row, expected)
            block = next(x for x in result['base_blocks.json']['entries'] if x['id'] == tid)
            self.assertEqual(block['time_axis'], 'analytics_period')

    def test_all_other_templates_and_opaque_parameters_survive(self):
        for n in range(3):
            self.catalog['templates']['preserved.'+str(n)] = {'opaque_parameter': [n, {'future': True}]}
        self.assertEqual(len(self.catalog['templates']), 88)
        self.save(); result = self.output()['template_catalog.json']
        self.assertEqual(len(result['templates']), 88)
        for tid, row in self.catalog['templates'].items():
            if tid not in IDS: self.assertEqual(result['templates'][tid], row)
        for key in self.catalog:
            if key != 'templates': self.assertEqual(result[key], self.catalog[key])

    def test_real_order_cohort_axis_is_preserved(self):
        result = self.output()['template_catalog.json']['templates']
        for tid in ['B01.ordered_units', 'B04.buyout_units_cohort', 'B04.cancelled_units_cohort']:
            self.assertEqual(result[tid], self.catalog['templates'][tid])
            self.assertEqual(result[tid]['input_policy']['time_axis'], 'order_period')

    def test_future_version_cannot_be_downgraded(self):
        self.catalog['templates'][IDS[0]]['version'] = 3; self.save()
        with self.assertRaisesRegex(ValueError, 'ACTIVITY_CONTEXT_MOVED'): self.output()

    def test_changed_source_cannot_be_relabelled(self):
        self.catalog['templates'][IDS[0]]['steps'][0]['operation'] = 'changed_source'; self.save()
        with self.assertRaisesRegex(ValueError, 'ACTIVITY_CONTEXT_MOVED'): self.output()

    def test_changed_period_binding_is_rejected(self):
        self.catalog['templates'][IDS[0]]['steps'][0]['params']['$fn'][1]['selectedPeriod']['start'] = 'other'; self.save()
        with self.assertRaisesRegex(ValueError, 'ACTIVITY_CONTEXT_MOVED'): self.output()

    def test_overlay_preserves_frozen_inputs_and_manifest(self):
        before = {str(p.relative_to(FROZEN)): p.read_bytes() for p in FROZEN.rglob('*')
                  if p.is_file() and '__pycache__' not in p.parts}
        target = self.root/'candidate'; builder.build(FROZEN, target)
        catalog = json.loads((target/'template_catalog.json').read_text())
        self.assertEqual(catalog['templates'][IDS[0]]['input_policy']['time_axis'], 'analytics_period')
        manifest = json.loads((target/'CURRENT_CORE_MANIFEST.json').read_text())
        for name, digest in manifest['files'].items():
            self.assertEqual(hashlib.sha256((target/name).read_bytes()).hexdigest(), digest)
            if name not in {'template_catalog.json', 'base_blocks.json', 'question_catalog_extension.py', 'runtime_port_service.py'}:
                self.assertEqual((target/name).read_bytes(), before[name])
        for name, raw in before.items(): self.assertEqual((FROZEN/name).read_bytes(), raw)
