"""Retarget the reviewed web installer without changing its executable controls."""
import ast
from copy import deepcopy
from pathlib import Path
import unittest

ROOT = Path(__file__).parent
ALLOWED = {'SOURCE', 'TAR_SHA', 'ROOT', 'PAYLOAD', 'TAR', 'BASE', 'APP', 'PINS'}


def assignments(tree):
    return {n.targets[0].id: n.value for n in tree.body
            if isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name)}


def code_without_retarget(tree):
    tree = deepcopy(tree)
    if tree.body and isinstance(tree.body[0], ast.Expr) and isinstance(tree.body[0].value, ast.Constant) and isinstance(tree.body[0].value.value, str):
        tree.body.pop(0)  # Module description changes no executable control.
    tree.body = [n for n in tree.body if not (isinstance(n, ast.Assign) and len(n.targets) == 1
        and isinstance(n.targets[0], ast.Name) and n.targets[0].id in ALLOWED)]
    return ast.dump(tree, include_attributes=False)


class ReviewedR5WebDriver(unittest.TestCase):
    def test_only_qualified_source_and_exact_web_base_are_retargeted(self):
        old = ast.parse((ROOT/'install_wb_activity_web_20261116.py').read_text())
        new = ast.parse((ROOT/'install_r5_preview_web_20261116.py').read_text())
        before, after = assignments(old), assignments(new)
        changed = {k for k in before if ast.dump(before[k]) != ast.dump(after[k])}
        self.assertEqual(changed, ALLOWED)
        self.assertTrue(code_without_retarget(old) == code_without_retarget(new), 'Reviewed executable controls changed')
        self.assertEqual(ast.literal_eval(after['SOURCE']), '5e5e8cc8922342cab0bed90073da6942a5b8f284')
        self.assertEqual(ast.literal_eval(after['TAR_SHA']), '85dd68454485cf0c54e65887e5ad3c067509531d94f7a6cee9bce19e8b8ab739')
        expected = {
            'ROOT': "Path('/root/alisa-r5-preview-web-install-20261116')",
            'PAYLOAD': "Path('/dev/shm/alisa-r5-preview-5e5e8cc8/payload/platform/alisa-5e5e8cc8922342ca')",
            'TAR': "PAYLOAD.parents[2]/'alisa-5e5e8cc8922342ca.tar.gz'",
            'BASE': "STAGE/'releases/alisa-wb-activity-e0a10bb47fe1cd83'",
            'APP': "STAGE/'releases/alisa-r5-preview-5e5e8cc8922342ca'",
        }
        for name, expression in expected.items():
            self.assertEqual(ast.dump(after[name]), ast.dump(ast.parse(expression, mode='eval').body), name)
        pins = deepcopy(before['PINS'])
        selected = [i for i,k in enumerate(pins.keys) if isinstance(k, ast.Name) and k.id == 'BASE']
        self.assertEqual(len(selected), 1)
        pins.values[selected[0]] = ast.Constant('3fd0a1d22b68678918102b5072b0bd6118481d153436569da66a09a7ca43e534')
        self.assertEqual(ast.dump(after['PINS']), ast.dump(pins))
