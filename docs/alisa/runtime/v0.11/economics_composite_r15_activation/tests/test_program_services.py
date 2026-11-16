"""Read-only systemd grammar, actual private mask files, and deployment gates.

The separate program_service_gate exercises actual systemd socket instances,
unit reload/restore, publication and the real retained v2/v3 producer path.
"""
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch, Mock
import json
import os
import sys
import unittest

HERE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(HERE))
import activate as a
import test_program_unit_files as file_fixture


class ServiceContracts(unittest.TestCase):
    def setUp(self):
        file_fixture.ProgramUnitFiles.setUp(self)
        self.records=[]
        self.service=a.ProgramPairServiceFence(self.exclusion,lambda n,v:self.records.append((n,v)))
        self.idle={'LoadState':'loaded','ActiveState':'inactive','MainPID':'0','ControlPID':'0','ControlGroup':'','Job':''}

    def response(self, rows=None, jobs=''):
        def run(*args,**kw):
            if args[1]=='list-units':return json.dumps([] if rows is None else rows).encode()
            if args[1]=='list-jobs':return jobs.encode()
            self.fail('unexpected systemd mutation or lookup: '+repr(args))
        return run

    def test_idle_reads_only_and_rejects_each_busy_service_field(self):
        with patch.object(a,'run',side_effect=self.response()),patch.object(self.service,'show',return_value=self.idle):
            self.service.require_idle()
        for field,value in [('LoadState','error'),('ActiveState','activating'),('ActiveState','active'),
                            ('MainPID','1'),('ControlPID','1'),('Job','99')]:
            with self.subTest(field=field,value=value),patch.object(a,'run',side_effect=self.response()),\
                 patch.object(self.service,'show',return_value={**self.idle,field:value}),self.assertRaises(a.c.Blocked):
                self.service.require_idle()

    def test_accepted_and_paid_worker_instances_are_checked_without_stop(self):
        for name in ('alisa-program@accepted.service','alisa-program-run-012345.service'):
            seen=[]
            def show(n,keys):
                seen.append(n);return {**self.idle,**({'ActiveState':'active','MainPID':'99'} if n==name else {})}
            with self.subTest(name=name),patch.object(a,'run',side_effect=self.response([{'unit':name}])),\
                 patch.object(self.service,'show',side_effect=show),self.assertRaises(a.c.Blocked):
                self.service.require_idle()
            self.assertIn(name,seen)

    def test_pending_program_jobs_refuse_but_unrelated_job_is_preserved(self):
        names=(self.service.SOCKET,self.service.TIMER,self.service.CLEANUP,
               'alisa-program@accepted.service','alisa-program-run-012345.service')
        for name in names:
            with self.subTest(name=name),patch.object(a,'run',side_effect=self.response(jobs='1 '+name+' start waiting\n')),\
                 patch.object(self.service,'show',return_value=self.idle),self.assertRaises(a.c.Blocked) as error:
                self.service.require_idle()
            self.assertEqual(error.exception.code,'PROGRAM_PENDING_JOB')
        with patch.object(a,'run',side_effect=self.response(jobs='2 unrelated.service start waiting\n')),\
             patch.object(self.service,'show',return_value=self.idle):self.service.require_idle()

    def test_malformed_lists_and_unknown_job_rows_are_not_idle(self):
        for raw in (b'{}',b'null',b'[{"unit":"/bad/path"}]',b'not-json'):
            with self.subTest(raw=raw),patch.object(a,'run',return_value=raw),self.assertRaises(a.c.Blocked):
                self.service.require_idle()
        for jobs in ('No jobs running.\n','x foo.service start waiting\n','1 foo.service start\n'):
            with self.subTest(jobs=jobs),patch.object(a,'run',side_effect=self.response(jobs=jobs)),\
                 patch.object(self.service,'show',return_value=self.idle),self.assertRaises(a.c.Blocked):
                self.service.require_idle()

    def test_show_requires_exact_property_shape_without_invented_zero(self):
        with patch.object(a,'run',return_value=b'ActiveState=inactive\nJob=\n'):
            self.assertEqual(self.service.show(self.service.TIMER,('ActiveState','Job')),
                             {'ActiveState':'inactive','Job':''})
            with self.assertRaises(a.c.Blocked):
                self.service.show(self.service.TIMER,('ActiveState','Job','ControlPID'))
        with patch.object(a,'run',return_value=b'Job=\nJob=\n'),self.assertRaises(a.c.Blocked):
            self.service.show(self.service.TIMER,('Job',))

    def test_stop_original_loaded_triggers_precedes_reload_of_masks(self):
        events=[];s=self.service;s.MASK_ROOT=self.root/'masks'
        def run(*args,**kw):events.append(args);return b''
        def show(n,keys):return {k:('inactive' if k=='ActiveState' else '0' if k=='ControlPID' else '') for k in keys}
        with patch.object(s,'before'),patch.object(s,'load_path'),patch.object(s,'require'),\
             patch.object(s,'show',side_effect=show),patch.object(a,'prop',return_value='masked'),\
             patch.object(a,'run',side_effect=run):s.close()
        stop=('systemctl','--no-block','stop',s.SOCKET,s.TIMER)
        reload=('systemctl','daemon-reload')
        self.assertEqual(events,[stop,reload])
        for name,state in s.masks.items():
            self.assertEqual(a.path_state(s.MASK_ROOT/name),state)
            self.assertEqual(os.readlink(s.MASK_ROOT/name),'/dev/null')

    def test_unresolved_stop_does_not_reload_or_report_closed(self):
        events=[];s=self.service;s.MASK_ROOT=self.root/'masks'
        def show(n,keys):return {k:('deactivating' if k=='ActiveState' else '0' if k=='ControlPID' else '10') for k in keys}
        with patch.object(s,'before'),patch.object(s,'load_path'),patch.object(s,'require') as require,\
             patch.object(s,'show',side_effect=show),patch.object(a,'run',side_effect=lambda *x,**k:events.append(x) or b''),\
             patch.object(a.time,'monotonic',side_effect=[0,16]),self.assertRaises(a.c.Blocked) as error:
            s.close()
        self.assertEqual(error.exception.code,'PROGRAM_TRIGGER_STOP_UNRESOLVED')
        self.assertEqual(events,[('systemctl','--no-block','stop',s.SOCKET,s.TIMER)])
        require.assert_not_called()

    def test_same_target_foreign_mask_is_not_owned(self):
        s=self.service;s.MASK_ROOT=self.root/'masks';s.MASK_ROOT.mkdir()
        for name in (s.SOCKET,s.TIMER):
            p=s.MASK_ROOT/name;p.symlink_to('/dev/null');s.masks[name]=a.path_state(p)
        replacement=s.MASK_ROOT/'other';replacement.symlink_to('/dev/null')
        os.replace(replacement,s.MASK_ROOT/s.SOCKET)
        with patch.object(s,'load_path'),self.assertRaises(a.c.Blocked) as error:s.require()
        self.assertEqual(error.exception.code,'PROGRAM_FENCE_LOST')
        self.assertTrue((s.MASK_ROOT/s.SOCKET).is_symlink())

    def test_window_expired_at_release_boundary_cannot_remove_any_mask(self):
        s=self.service;s.MASK_ROOT=self.root/'masks';s.MASK_ROOT.mkdir()
        for name in (s.SOCKET,s.TIMER):
            p=s.MASK_ROOT/name;p.symlink_to('/dev/null');s.masks[name]=a.path_state(p)
        h=object.__new__(a.ProgramPairDeployment);h.services=s;h.admission_possible=True
        h.window=Mock(side_effect=a.c.Blocked('WINDOW_EXPIRED'))
        with patch.object(s,'require'),patch.object(s,'loaded_services'),patch.object(s,'load_path'),\
             patch.object(s,'triggers_ready'),patch.object(a,'run') as run,self.assertRaises(a.c.Blocked) as error:
            h.release_and_start_socket()
        self.assertEqual(error.exception.code,'WINDOW_EXPIRED')
        run.assert_not_called()
        self.assertTrue(all(a.path_state(s.MASK_ROOT/n)==v for n,v in s.masks.items()))

    def test_window_expiry_during_reload_prevents_new_start(self):
        s=self.service;s.MASK_ROOT=self.root/'masks';s.MASK_ROOT.mkdir()
        for name in (s.SOCKET,s.TIMER):
            p=s.MASK_ROOT/name;p.symlink_to('/dev/null');s.masks[name]=a.path_state(p)
        expired=False;events=[]
        def guard():a.c.need(not expired,'WINDOW_EXPIRED')
        def run(*args,**kwargs):
            nonlocal expired
            events.append(args)
            if args==('systemctl','daemon-reload'):expired=True
            return b''
        with patch.object(s,'require'),patch.object(s,'loaded_services'),patch.object(s,'load_path'),\
             patch.object(a,'run',side_effect=run),self.assertRaises(a.c.Blocked) as error:
            s.release_and_start(True,admission_guard=guard)
        self.assertEqual(error.exception.code,'WINDOW_EXPIRED')
        self.assertEqual(events,[('systemctl','daemon-reload')])

    def test_new_admission_without_window_callback_is_refused_before_any_action(self):
        with patch.object(a,'run') as run,self.assertRaises(a.c.Blocked) as error:
            self.service.release_and_start(True)
        self.assertEqual(error.exception.code,'PROGRAM_ADMISSION_WINDOW_REQUIRED')
        run.assert_not_called()

    def test_closed_exclusion_prevents_service_calls(self):
        self.exclusion.__exit__(None,None,None)
        with patch.object(a,'run') as run,self.assertRaises(a.c.Blocked):self.service.close()
        run.assert_not_called()


