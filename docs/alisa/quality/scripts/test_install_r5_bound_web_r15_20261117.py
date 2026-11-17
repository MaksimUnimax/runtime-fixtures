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
        new = ast.parse((root/'install_r5_bound_web_r15_20261117.py').read_text())
        allowed = {'SOURCE','TAR_SHA','ROOT','PAYLOAD','TAR','BASE','APP','PINS','EFFECTIVE_BASES','AUTHORITY_ARGV_SHA','PREPARATION_PLAN','API','DEPENDENCY_BASE'}
        def strip(tree):
            tree = deepcopy(tree)
            tree.body = [n for n in tree.body if not (isinstance(n,ast.Assign) and len(n.targets)==1 and isinstance(n.targets[0],ast.Name) and n.targets[0].id in allowed)]
            tree.body = [n for n in tree.body if not (isinstance(n,ast.FunctionDef) and n.name=='require_authority_source')]
            for n in tree.body:
                if isinstance(n,ast.FunctionDef) and n.name=='capture' and isinstance(n.body[0],ast.Expr) and isinstance(n.body[0].value,ast.Call) and isinstance(n.body[0].value.func,ast.Name) and n.body[0].value.func.id=='require_authority_source':n.body.pop(0)
            return ast.dump(tree,include_attributes=False)
        old_functions = {n.name:n for n in old.body if isinstance(n,ast.FunctionDef)}
        new_functions = {n.name:n for n in new.body if isinstance(n,ast.FunctionDef)}
        for name in set(old_functions)-{'capture','prepare','main','read_plan','apply'}:
            self.assertEqual(ast.dump(old_functions[name]),ast.dump(new_functions[name]),name)
        class StripCandidateGuard(ast.NodeTransformer):
            def visit_Expr(self,node):
                if isinstance(node.value,ast.Call) and isinstance(node.value.func,ast.Name) and node.value.func.id in {'require_candidate','verify_candidate','require_web_restart'}:return None
                return self.generic_visit(node)
        for name in ['read_plan','apply']:
            normalized=StripCandidateGuard().visit(deepcopy(new_functions[name]))
            self.assertEqual(ast.dump(normalized),ast.dump(old_functions[name]),name)
            self.assertGreaterEqual(sum(isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id in {'require_candidate','verify_candidate'} for n in ast.walk(new_functions[name])),2)
        captured = deepcopy(new_functions['capture']);captured.body.pop(0);captured.body.pop(0)
        self.assertEqual(ast.dump(captured),ast.dump(old_functions['capture']))
        expected_main = ast.get_source_segment((root/'install_r5_preview_web_20261116.py').read_text(),old_functions['main']).replace(
            "        if sys.argv[1:] == ['prepare']:",
            "        if sys.argv[1:] == ['recover-preparation']:\n            recover_preparation()\n        elif sys.argv[1:] == ['prepare']:")
        self.assertEqual(ast.dump(ast.parse(expected_main).body[0]),ast.dump(new_functions['main']))
        authority = ast.parse((root/'install_r5_bound_authority_20261116.py').read_text())
        authority_functions = {n.name:n for n in authority.body if isinstance(n,ast.FunctionDef)}
        for name in ['candidate_identity','require_candidate','publish_record','remove_owned','discard_owned','stage_candidate','recover_preparation']:
            self.assertEqual(ast.dump(authority_functions[name]),ast.dump(new_functions[name]),name)
        self.assertTrue(any(isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='stage_candidate' for n in ast.walk(new_functions['prepare'])))
        def assignments(t):
            return {n.targets[0].id:n.value for n in t.body if isinstance(n,ast.Assign) and len(n.targets)==1 and isinstance(n.targets[0],ast.Name)}
        a,b = assignments(old),assignments(new)
        self.assertEqual({k for k in a if ast.dump(a[k])!=ast.dump(b[k])} | (set(b)-set(a)),allowed)
        self.assertEqual(ast.literal_eval(b['SOURCE']),'3f2527482db8fd7edb240258fae814d38adc0f4f')
        self.assertEqual(ast.literal_eval(b['TAR_SHA']),'6950fc60b22fd574991342c13a9803b145faa4b5f9cf60f915f7e6255c447927')
        expected = {
          'ROOT':"Path('/root/alisa-r5-bound-web-r15-install-20261117')",
          'PAYLOAD':"Path('/dev/shm/alisa-r5-bound-3f252748/payload/platform/alisa-3f2527482db8fd7e')",
          'TAR':"PAYLOAD.parents[2]/'alisa-3f2527482db8fd7e.tar.gz'",
          'BASE':"STAGE/'releases/alisa-r5-preview-5e5e8cc8922342ca'",
          'APP':"STAGE/'releases/alisa-r5-bound-web-r15-3f2527482db8fd7e'",
        }
        for k,v in expected.items():self.assertEqual(ast.dump(b[k]),ast.dump(ast.parse(v,mode='eval').body),k)
        pin_text=ast.unparse(b['PINS'])
        self.assertIn('alisa-r5-bound-api-r15-3f2527482db8fd7e',pin_text)
        self.assertIn('fa4f9b85ebcb211e4f36a3d4dfe477f4c05af9aec2ed96d9f5a558ac73e1be53',pin_text)
        self.assertIn('alisa-economics-r15-native-cafb743c94672104',pin_text)
        self.assertNotIn('alisa-bound-period-',pin_text)
        effective={ast.literal_eval(k):ast.unparse(v) for k,v in zip(b['EFFECTIVE_BASES'].keys,b['EFFECTIVE_BASES'].values)}
        self.assertEqual(effective['alisa-platform@stage.service'],"STAGE / 'releases/alisa-r5-bound-api-r15-3f2527482db8fd7e'")
        self.assertEqual(effective['alisa-runtime-authority-stage.service'],"STAGE / 'releases/alisa-economics-r15-authority-cafb743c94672104/services/platform'")



