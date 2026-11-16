"""Only exact package, active web base and authority pin change in reviewed web controls."""
import ast
from copy import deepcopy
from pathlib import Path
import types,hashlib
from unittest.mock import patch
import test_install_question_catalog_period_20261116 as reviewed
import unittest

class ReviewedBoundWebDriver(unittest.TestCase):
    def test_retarget_keeps_all_executable_controls(self):
        root = Path(__file__).parent
        old = ast.parse((root/'install_r5_preview_web_20261116.py').read_text())
        new = ast.parse((root/'install_r5_bound_web_20261116.py').read_text())
        allowed = {'SOURCE','TAR_SHA','ROOT','PAYLOAD','TAR','BASE','APP','PINS','EFFECTIVE_BASES','AUTHORITY_ARGV_SHA','PREPARATION_PLAN'}
        def strip(tree):
            tree = deepcopy(tree)
            tree.body = [n for n in tree.body if not (isinstance(n,ast.Assign) and len(n.targets)==1 and isinstance(n.targets[0],ast.Name) and n.targets[0].id in allowed)]
            tree.body = [n for n in tree.body if not (isinstance(n,ast.FunctionDef) and n.name=='require_authority_source')]
            for n in tree.body:
                if isinstance(n,ast.FunctionDef) and n.name=='capture' and isinstance(n.body[0],ast.Expr) and isinstance(n.body[0].value,ast.Call) and isinstance(n.body[0].value.func,ast.Name) and n.body[0].value.func.id=='require_authority_source':n.body.pop(0)
            return ast.dump(tree,include_attributes=False)
        old_functions = {n.name:n for n in old.body if isinstance(n,ast.FunctionDef)}
        new_functions = {n.name:n for n in new.body if isinstance(n,ast.FunctionDef)}
        for name in set(old_functions)-{'capture','prepare','main'}:
            self.assertEqual(ast.dump(old_functions[name]),ast.dump(new_functions[name]),name)
        captured = deepcopy(new_functions['capture']);captured.body.pop(0)
        self.assertEqual(ast.dump(captured),ast.dump(old_functions['capture']))
        expected_main = ast.get_source_segment((root/'install_r5_preview_web_20261116.py').read_text(),old_functions['main']).replace(
            "        if sys.argv[1:] == ['prepare']:",
            "        if sys.argv[1:] == ['recover-preparation']:\n            recover_preparation()\n        elif sys.argv[1:] == ['prepare']:")
        self.assertEqual(ast.dump(ast.parse(expected_main).body[0]),ast.dump(new_functions['main']))
        authority = ast.parse((root/'install_r5_bound_authority_20261116.py').read_text())
        authority_functions = {n.name:n for n in authority.body if isinstance(n,ast.FunctionDef)}
        for name in ['publish_record','remove_owned','discard_owned','stage_candidate','recover_preparation']:
            self.assertEqual(ast.dump(authority_functions[name]),ast.dump(new_functions[name]),name)
        self.assertTrue(any(isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='stage_candidate' for n in ast.walk(new_functions['prepare'])))
        def assignments(t):
            return {n.targets[0].id:n.value for n in t.body if isinstance(n,ast.Assign) and len(n.targets)==1 and isinstance(n.targets[0],ast.Name)}
        a,b = assignments(old),assignments(new)
        self.assertEqual({k for k in a if ast.dump(a[k])!=ast.dump(b[k])} | (set(b)-set(a)),allowed)
        self.assertEqual(ast.literal_eval(b['SOURCE']),'3f2527482db8fd7edb240258fae814d38adc0f4f')
        self.assertEqual(ast.literal_eval(b['TAR_SHA']),'6950fc60b22fd574991342c13a9803b145faa4b5f9cf60f915f7e6255c447927')
        expected = {
          'ROOT':"Path('/root/alisa-r5-bound-web-install-20261116')",
          'PAYLOAD':"Path('/dev/shm/alisa-r5-bound-3f252748/payload/platform/alisa-3f2527482db8fd7e')",
          'TAR':"PAYLOAD.parents[2]/'alisa-3f2527482db8fd7e.tar.gz'",
          'BASE':"STAGE/'releases/alisa-r5-preview-5e5e8cc8922342ca'",
          'APP':"STAGE/'releases/alisa-r5-bound-3f2527482db8fd7e'",
        }
        for k,v in expected.items():self.assertEqual(ast.dump(b[k]),ast.dump(ast.parse(v,mode='eval').body),k)
        pins = deepcopy(a['PINS'])
        for i,k in enumerate(pins.keys):
            if isinstance(k,ast.Name) and k.id=='BASE':
                pins.values[i] = ast.Constant('789db7da63a5b40f65adbe0441757ceece13a1faf6538ada000ca20323396655')
            elif ast.unparse(k)=="STAGE / 'releases/alisa-parameters-1d572aebf6b05b88'":
                pins.keys[i] = ast.parse("STAGE/'releases/alisa-bound-period-3f2527482db8fd7e'",mode='eval').body
                pins.values[i] = ast.Constant('a799633b5defcc6a0a59f4eebe4c35a82b55672ed7c5f40a8d90d375a3727d16')
        self.assertEqual(ast.dump(b['PINS']),ast.dump(pins))
        effective = deepcopy(a['EFFECTIVE_BASES'])
        for i,k in enumerate(effective.keys):
            if ast.literal_eval(k)=='alisa-runtime-authority-stage.service':
                effective.values[i] = ast.parse("STAGE/'releases/alisa-bound-period-3f2527482db8fd7e/services/platform'",mode='eval').body
        self.assertEqual(ast.dump(b['EFFECTIVE_BASES']),ast.dump(effective))


class BoundWebRollbackBoundaries(reviewed.RolloutBoundaries):
    def setUp(self):
        super().setUp()
        path = Path(__file__).with_name('install_r5_bound_web_20261116.py')
        tree = ast.parse(path.read_text())
        functions = [n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in {'select','apply','need','baseline_tree'}]
        exec(compile(ast.Module(body=functions,type_ignores=[]),str(path),'exec'),self.g)

class BoundWebCommandBoundary(unittest.TestCase):
    def test_expected_working_directory_cannot_hide_wrong_authority_command(self):
        path = Path(__file__).with_name('install_r5_bound_web_20261116.py')
        tree = ast.parse(path.read_text())
        functions = [n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in {'require_authority_source','need'}]
        expected = '/pinned/.venv/bin/python -c sys.path.insert(0,pinned_src)'
        h = types.SimpleNamespace(static=lambda u:{'argv':expected})
        g = {'h':h,'hashlib':hashlib,'AUTHORITY_ARGV_SHA':hashlib.sha256(expected.encode()).hexdigest()}
        exec(compile(ast.Module(body=functions,type_ignores=[]),str(path),'exec'),g)
        g['require_authority_source']()
        with patch.object(h,'static',lambda u:{'argv':'/wrong/python -c wrong_src'}):
            with self.assertRaisesRegex(RuntimeError,'AUTHORITY_COMMAND_CHANGED'):g['require_authority_source']()
        values = {n.targets[0].id:n.value for n in tree.body if isinstance(n,ast.Assign) and len(n.targets)==1 and isinstance(n.targets[0],ast.Name)}
        self.assertEqual(ast.literal_eval(values['AUTHORITY_ARGV_SHA']),'41938fad3bdbb9877f6704c7a3ebde35bbef7b263838b725a117caeec8ab7e6c')
        capture = next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='capture')
        self.assertEqual(ast.unparse(capture.body[0]),'require_authority_source()')

if __name__=='__main__':unittest.main()