class DeploymentBindings(unittest.TestCase):
    def host(self):
        h=object.__new__(a.ProgramPairDeployment)
        h.product=SimpleNamespace(tool_pin='b'*64,prepared_hash='c'*64,bundle=Path('/fixture/bundle'))
        h.source=Path('/fixture/program');h.unit_candidates=Path('/fixture/units')
        h.planned={'schema':'alisa-program-pair-activation-plan/v1','status':'PROGRAM_PLAN_NOT_APPLIED',
                   'source_commit':a.c.PRODUCT,'tool_sha256':'b'*64,'prepared_sha256':'c'*64,
                   'bundle':'/fixture/bundle','program_source':'/fixture/program','program_units':'/fixture/units',
                   'before':{'bound':'fixture'}}
        h.plan_hash=a.c.digest(a.c.encoded(h.planned))
        h.coordination={'schema':'alisa-r15-maintenance-coordination/v1','source_commit':a.c.PRODUCT,
                        'activation_plan_sha256':h.plan_hash,'tool_sha256':'b'*64,'prepared_sha256':'c'*64,
                        'nonce':'d'*32,'issued_at':999,'expires_at':1100,
                        'coordination':'OWNER_BROWSER_AND_VOICE_WINDOW_CONFIRMED'}
        h.make_plan=Mock(return_value=dict(h.planned))
        return h

    def test_exact_plan_and_fresh_bound_window_required_before_backup(self):
        h=self.host()
        with patch.object(a.time,'time',return_value=1000):h.check_plan_and_window()
        h.make_plan.assert_called_once()
        for field in ('schema','status','source_commit','tool_sha256','prepared_sha256','bundle','program_source','program_units'):
            h=self.host();h.planned[field]='unrelated'
            with self.subTest(field=field),patch.object(a.time,'time',return_value=1000),self.assertRaises(a.c.Blocked):h.check_plan_and_window()
            h.make_plan.assert_not_called()

    def test_expired_or_differently_bound_window_never_probes_or_writes(self):
        for field,value in (('expires_at',999),('activation_plan_sha256','e'*64),('source_commit','f'*40)):
            h=self.host();h.coordination[field]=value
            with self.subTest(field=field),patch.object(a.time,'time',return_value=1000),self.assertRaises(a.c.Blocked):h.check_plan_and_window()
            h.make_plan.assert_not_called()

    def test_changed_live_snapshot_refuses_even_with_original_plan_hash(self):
        h=self.host();h.make_plan.return_value={**h.planned,'before':{'bound':'changed'}}
        with patch.object(a.time,'time',return_value=1000),self.assertRaises(a.c.Blocked) as error:h.check_plan_and_window()
        self.assertEqual(error.exception.code,'PROGRAM_PLAN_CHANGED')

    def test_successful_product_readiness_is_required_not_replaced_by_zero(self):
        h=self.host();h.make_plan.side_effect=a.readiness.Blocked('READINESS_BUSY')
        with patch.object(a.time,'time',return_value=1000),self.assertRaises(a.readiness.Blocked):h.check_plan_and_window()


if __name__=='__main__':unittest.main()