class BoundWebRollbackBoundaries(reviewed.RolloutBoundaries):
    def setUp(self):
        super().setUp()
        self.g['require_candidate']=lambda plan:None
        self.g['verify_candidate']=lambda plan:None
        path = Path(__file__).with_name('install_r5_bound_web_r15_20261117.py')
        tree = ast.parse(path.read_text())
        functions = [n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in {'select','apply','need','baseline_tree','require_web_restart'}]
        exec(compile(ast.Module(body=functions,type_ignores=[]),str(path),'exec'),self.g)


    def candidate_drift(self,kind,before=False):
        import json
        import test_install_r5_bound_api_r15_20261117 as backend
        (self.base/'.venv').mkdir();(self.app/'.venv').symlink_to(self.base/'.venv')
        leaf=self.app/'leaf';leaf.write_text('accepted')
        manifest=self.app/'manifest.json';manifest.write_text(json.dumps({'files':{'leaf':backend.P.sha(leaf)},'links':{}}))
        plan=self.g['read_plan']('plan');plan['candidate_manifest']=backend.P.sha(manifest)
        self.g['read_plan']=lambda expected:plan
        self.h.sha=backend.P.sha;self.h.candidate_manifest=backend.P.candidate_manifest
        tree=ast.parse(Path(__file__).with_name('install_r5_bound_web_r15_20261117.py').read_text())
        exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='verify_candidate'],type_ignores=[]),'web-guard','exec'),self.g)
        def tamper():
            if kind=='extra':(self.app/'extra.py').write_text('foreign')
            elif kind=='venv':
                (self.app/'.venv').unlink();(self.app/'.venv').symlink_to(self.stage/'foreign')
            else:manifest.write_text('{}')
        original=self.h.run
        def run(*args):
            result=original(*args)
            if self.web.resolve()==self.app:tamper()
            return result
        self.h.run=run
        if before:tamper()
        with self.assertRaises(RuntimeError):self.g['apply']('plan')
        self.assertEqual(self.web.resolve(),self.base)
        if not before:self.assertTrue(self.records['FAILED.json']['web_rolled_back'])
        self.assertNotIn('APPLIED.json',self.records)
        if before:self.assertEqual(self.calls,[])

    def test_post_start_extra_web_file_rolls_back(self):self.candidate_drift('extra')
    def test_post_start_web_venv_change_rolls_back(self):self.candidate_drift('venv')
    def test_post_start_web_manifest_change_rolls_back(self):self.candidate_drift('manifest')
    def test_web_drift_before_selection_never_restarts(self):self.candidate_drift('extra',True)

    def test_later_writer_between_restore_and_restart_is_preserved(self):
        self.fail_health=True
        foreign=self.stage/'foreign';foreign.mkdir()
        def later(state):
            replacement=self.stage/'later-pointer';replacement.symlink_to(foreign);replacement.replace(self.web)
        with self.assertRaisesRegex(RuntimeError,'ROLLBACK_INCOMPLETE'):
            self.g['apply']('plan',on_restore=later)
        self.assertEqual(self.web.resolve(),foreign)
        self.assertEqual(self.calls,[('systemctl','restart','web.service')])
        self.assertFalse(self.records['FAILED.json']['web_rolled_back'])

    def test_later_writer_after_forward_select_is_not_restarted(self):
        foreign=self.stage/'foreign';foreign.mkdir()
        original=self.g['select']
        def later(target,expected):
            result=original(target,expected)
            if target==self.app:
                replacement=self.stage/'later-pointer';replacement.symlink_to(foreign);replacement.replace(self.web)
            return result
        self.g['select']=later
        with self.assertRaisesRegex(RuntimeError,'ROLLBACK_INCOMPLETE'):self.g['apply']('plan')
        self.assertEqual(self.web.resolve(),foreign)
        self.assertEqual(self.calls,[])

