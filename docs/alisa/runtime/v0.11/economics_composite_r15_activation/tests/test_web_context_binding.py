"""Freeze the observed preview WEB context without changing product source or other roles."""
from copy import deepcopy
from pathlib import Path
import hashlib
import json
import sys
import unittest

HERE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(HERE))
import activation_contract as c

class WebContextBinding(unittest.TestCase):
    def baseline(self):
        return json.loads((HERE.with_name('economics_composite_r15_release')/'baseline_20261115.json').read_bytes())

    def test_exact_preview_web_and_only_three_observed_binding_leaves(self):
        value=self.baseline()
        self.assertEqual(value['bases']['web'], {
            'root':'/opt/alisa-platform/stage/releases/alisa-r5-preview-5e5e8cc8922342ca',
            'manifest_sha256':'789db7da63a5b40f65adbe0441757ceece13a1faf6538ada000ca20323396655',
            'venv_link':'/opt/alisa-platform/stage/releases/alisa-wb-activity-e0a10bb47fe1cd83/.venv'})
        del value['bases']['web']
        self.assertEqual(c.canonical_hash(value), NONWEB_HASH)

    def test_extended_builder_cannot_reuse_historical_activation_contract(self):
        root=HERE.with_name('economics_composite_r15_release')
        actual={n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in c.BUILD_TOOLS}
        changed={n for n in actual if actual[n]!=c.BUILD_TOOLS[n]}
        self.assertEqual(changed,{'release_contract.py'})
        self.assertEqual(c.BUILD_TOOLS['release_contract.py'],
                         'b070a29b1bc27edb159875c67c48781b9ede3d9f0dd8ee26884be71674fa2020')
        with self.assertRaises(c.Blocked) as error:
            c.product_identity({'source_commit':c.PRODUCT,'tool_files':actual},
                               {'source_commit':c.PRODUCT})
        self.assertEqual(error.exception.code,'BUILDER_CHANGED')
        self.assertEqual(c.PRODUCT,'cafb743c94672104d4afa2c471398e5c81d904f5')
        self.assertEqual(c.SOURCE_INDEX,'7342caa174709952744104dd156e38441c0caf15a01bc7442043dca100623562')
        self.assertEqual(c.PRODUCT_PLAN,'982d137e067c533374e7254b5ac04008d0f7483e4c38c45e8d98f97e268ba422')

    def test_former_plan_and_baseline_hash_are_not_current(self):
        self.assertNotEqual(c.PRODUCT_PLAN,'733a2d1ded5702f4233524263946a41e14bf26428f8adc7519d4ab5432501616')
        self.assertNotEqual(c.BUILD_TOOLS['baseline_20261115.json'],'86fba9b040912c9a6b35b8ac116d7b6634c0c321c3471bc72dc7656fc1c5cdce')

    def test_unrelated_native_or_publisher_delta_does_not_match_preserved_scope(self):
        for role in ('native','platform','authority'):
            value=self.baseline();del value['bases']['web'];value['bases'][role]['manifest_sha256']='0'*64
            self.assertNotEqual(c.canonical_hash(value),NONWEB_HASH)
        value=self.baseline();del value['bases']['web'];value['publisher']['sha256']='0'*64
        self.assertNotEqual(c.canonical_hash(value),NONWEB_HASH)

NONWEB_HASH='75bf5987956042bd8c912a24a59128b327013375728e3b4c7488abfe68cce866'
if __name__=='__main__':unittest.main()
