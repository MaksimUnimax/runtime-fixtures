"""Actual finite installer functions against disposable files and synthetic systemd."""
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('catalog_primitives',HERE/'install_customer_catalog_20261115.py')
P = importlib.util.module_from_spec(spec)
spec.loader.exec_module(P)
tree = ast.parse((HERE/'install_r5_bound_authority_20261116.py').read_text())
keep = [n for n in tree.body if isinstance(n,(ast.Import,ast.ImportFrom,ast.FunctionDef)) or
        isinstance(n,ast.Assign) and all(isinstance(t,ast.Name) and t.id.isupper() for t in n.targets)]
M = types.ModuleType('bound_authority')
M.__file__ = str(HERE/'install_r5_bound_authority_20261116.py')
exec(compile(ast.Module(body=keep,type_ignores=[]),M.__file__,'exec'),M.__dict__)

ORIGINAL_READ_PLAN = M.read_plan
ORIGINAL_MANAGED = M.managed
ORIGINAL_CANDIDATE_IDENTITY = M.candidate_identity

class BoundAuthorityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        M.ROOT = self.root
        M.BASE = self.root/'base'
        M.APP = self.root/'app'
        M.SELECTOR = self.root/'owned.conf'
        M.OLD_SELECTOR = self.root/'old.conf'
        self.raw = ('[Service]\nWorkingDirectory='+str(M.BASE)+'/services/platform\n'
            'Environment=ALISA_RELEASE=legacy\nExecStart=\nExecStart='+str(M.BASE)+'/.venv/bin/python -c '
            +str(M.BASE)+'/services/platform/src\nEnvironmentFile=/private/config\n').encode()
        M.OLD_SELECTOR_SHA = hashlib.sha256(self.raw).hexdigest()
        M.OLD_SELECTOR.write_bytes(self.raw)
        self.old = {'WorkingDirectory':str(M.BASE/'services/platform'),'argv':str(M.BASE)+'/.venv/bin/python -c '+str(M.BASE)+'/services/platform/src',
                    'DropInPaths':str(M.OLD_SELECTOR),'drop_hashes':{str(M.OLD_SELECTOR):M.OLD_SELECTOR_SHA},'EnvironmentFiles':'private unchanged'}
        self.trace = []
        self.loaded = False
        self.new_running = False
        self.fail_new_health = False
        self.foreign_after_start = False
        self.fail_after_move = False
        self.records = {}
        def record(name,value):
            self.records[name] = value
            (M.ROOT/name).write_text(json.dumps(value,indent=2)+'\n')
        def inventory():
            result = {str(M.OLD_SELECTOR):P.sha(M.OLD_SELECTOR)}
            if M.SELECTOR.exists():
                result[str(M.SELECTOR)] = P.sha(M.SELECTOR)
            return result
        self.inventory = inventory
        def run(*args):
            self.trace.append(args)
            if args[-1] == 'daemon-reload':
                self.loaded = M.SELECTOR.exists()
            if len(args)>2 and args[1] == 'start':
                self.new_running = self.loaded
                if self.foreign_after_start and self.loaded:
                    M.SELECTOR.write_bytes(b'foreign writer')
            return ''
        def static(unit):
            return M.expected_static(self.old,hashlib.sha256(M.overlay(self.raw)).hexdigest()) if self.loaded else self.old
        def wait(label):
            if self.fail_new_health and self.new_running:
                raise RuntimeError('SYNTHETIC_HEALTH_FAILURE')
        def move(a,b):
            P.rename_no_replace(a,b)
            if self.fail_after_move:
                self.fail_after_move = False
                raise RuntimeError('SYNTHETIC_AFTER_MOVE')
        M.h = types.SimpleNamespace(path_state=P.path_state,rename_no_replace=move,replace_selection=P.replace_selection,
              record=record,bounded=lambda p:p.read_bytes(),stop=lambda u:self.trace.append(('stop',u)),
              idle=lambda:None,static=static,run=run,active=lambda u:None,manifest=lambda p:None,
              reserve=lambda *a:None,prop=lambda u,k:str(M.APP/'services/platform') if k=='WorkingDirectory' else '1',
              PRESERVE=['protected-'+str(i) for i in range(8)])
        M.w = types.SimpleNamespace(secure=lambda p:None)
        self.plan = {'protected':{'fixed':True},'inventory':inventory(),'authority_static':self.old,
                     'health_label':'legacy','overlay_sha':hashlib.sha256(M.overlay(self.raw)).hexdigest(),
                     'environment_sha':'same','candidate_manifest':'qualified','candidate_identity':['synthetic']}
        self.patches = [patch.object(M,'read_plan',lambda x:(self.plan,M.overlay(self.raw))),
                        patch.object(M,'inventory',inventory),patch.object(M,'captured',lambda:{'fixed':True}),
                        patch.object(M,'environment',lambda:'same'),patch.object(M,'wait_ready',wait),
                        patch.object(M,'managed',lambda p:p.read_bytes()),
                        patch.object(M,'candidate_identity',lambda p:('synthetic',))]
        for p in self.patches:p.start()
        self.addCleanup(lambda:[p.stop() for p in reversed(self.patches)])

    def test_overlay_changes_only_three_source_paths(self):
        new = M.overlay(self.raw)
        self.assertEqual(new.count(str(M.APP).encode()),3)
        self.assertEqual(new.replace(str(M.APP).encode(),str(M.BASE).encode()),self.raw)
        self.assertIn(b'ALISA_RELEASE=legacy',new)
        self.assertIn(b'EnvironmentFile=/private/config',new)

    def test_overlay_rejects_wrong_hash_count_and_non_execution_lines(self):
        cases = [self.raw+b'x',self.raw.replace(str(M.BASE).encode(),b'missing',1),
                 self.raw.replace(b'WorkingDirectory=',b'Environment=OTHER=')]
        for i,raw in enumerate(cases):
            with self.subTest(i=i):
                with patch.object(M,'OLD_SELECTOR_SHA',hashlib.sha256(raw).hexdigest() if i else 'bad'):
                    with self.assertRaises(RuntimeError):M.overlay(raw)

    def test_expected_static_keeps_environment_and_all_earlier_dropins(self):
        v = M.expected_static(self.old,'digest')
        self.assertEqual(v['EnvironmentFiles'],self.old['EnvironmentFiles'])
        self.assertEqual(v['drop_hashes'][str(M.OLD_SELECTOR)],M.OLD_SELECTOR_SHA)
        self.assertEqual(self.old['DropInPaths'],str(M.OLD_SELECTOR))

    def test_publish_preserves_existing_file_symlink_and_staged_name(self):
        for mode in ['file','symlink','temporary']:
            with self.subTest(mode=mode):
                p = M.SELECTOR if mode!='temporary' else M.SELECTOR.with_name('.'+M.SELECTOR.name+'.bound-period-new')
                if mode=='symlink':p.symlink_to('foreign')
                else:p.write_bytes(b'foreign')
                before = P.path_state(p)
                with self.assertRaises(RuntimeError):M.publish(M.overlay(self.raw))
                self.assertEqual(P.path_state(p),before)
                p.unlink()

    def test_success_changes_only_authority_and_keeps_base(self):
        M.apply('plan')
        self.assertEqual(M.OLD_SELECTOR.read_bytes(),self.raw)
        self.assertEqual(self.trace,[('stop',M.UNIT),('systemctl','daemon-reload'),('systemctl','start',M.UNIT)])
        self.assertEqual(self.records['AUTHORITY_APPLIED.json']['status'],'APPLIED_AUTHORITY_ONLY')
        self.assertTrue(M.SELECTOR.exists())

    def test_new_health_failure_restores_base(self):
        self.fail_new_health = True
        with self.assertRaisesRegex(RuntimeError,'SYNTHETIC_HEALTH_FAILURE'):M.apply('plan')
        self.assertFalse(M.SELECTOR.exists())
        self.assertTrue(self.records['AUTHORITY_FAILED.json']['authority_rolled_back'])
        self.assertEqual(self.trace.count(('systemctl','start',M.UNIT)),2)

    def test_failure_after_rename_uses_persisted_inode_ownership(self):
        self.fail_after_move = True
        with self.assertRaisesRegex(RuntimeError,'SYNTHETIC_AFTER_MOVE'):M.apply('plan')
        self.assertFalse(M.SELECTOR.exists())
        self.assertTrue(self.records['AUTHORITY_FAILED.json']['authority_rolled_back'])

    def test_concurrent_writer_is_retained_without_unsafe_restart(self):
        self.foreign_after_start = True
        with self.assertRaisesRegex(RuntimeError,'ROLLBACK_LATER_WRITER'):M.apply('plan')
        self.assertEqual(M.SELECTOR.read_bytes(),b'foreign writer')
        self.assertEqual(self.trace.count(('systemctl','start',M.UNIT)),1)
        self.assertFalse(self.records['AUTHORITY_FAILED.json']['authority_rolled_back'])

    def test_no_repeat_after_attempt(self):
        (M.ROOT/'AUTHORITY_STARTED.json').write_text('{}')
        with self.assertRaisesRegex(RuntimeError,'ALREADY_ATTEMPTED'):M.apply('plan')
        self.assertEqual(self.trace,[])

    def test_raced_job_after_drain_restores_old_without_publishing(self):
        M.h.idle = lambda:(_ for _ in ()).throw(RuntimeError('ACTIVE_JOBS'))
        with self.assertRaisesRegex(RuntimeError,'ACTIVE_JOBS'):M.apply('plan')
        self.assertFalse(M.SELECTOR.exists())
        self.assertTrue(self.records['AUTHORITY_FAILED.json']['authority_rolled_back'])

    def test_failure_writing_success_receipt_rolls_back(self):
        record = M.h.record
        def broken(name,value):
            if name=='AUTHORITY_APPLIED.json':raise OSError('SYNTHETIC_RECEIPT_FAILURE')
            record(name,value)
        M.h.record = broken
        with self.assertRaisesRegex(OSError,'SYNTHETIC_RECEIPT_FAILURE'):M.apply('plan')
        self.assertFalse(M.SELECTOR.exists())
        self.assertTrue(self.records['AUTHORITY_FAILED.json']['authority_rolled_back'])

    def test_changed_config_after_drain_is_never_overwritten(self):
        def stop(u):
            self.trace.append(('stop',u))
            M.OLD_SELECTOR.write_bytes(b'later config')
        M.h.stop = stop
        with self.assertRaisesRegex(RuntimeError,'ROLLBACK_LATER_WRITER'):M.apply('plan')
        self.assertEqual(M.OLD_SELECTOR.read_bytes(),b'later config')
        self.assertFalse(M.SELECTOR.exists())

    def test_changed_environment_triggers_rollback(self):
        with patch.object(M,'environment',lambda:'changed' if self.new_running else 'same'):
            with self.assertRaisesRegex(RuntimeError,'ENVIRONMENT_CHANGED'):M.apply('plan')
        self.assertFalse(M.SELECTOR.exists())
        self.assertTrue(self.records['AUTHORITY_FAILED.json']['authority_rolled_back'])


    def plan_fixture(self):
        self.enterContext(patch.object(M,'candidate_identity',ORIGINAL_CANDIDATE_IDENTITY))
        M.BASE.mkdir()
        (M.BASE/'.venv').mkdir()
        (M.BASE/'manifest.json').write_text('{}')
        M.APP.mkdir()
        (M.APP/'leaf').write_bytes(b'qualified')
        (M.APP/'.venv').symlink_to(M.BASE/'.venv')
        (M.APP/'manifest.json').write_text(json.dumps({'files':{'leaf':P.sha(M.APP/'leaf')},'links':{}}))
        M.h.candidate_manifest = P.candidate_manifest
        # Root ownership is exercised by ORIGINAL_MANAGED; this plane is synthetic.
        value = dict(self.plan,source=M.SOURCE,installer_sha=M.sha(M.__file__),
                     candidate_manifest=P.sha(M.APP/'manifest.json'),candidate_identity=list(M.candidate_identity(M.APP)))
        path = M.ROOT/'AUTHORITY_PLAN.json'
        path.write_text(json.dumps(value))
        return path,value

    def test_full_plan_admits_unchanged_qualified_candidate(self):
        path,value = self.plan_fixture()
        with patch.object(M,'BASE_SHA',P.sha(M.BASE/'manifest.json')):
            actual,raw = ORIGINAL_READ_PLAN(P.sha(path))
        self.assertEqual(actual,value)
        self.assertEqual(raw,M.overlay(self.raw))
        self.assertEqual(self.trace,[])

    def test_full_plan_rejects_each_provenance_and_state_change_before_stop(self):
        path,value = self.plan_fixture()
        cases = {'source':'foreign','installer_sha':'foreign','protected':{'changed':True},
                 'authority_static':{},'inventory':{},'environment_sha':'foreign',
                 'overlay_sha':'foreign','candidate_manifest':'foreign'}
        with patch.object(M,'BASE_SHA',P.sha(M.BASE/'manifest.json')):
            for field,bad in cases.items():
                with self.subTest(field=field):
                    path.write_text(json.dumps(dict(value,**{field:bad})))
                    with self.assertRaises(RuntimeError):ORIGINAL_READ_PLAN(P.sha(path))
                    self.assertEqual(self.trace,[])
            path.write_text(json.dumps(value))
            with self.assertRaisesRegex(RuntimeError,'PLAN_CHANGED'):ORIGINAL_READ_PLAN('bad')

    def test_full_plan_rejects_tampered_file_base_and_live_selector(self):
        path,value = self.plan_fixture()
        pin = P.sha(M.BASE/'manifest.json')
        with patch.object(M,'BASE_SHA',pin):
            (M.APP/'leaf').write_bytes(b'tampered')
            with self.assertRaisesRegex(RuntimeError,'FILE_HASH'):ORIGINAL_READ_PLAN(P.sha(path))
            (M.APP/'leaf').write_bytes(b'qualified')
            (M.BASE/'manifest.json').write_text('changed')
            with self.assertRaisesRegex(RuntimeError,'BASE_PIN'):ORIGINAL_READ_PLAN(P.sha(path))
            (M.BASE/'manifest.json').write_text('{}')
            M.SELECTOR.symlink_to('foreign')
            with self.assertRaises(RuntimeError):ORIGINAL_READ_PLAN(P.sha(path))
        self.assertEqual(self.trace,[])

    def test_full_plan_blocks_new_job_before_any_service_action(self):
        path,value = self.plan_fixture()
        M.h.idle = lambda:(_ for _ in ()).throw(RuntimeError('ACTIVE_JOBS'))
        with patch.object(M,'BASE_SHA',P.sha(M.BASE/'manifest.json')):
            with self.assertRaisesRegex(RuntimeError,'ACTIVE_JOBS'):ORIGINAL_READ_PLAN(P.sha(path))
        self.assertEqual(self.trace,[])


    def test_failure_before_rename_restores_running_base_and_cleans_temp(self):
        def fail(a,b):
            raise RuntimeError('SYNTHETIC_BEFORE_MOVE')
        M.h.rename_no_replace = fail
        with self.assertRaisesRegex(RuntimeError,'SYNTHETIC_BEFORE_MOVE'):M.apply('plan')
        self.assertFalse(M.SELECTOR.exists())
        self.assertFalse(M.SELECTOR.with_name('.'+M.SELECTOR.name+'.bound-period-new').exists())
        self.assertTrue(self.records['AUTHORITY_FAILED.json']['authority_rolled_back'])
        self.assertEqual(self.trace.count(('systemctl','start',M.UNIT)),1)

    def test_fsync_and_chmod_failure_clean_only_owned_staging_file(self):
        for operation in ['fsync','chmod']:
            with self.subTest(operation=operation):
                target = patch.object(M.os,'fsync',side_effect=OSError('SYNTHETIC_STAGE')) if operation=='fsync' else patch.object(Path,'chmod',side_effect=OSError('SYNTHETIC_STAGE'))
                with target:
                    with self.assertRaisesRegex(OSError,'SYNTHETIC_STAGE'):M.publish(M.overlay(self.raw))
                self.assertFalse(M.SELECTOR.exists())
                self.assertFalse(M.SELECTOR.with_name('.'+M.SELECTOR.name+'.bound-period-new').exists())

    def test_staging_error_preserves_concurrent_replacement_inode(self):
        temp = M.SELECTOR.with_name('.'+M.SELECTOR.name+'.bound-period-new')
        def fail(fd):
            temp.unlink()
            temp.write_bytes(b'foreign staging writer')
            raise OSError('SYNTHETIC_STAGE')
        with patch.object(M.os,'fsync',side_effect=fail):
            with self.assertRaisesRegex(OSError,'SYNTHETIC_STAGE'):M.publish(M.overlay(self.raw))
        self.assertEqual(temp.read_bytes(),b'foreign staging writer')

    def test_actual_managed_config_requires_root_owner_and_no_symlink(self):
        if M.os.geteuid()==0:
            self.assertEqual(ORIGINAL_MANAGED(M.OLD_SELECTOR),self.raw)
        else:
            with self.assertRaisesRegex(RuntimeError,'UNTRUSTED_CONFIG'):ORIGINAL_MANAGED(M.OLD_SELECTOR)
        M.OLD_SELECTOR.chmod(0o666)
        with self.assertRaisesRegex(RuntimeError,'UNTRUSTED_CONFIG'):ORIGINAL_MANAGED(M.OLD_SELECTOR)
        M.OLD_SELECTOR.unlink()
        M.OLD_SELECTOR.symlink_to('foreign')
        with self.assertRaises(RuntimeError):ORIGINAL_MANAGED(M.OLD_SELECTOR)


    def package_fixture(self):
        names = set(M.CHANGED[:2]) | M.RETAINED | set(M.UNCHANGED) | {'services/platform/src/alisa_platform/accounts/models.py'}
        old = {'files':{n:'old' for n in names},'locks':{'python':'same'},'contracts':{n:p[0] for n,p in M.CONTRACT_PAIRS.items()}}
        package = {'source_sha':M.SOURCE,'files':dict(old['files']),'locks':dict(old['locks']),'contracts':{n:p[1] for n,p in M.CONTRACT_PAIRS.items()}}
        package['files'].update({n:'new' for n in set(M.CHANGED)|M.RETAINED})
        return package,old

    def test_overlay_compatibility_accepts_only_exact_retained_login_contract_delta(self):
        package,old = self.package_fixture()
        original = json.loads(json.dumps(old))
        M.compatible(package,old)
        self.assertEqual(old,original)

    def test_overlay_rejects_unknown_contract_dependency_migration_lock_and_file_change(self):
        package,old = self.package_fixture()
        cases = ['contract','contract_set','model','new_migration','lock','source','removed']
        for field in cases:
            p = json.loads(json.dumps(package))
            if field=='contract':p['contracts'][next(iter(p['contracts']))]='unknown'
            if field=='contract_set':p['contracts']['unknown']='unknown'
            if field=='model':p['files']['services/platform/src/alisa_platform/accounts/models.py']='changed'
            if field=='new_migration':p['files']['services/platform/src/alisa_platform/owner_data/migrations/new.py']='changed'
            if field=='lock':p['locks']['python']='changed'
            if field=='source':p['source_sha']='foreign'
            if field=='removed':del p['files'][M.UNCHANGED[0]]
            with self.subTest(field=field):
                with self.assertRaises(RuntimeError):M.compatible(p,old)


    def stage_fixture(self):
        self.enterContext(patch.object(M,'candidate_identity',ORIGINAL_CANDIDATE_IDENTITY))
        M.BASE.mkdir()
        (M.BASE/'.venv').mkdir()
        (M.BASE/'same').write_bytes(b'old')
        source = M.ROOT/'new-bytes';source.write_bytes(b'new')
        value = {'files':{'same':P.sha(M.BASE/'same'),'changed':P.sha(source)},'links':{}}
        M.h.materialize = P.materialize
        M.h.candidate_manifest = P.candidate_manifest
        return value,{'same':M.BASE/'same','changed':source},{P.sha(M.BASE/'same'):M.BASE/'same'}

    def test_candidate_staging_success_preserves_base_and_cleans_envelope(self):
        v,s,p = self.stage_fixture()
        M.stage_candidate(v,s,p,lambda:{'source':M.SOURCE})
        self.assertTrue((M.APP/'manifest.json').exists())
        self.assertTrue((M.ROOT/M.PREPARATION_PLAN).exists())
        self.assertEqual((M.BASE/'same').read_bytes(),b'old')
        self.assertEqual(list(M.APP.parent.glob('.r5-preparation-*')),[])

    def test_candidate_materialization_validation_and_plan_failure_cleanup(self):
        for failure in ['materialize','validate','plan_before','plan_after']:
            with self.subTest(failure=failure):
                # Each injected failure gets its own complete disposable test case.
                other = BoundAuthorityTests(methodName='runTest');other.setUp()
                try:
                    v,s,p = other.stage_fixture()
                    original_publish = M.publish_record
                    if failure=='materialize':
                        def broken(*args):
                            target=args[1];target.mkdir();(target/'partial').write_bytes(b'partial')
                            raise RuntimeError('SYNTHETIC_PREPARATION')
                        M.h.materialize=broken
                    elif failure=='validate':
                        M.h.candidate_manifest=lambda *a:(_ for _ in ()).throw(RuntimeError('SYNTHETIC_PREPARATION'))
                    else:
                        def broken(name,value,*args,**kwargs):
                            if name==M.PREPARATION_PLAN:
                                if failure=='plan_after':original_publish(name,value,*args,**kwargs)
                                raise RuntimeError('SYNTHETIC_PREPARATION')
                            return original_publish(name,value,*args,**kwargs)
                        change=patch.object(M,'publish_record',broken);change.start();other.addCleanup(change.stop)
                    with self.assertRaisesRegex(RuntimeError,'SYNTHETIC_PREPARATION'):M.stage_candidate(v,s,p,lambda:{'source':M.SOURCE})
                    self.assertFalse(M.APP.exists())
                    self.assertFalse((M.ROOT/M.PREPARATION_PLAN).exists())
                    self.assertEqual(list(M.APP.parent.glob('.r5-preparation-*')),[])
                    self.assertEqual((M.BASE/'same').read_bytes(),b'old')
                finally:other.doCleanups()

    def test_partial_envelope_can_be_recovered_after_interruption(self):
        v,s,p = self.stage_fixture()
        folder = Path(tempfile.mkdtemp(prefix='.r5-preparation-',dir=M.APP.parent))
        st = folder.stat();(folder/'partial').write_bytes(b'owned')
        M.h.WEB_LINK = M.ROOT/'current';M.h.WEB_LINK.symlink_to(M.BASE)
        M.h.prop=lambda *a:str(M.BASE/'services/platform')
        M.h.record('PREPARING.json',{'source':M.SOURCE,'installer_sha':M.sha(M.__file__),
                     'envelope':str(folder),'envelope_identity':[st.st_dev,st.st_ino],'candidate_identity':None})
        M.recover_preparation()
        self.assertFalse(folder.exists())
        self.assertTrue(self.records['PREPARATION_RECOVERED.json']['removed_only_owned_staging'])

    def test_recovery_refuses_foreign_envelope_identity(self):
        v,s,p = self.stage_fixture()
        folder = Path(tempfile.mkdtemp(prefix='.r5-preparation-',dir=M.APP.parent))
        M.h.record('PREPARING.json',{'source':M.SOURCE,'installer_sha':M.sha(M.__file__),
                     'envelope':str(folder),'envelope_identity':[0,0],'candidate_identity':None})
        with self.assertRaisesRegex(RuntimeError,'PREPARATION_OWNER_CHANGED'):M.recover_preparation()
        self.assertTrue(folder.exists())

    def test_failed_candidate_publication_keeps_foreign_destination(self):
        v,s,p = self.stage_fixture()
        original = M.h.rename_no_replace
        def race(a,b):
            if b==M.APP:
                M.APP.mkdir();(M.APP/'foreign').write_bytes(b'foreign')
            return original(a,b)
        M.h.rename_no_replace=race
        with self.assertRaises(RuntimeError):M.stage_candidate(v,s,p,lambda:{})
        self.assertEqual((M.APP/'foreign').read_bytes(),b'foreign')
        self.assertEqual(list(M.APP.parent.glob('.r5-preparation-*')),[])


    def test_retry_preserves_previous_proof_and_partial_envelope(self):
        v,s,p = self.stage_fixture()
        envelope = Path(tempfile.mkdtemp(prefix='.r5-preparation-',dir=M.APP.parent))
        (envelope/'partial').write_bytes(b'owned old staging')
        proof = M.ROOT/'PREPARING.json';proof.write_text('old proof')
        state = P.path_state(proof)
        with self.assertRaisesRegex(RuntimeError,'PREPARATION_RECOVERY_REQUIRED'):M.stage_candidate(v,s,p,lambda:{})
        self.assertEqual(P.path_state(proof),state)
        self.assertEqual((envelope/'partial').read_bytes(),b'owned old staging')

    def test_dangling_plan_and_proof_symlinks_are_never_overwritten(self):
        v,s,p = self.stage_fixture()
        for name in [M.PREPARATION_PLAN,'PREPARING.json']:
            path = M.ROOT/name;path.symlink_to('missing')
            state = P.path_state(path)
            with self.assertRaises(RuntimeError):M.stage_candidate(v,s,p,lambda:{})
            self.assertEqual(P.path_state(path),state)
            self.assertFalse(M.APP.exists())
            path.unlink()

    def test_raced_plan_symlink_is_preserved_before_plan_record(self):
        v,s,p = self.stage_fixture()
        plan = M.ROOT/M.PREPARATION_PLAN
        def race():
            plan.symlink_to('missing foreign target')
            return {}
        with self.assertRaises(RuntimeError):M.stage_candidate(v,s,p,race)
        self.assertTrue(plan.is_symlink())
        self.assertEqual(plan.readlink(),Path('missing foreign target'))
        self.assertFalse(M.APP.exists())

    def test_failed_cleanup_proof_can_be_closed_before_retry(self):
        v,s,p = self.stage_fixture()
        envelope = M.APP.parent/'.r5-preparation-interrupted-and-cleaned'
        M.h.WEB_LINK=M.ROOT/'current';M.h.WEB_LINK.symlink_to(M.BASE)
        M.h.prop=lambda *a:str(M.BASE/'services/platform')
        M.h.record('PREPARING.json',{'source':M.SOURCE,'installer_sha':M.sha(M.__file__),'envelope':str(envelope),'envelope_identity':[1,2],'candidate_identity':None})
        M.recover_preparation()
        self.assertFalse((M.ROOT/'PREPARING.json').exists())
        M.stage_candidate(v,s,p,lambda:{'source':M.SOURCE})
        self.assertTrue(M.APP.exists())


    def test_record_publication_refuses_foreign_file_in_check_to_write_window(self):
        for name in ['PREPARING.json',M.PREPARATION_PLAN]:
            with self.subTest(name=name):
                path=M.ROOT/name
                original=M.h.rename_no_replace
                def race(src,dst):
                    if dst==path:path.symlink_to('foreign dangling target')
                    return original(src,dst)
                with patch.object(M.h,'rename_no_replace',race):
                    with self.assertRaises(RuntimeError):M.publish_record(name,{'owned':True})
                self.assertEqual(path.readlink(),Path('foreign dangling target'))
                path.unlink()
        self.assertEqual(list(M.ROOT.glob('.r5-receipt-*')),[])

    def test_record_update_rejects_foreign_replacement_inode(self):
        state=M.publish_record('PREPARING.json',{'phase':'old'})
        original=M.h.replace_selection
        def race(path,temp,expected,staged=None):
            if path.name=='PREPARING.json':
                path.unlink();path.write_bytes(b'foreign')
            return original(path,temp,expected,staged)
        with patch.object(M.h,'replace_selection',race):
            with self.assertRaisesRegex(RuntimeError,'SELECTOR_CHANGED'):
                M.publish_record('PREPARING.json',{'phase':'new'},state)
        self.assertEqual((M.ROOT/'PREPARING.json').read_bytes(),b'foreign')

    def test_recovery_retries_its_own_detached_recovered_envelope(self):
        self.stage_fixture()
        folder=Path(tempfile.mkdtemp(prefix='.r5-preparation-',dir=M.APP.parent))
        st=folder.stat();(folder/'partial').write_bytes(b'owned')
        M.h.WEB_LINK=M.ROOT/'current';M.h.WEB_LINK.symlink_to(M.BASE)
        M.h.prop=lambda *a:str(M.BASE/'services/platform')
        M.h.record('PREPARING.json',{'source':M.SOURCE,'installer_sha':M.sha(M.__file__),'envelope':str(folder),'envelope_identity':[st.st_dev,st.st_ino],'candidate_identity':None})
        with patch.object(M.shutil,'rmtree',side_effect=RuntimeError('SYNTHETIC_INTERRUPTION')):
            with self.assertRaisesRegex(RuntimeError,'SYNTHETIC_INTERRUPTION'):M.recover_preparation()
        recovered=folder.with_name(folder.name+'-recovered')
        self.assertTrue(recovered.exists())
        self.assertTrue((M.ROOT/'PREPARING.json').exists())
        M.recover_preparation()
        self.assertFalse(recovered.exists())
        self.assertFalse((M.ROOT/'PREPARING.json').exists())

    def test_stop_failure_never_restarts_unconfirmed_service_state(self):
        def fail(unit):
            self.trace.append(('stop',unit))
            raise RuntimeError('SYNTHETIC_STOP_FAILURE')
        M.h.stop=fail
        with self.assertRaisesRegex(RuntimeError,'STOP_NOT_CONFIRMED'):M.apply('plan')
        self.assertEqual(self.trace,[('stop',M.UNIT)])
        self.assertFalse(M.SELECTOR.exists())
        self.assertFalse(self.records['AUTHORITY_FAILED.json']['authority_rolled_back'])

    def test_later_service_stop_is_preserved_on_health_failure(self):
        epoch=[0]
        def fail(label):
            epoch[0]+=1
            raise RuntimeError('SYNTHETIC_LATER_STOP')
        with patch.object(M,'service_state',lambda:{'epoch':epoch[0]}),patch.object(M,'wait_ready',fail):
            with self.assertRaisesRegex(RuntimeError,'ROLLBACK_SERVICE_STATE_CHANGED'):M.apply('plan')
        self.assertEqual(self.trace.count(('stop',M.UNIT)),1)
        self.assertEqual(self.trace.count(('systemctl','start',M.UNIT)),1)
        self.assertFalse(self.records['AUTHORITY_FAILED.json']['authority_rolled_back'])


    def test_same_content_replacement_after_preparation_is_rejected_by_read_plan(self):
        path,value=self.plan_fixture()
        original=M.ROOT/'original-candidate'
        M.APP.rename(original)
        M.shutil.copytree(original,M.APP,symlinks=True)
        M.APP.chmod(0o777);(M.APP/'leaf').chmod(0o666)
        with patch.object(M,'BASE_SHA',P.sha(M.BASE/'manifest.json')):
            with self.assertRaisesRegex(RuntimeError,'CANDIDATE_REPLACED'):ORIGINAL_READ_PLAN(P.sha(path))
        self.assertTrue(M.APP.exists())
        self.assertNotEqual(tuple(value['candidate_identity']),M.candidate_identity(M.APP))

    def test_same_content_replacement_during_plan_creation_is_preserved(self):
        v,s,p=self.stage_fixture()
        def race():
            original=M.ROOT/'original-candidate'
            M.APP.rename(original)
            M.shutil.copytree(original,M.APP,symlinks=True)
            (M.APP/'changed').chmod(0o666)
            return {'source':M.SOURCE}
        with self.assertRaises(RuntimeError):M.stage_candidate(v,s,p,race)
        self.assertEqual((M.APP/'changed').read_bytes(),b'new')
        self.assertFalse((M.ROOT/M.PREPARATION_PLAN).exists())

    def test_plan_contains_original_candidate_inode_owner_and_mode(self):
        v,s,p=self.stage_fixture()
        M.stage_candidate(v,s,p,lambda:{'source':M.SOURCE})
        plan=json.loads((M.ROOT/M.PREPARATION_PLAN).read_text())
        self.assertEqual(tuple(plan['candidate_identity']),M.candidate_identity(M.APP))
        self.assertEqual(len(plan['candidate_identity']),5)


    def test_failed_start_with_systemd_state_transition_restores_owned_base(self):
        state={'ActiveState':'active','SubState':'running','MainPID':'1','ControlPID':'0','InvocationID':'old','Result':'success','clock':0}
        original_run=M.h.run;original_stop=M.h.stop
        def stop(unit):
            original_stop(unit);state.update(ActiveState='inactive',SubState='dead',MainPID='0',clock=state['clock']+1)
        def run(*args):
            result=original_run(*args)
            if len(args)>2 and args[1]=='start':
                if self.loaded:
                    state.update(ActiveState='failed',SubState='failed',MainPID='0',InvocationID='our-failed-start',Result='exit-code',clock=state['clock']+1)
                    raise RuntimeError('SYNTHETIC_START_FAILURE')
                state.update(ActiveState='active',SubState='running',MainPID='2',InvocationID='restored',Result='success',clock=state['clock']+1)
            return result
        M.h.stop=stop;M.h.run=run
        with patch.object(M,'service_state',lambda:dict(state)):
            with self.assertRaisesRegex(RuntimeError,'SYNTHETIC_START_FAILURE'):M.apply('plan')
        self.assertFalse(M.SELECTOR.exists())
        self.assertEqual(state['ActiveState'],'active')
        self.assertTrue(self.records['AUTHORITY_FAILED.json']['authority_rolled_back'])
        self.assertEqual(self.trace.count(('systemctl','start',M.UNIT)),2)

    def test_failed_start_cancelled_by_later_stop_is_not_restarted(self):
        state={'ActiveState':'inactive','SubState':'dead','MainPID':'0','ControlPID':'0','InvocationID':'old','Result':'success','clock':0}
        original_run=M.h.run
        def run(*args):
            result=original_run(*args)
            if len(args)>2 and args[1]=='start':
                state.update(clock=1,InvocationID='later-stopped',ActiveState='inactive')
                raise RuntimeError('SYNTHETIC_CANCELLED_START')
            return result
        M.h.run=run
        with patch.object(M,'service_state',lambda:dict(state)):
            with self.assertRaisesRegex(RuntimeError,'ROLLBACK_SERVICE_STATE_CHANGED'):M.apply('plan')
        self.assertEqual(self.trace.count(('systemctl','start',M.UNIT)),1)
        self.assertFalse(self.records['AUTHORITY_FAILED.json']['authority_rolled_back'])


    def test_crash_or_auto_restart_after_start_return_restores_owned_base(self):
        for restarting in [False,True]:
            with self.subTest(restarting=restarting):
                other=BoundAuthorityTests(methodName='runTest');other.setUp()
                try:
                    state={'ActiveState':'inactive','SubState':'dead','MainPID':'0','ControlPID':'0','InvocationID':'old','Result':'success','Job':'0','clock':0}
                    original_run=M.h.run;original_stop=M.h.stop
                    def stop(unit):
                        original_stop(unit);state.update(ActiveState='inactive',SubState='dead',MainPID='0',clock=state['clock']+1)
                    def run(*args):
                        result=original_run(*args)
                        if len(args)>2 and args[1]=='start':
                            state.update(ActiveState='active',SubState='running',MainPID='2',InvocationID='new',Result='success',clock=state['clock']+1)
                        return result
                    def health(label):
                        if other.new_running:
                            state.update(ActiveState='activating' if restarting else 'failed',SubState='auto-restart' if restarting else 'failed',MainPID='0',Result='exit-code',clock=state['clock']+1)
                            raise RuntimeError('SYNTHETIC_POST_START_CRASH')
                    M.h.stop=stop;M.h.run=run
                    with patch.object(M,'service_state',lambda:dict(state)),patch.object(M,'wait_ready',health):
                        with self.assertRaisesRegex(RuntimeError,'SYNTHETIC_POST_START_CRASH'):M.apply('plan')
                    self.assertFalse(M.SELECTOR.exists())
                    self.assertTrue(other.records['AUTHORITY_FAILED.json']['authority_rolled_back'])
                    self.assertEqual(state['ActiveState'],'active')
                finally:other.doCleanups()

if __name__ == '__main__':
    unittest.main()