class BoundWebCommandBoundary(unittest.TestCase):
    def test_expected_working_directory_cannot_hide_wrong_authority_command(self):
        path = Path(__file__).with_name('install_r5_bound_web_r15_20261117.py')
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
        self.assertEqual(ast.literal_eval(values['AUTHORITY_ARGV_SHA']),'25e7dbdbe178f82d27c754af7707ec439855538d979d8c7483c194626d2907a4')
        capture = next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='capture')
        self.assertEqual([ast.unparse(n) for n in capture.body[:2]],['require_api_source()','require_authority_source()'])

if __name__=='__main__':unittest.main()

class BoundApiContentAtWebApply(unittest.TestCase):
    def test_api_manifest_and_contents_are_revalidated_before_web_apply(self):
        import json,tempfile
        import test_install_r5_bound_api_r15_20261117 as backend
        path=Path(__file__).with_name('install_r5_bound_web_r15_20261117.py')
        functions=[n for n in ast.parse(path.read_text()).body if isinstance(n,ast.FunctionDef) and n.name in {'require_api_source','read_plan'}]
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);api=root/'api';api.mkdir();dependency=root/'dependency';dependency.mkdir();(dependency/'.venv').mkdir();(api/'.venv').symlink_to(dependency/'.venv');leaf=api/'leaf';leaf.write_text('accepted')
            manifest=api/'manifest.json';manifest.write_text(json.dumps({'files':{'leaf':backend.P.sha(leaf)},'links':{}}))
            raw=manifest.read_bytes();pin=backend.P.sha(manifest)
            g={'Path':Path,'json':json,'API':api,'PINS':{api:pin},'sha':backend.P.sha,'secure':lambda p:None,'need':backend.M.need,'DEPENDENCY_BASE':dependency,'h':types.SimpleNamespace(candidate_manifest=backend.P.candidate_manifest,bounded=lambda p:p.read_bytes()),'ROOT':root,'SOURCE':'test-source','__file__':str(path)}
            exec(compile(ast.Module(body=functions,type_ignores=[]),str(path),'exec'),g)
            g['capture']=lambda:g['require_api_source']() or {}
            plan=root/'PLAN.json';plan.write_text(json.dumps({'source':g['SOURCE'],'installer_sha':backend.P.sha(path),'protected':{}}))
            g['require_api_source']()
            manifest.write_bytes(raw+b'\n')
            with self.assertRaisesRegex(RuntimeError,'API_MANIFEST_CHANGED'):g['read_plan'](backend.P.sha(plan))
            manifest.write_bytes(raw);leaf.write_text('changed')
            with self.assertRaisesRegex(RuntimeError,'FILE_HASH'):g['read_plan'](backend.P.sha(plan))
            leaf.write_text('accepted')
            extra=api/'extra.py';extra.write_text('foreign')
            with self.assertRaises(RuntimeError):g['read_plan'](backend.P.sha(plan))
            extra.unlink();(api/'.venv').unlink();(api/'.venv').symlink_to(root/'foreign-dependency')
            with self.assertRaisesRegex(RuntimeError,'CANDIDATE_VENV'):g['read_plan'](backend.P.sha(plan))
