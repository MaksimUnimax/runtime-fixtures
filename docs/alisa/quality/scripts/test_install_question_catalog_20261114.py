"""Failure injection on owned files only; no systemd, production config or DB."""
import importlib.util
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('catalog_install',Path(__file__).with_name('install_question_catalog_20261114.py'))
i=importlib.util.module_from_spec(spec);spec.loader.exec_module(i)

class Rollback(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        root=Path(self.temp.name);self.records={};self.events=[];self.phase='apply'
        self.root=root;self.flag=root/'catalog.env';self.drop=root/'catalog.conf'
        m=SimpleNamespace(SOURCE='a'*40)
        for n in ['NATIVE_BASE','NATIVE','WEB_BASE','WEB_APP','APP','BASE']:
            p=root/n;p.mkdir();setattr(m,n,p)
        m.CURRENT=root/'current';m.CURRENT.symlink_to(m.NATIVE_BASE)
        m.WEB=root/'web';m.WEB.symlink_to(m.WEB_BASE)
        for n in ['VERSIONS','PROJECTION','LINK_ENV']:
            p=root/n;p.write_bytes(('original-'+n).encode());setattr(m,n,p)
        def atomic(p,raw,mode=0o600):
            p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
        def pointer(p,target):p.unlink();p.symlink_to(target)
        def sync(target,lock):
            self.events.append(('sync',self.phase,target))
            if self.phase=='rollback' and self.failure=='sync':raise RuntimeError('sync failure')
            m.VERSIONS.write_bytes(b'old-pins' if target==m.NATIVE_BASE else b'new-pins')
        def refresh(original,on_write=None):
            self.events.append(('projection',self.phase))
            if self.phase=='rollback' and self.failure=='projection':raise RuntimeError('projection failure')
            raw=b'old-projection' if m.CURRENT.resolve()==m.NATIVE_BASE else b'new-projection'
            m.PROJECTION.write_bytes(raw)
            if on_write:on_write(raw)
        m.atomic=atomic;m.pointer=pointer;m.run=lambda *args:self.events.append(('run',self.phase,args))
        m.record=lambda name,value:self.records.update({name:value})
        pair=SimpleNamespace(projection_data=lambda:{'synthetic':True},
            expected_version_bytes=lambda target:b'new-pins',sync=sync,refresh_projection=refresh)
        m.pair=lambda:pair;self.m=m;self.failure=''
        for name,value in [('ROOT',root),('FLAG',self.flag),('SELECTORS',{'fixture':self.drop})]:
            p=patch.object(i,name,value);p.start();self.addCleanup(p.stop)
        self.patch('checked',lambda *a:{'units':{u:{} for u in i.PRESERVE}})
        self.patch('drops',lambda m:{self.drop:b'new-drop'})
        self.patch('idle',lambda:None)
        def ready(m,rollback=False):
            if rollback:return
            self.phase='rollback';raise RuntimeError('injected readiness failure')
        self.patch('ready',ready)
        def stop(m,u):
            self.events.append(('stop',self.phase,u))
            if self.phase=='rollback' and self.failure=='stop' and u==i.UNITS[0]:raise RuntimeError('STOP_OUTCOME_UNRESOLVED')
            if self.phase=='rollback' and self.failure=='writer':self.flag.write_bytes(b'later-writer')
        self.patch('stop',stop)
    def patch(self,name,value):
        p=patch.object(i,name,value);p.start();self.addCleanup(p.stop)
    def rollback_starts(self):
        return [e for e in self.events if e[0]=='run' and e[1]=='rollback' and e[2][:2]==('systemctl','start')]
    def run_failure(self):
        with self.assertRaises(RuntimeError):i.apply({},self.m,object())
    def test_readiness_failure_restores_old_selectors_and_removes_only_own_files(self):
        self.run_failure()
        self.assertEqual(self.m.CURRENT.resolve(),self.m.NATIVE_BASE)
        self.assertEqual(self.m.WEB.resolve(),self.m.WEB_BASE)
        self.assertFalse(self.flag.exists());self.assertFalse(self.drop.exists())
        self.assertEqual(self.m.LINK_ENV.read_bytes(),b'original-LINK_ENV')
        self.assertEqual(self.records['ROLLED_BACK.json']['status'],'ROLLED_BACK')
    def test_unresolved_stop_keeps_candidate_selectors_pins_and_configuration(self):
        self.failure='stop';self.run_failure()
        self.assertEqual(self.m.CURRENT.resolve(),self.m.NATIVE)
        self.assertEqual(self.m.VERSIONS.read_bytes(),b'new-pins')
        self.assertTrue(self.flag.exists());self.assertTrue(self.drop.exists())
        self.assertEqual(self.rollback_starts(),[])
        self.assertEqual(self.records['ROLLED_BACK.json']['status'],'ROLLBACK_STOP_UNRESOLVED')
    def test_writer_during_stop_is_not_overwritten(self):
        self.failure='writer';self.run_failure()
        self.assertEqual(self.flag.read_bytes(),b'later-writer')
        self.assertEqual(self.m.CURRENT.resolve(),self.m.NATIVE)
        self.assertTrue(self.drop.exists());self.assertEqual(self.rollback_starts(),[])
    def test_failed_old_version_sync_never_starts_any_service(self):
        self.failure='sync';self.run_failure()
        self.assertEqual(self.rollback_starts(),[])
        self.assertEqual(self.records['ROLLED_BACK.json']['status'],'ROLLBACK_PREREQUISITE_FAILED')
    def test_failed_owner_projection_never_starts_dependent_backends(self):
        self.failure='projection';self.run_failure()
        self.assertEqual([e[2][-1] for e in self.rollback_starts()],[i.UNITS[0]])
        self.assertEqual(self.records['ROLLED_BACK.json']['status'],'ROLLBACK_PROJECTION_FAILED')
    def test_foreign_selector_is_rejected_before_rollback_mutation(self):
        self.m.CURRENT.unlink();foreign=self.root/'foreign';foreign.mkdir();self.m.CURRENT.symlink_to(foreign)
        with self.assertRaisesRegex(RuntimeError,'ROLLBACK_LATER_WRITER'):
            i.rollback_guard(self.m,{}, {},{},b'flag')

if __name__=='__main__':unittest.main()
