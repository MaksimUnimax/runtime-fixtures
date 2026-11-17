#!/usr/bin/env python3
"""S13 real PostgreSQL, current signed authority and Unix worker; synthetic IO."""
import argparse
from copy import deepcopy
from datetime import datetime,timezone as datetime_timezone,timedelta
import hashlib
import json
import os
from pathlib import Path
import socket
import sqlite3
import unittest
from unittest.mock import patch

from query_roundtrip import QueryChecks, connections, TEMP, uid, timezone, AccessAdjustment
from checks import settings
from django.db import connection, transaction, DatabaseError
from django.test import override_settings
from alisa_platform.catalog import changes, control, release_views
from alisa_platform.catalog.bridge import NativeCatalog, ControlOnly
from alisa_platform.catalog.models import (CatalogDraft, CatalogRelease, CatalogAssignment,
    CatalogPublication, CatalogDecision)
from alisa_platform.catalog.package_rules import ReleaseFailure, digest
from alisa_platform.query_insights.models import DemandCluster, DemandCandidate
from alisa_platform.staff.models import StaffMember, StaffSession, StaffAuthFlow
from alisa_platform.runtime_adapter.job_client import RuntimeClient, RuntimeFailure
from engine import Worker
from model_answer import Settings
from test_template_only import Transport, selection
import runtime_port_ipc
import template_runtime
import template_catalog
import report_archive
import question_catalog_extension
from catalog_release import native

# Negative evidence-file cases below may only mutate the source fixture owned
# by this existing CI launcher. Never accept an installed or caller-picked core.
_source=Path(os.environ['ALISA_RT_JOB_TEST_SOURCE']).resolve()
_product=Path(__file__).resolve().parents[2]
_relative=_source.relative_to(_product)
if (os.environ.get('GITHUB_ACTIONS')!='true' or
    not _relative.parts[0].startswith('s07-qual-') or
    json.loads((_source/'CURRENT_CORE_MANIFEST.json').read_text()).get('catalog_release_overlay')!='catalog-release-v1'):
    raise RuntimeError('OWNED_GENERATED_CATALOG_CORE_REQUIRED')


class ReleaseChecks(unittest.TestCase):
    def setUp(self):
        self.f=QueryChecks('runTest');self.f.setUp()
        self.addCleanup(self.f.doCleanups);self.addCleanup(self.f.tearDown)
        # One clock for current authority claims and worker scheduling. Never
        # extend a ticket lifetime or bypass expiry for the multi-job scenario.
        clock=patch.object(timezone,'now',side_effect=lambda:datetime.fromtimestamp(self.f.clock(),datetime_timezone.utc))
        clock.start();self.addCleanup(clock.stop)
        flags=override_settings(CATALOG_RELEASE_ENABLED=True,QUESTION_CATALOG_ENABLED=True,
            QUERY_INSIGHTS_ENABLED=True,STAFF_ENABLED=True,STAFF_CLIENT_ID='fixture-staff',
            STAFF_SERVICE_TOKEN='S'*48,CATALOG_PILOT_TENANTS=(str(self.f.tenant.pk),))
        flags.enable();self.addCleanup(flags.disable)
        authority=patch.object(changes,'configured_authority',return_value=self.f.authority)
        authority.start();self.addCleanup(authority.stop)
        self.f.engine.template_mode=True
        self.f.engine.answer_settings=Settings(Path(self.f.folder.name)/'answer.json')
        self.f.repo.answer_settings=self.f.engine.answer_settings
        self.f.transport=Transport();self.f.worker=Worker(self.f.engine,self.f.transport)
        self.f.transport.selection=selection(['B01.ordered_units','B01.ordered_revenue'],store='native-store')
        originals={name:getattr(template_runtime,name)for name in
            ('authorized','submit','gap_result','worker_step','_gap','_compile_and_save_selection')}
        for name,value in originals.items():self.addCleanup(setattr,template_runtime,name,value)
        self.addCleanup(setattr,template_catalog,'compile_selection',template_catalog.compile_selection)
        self.addCleanup(setattr,report_archive,'capture',report_archive.capture)
        self.addCleanup(lambda:template_runtime.__dict__.pop('_catalog_release_router',None))
        self.addCleanup(setattr,question_catalog_extension,'read',question_catalog_extension.read)
        self.addCleanup(setattr,runtime_port_ipc,'dispatch',runtime_port_ipc.dispatch)
        question_catalog_extension.install()
        self.registry=native.install(self.f.port)
        self.client=NativeCatalog(RuntimeClient(str(self.f.gateway.server_address),self.f.client.uid,
            self.f.client.versions,ControlOnly(),clock=self.f.clock))
        self.info=self.client.info()
        self.editor,self.editor_member,_=self.staff(['catalog.edit'])
        self.approver,_,_=self.staff(['catalog.approve'])
        self.publisher,self.publisher_member,self.publisher_session=self.staff(['catalog.publish'])
        cluster=DemandCluster.objects.create(fingerprint=digest({'fixture':uid()}),
            profile={'scope':'S13_SYNTHETIC'},example='Заказанные товары')
        self.candidate=DemandCandidate.objects.create(cluster=cluster,policy_revision=1,
            evidence={'scope':'S13_SYNTHETIC_CANDIDATE'})

    def staff(self,permissions):
        now=timezone.now();token=uid()+uid()
        member=StaffMember.objects.create(issuer=settings.IDENTITY_ISSUER,
            client_id=settings.STAFF_CLIENT_ID,subject=uid(),name='S13 fixture',role='ADMIN',permissions=permissions)
        flow=StaffAuthFlow.objects.create(secret_hash=hashlib.sha256(uid().encode()).hexdigest(),
            encrypted_payload='',expires_at=now+timedelta(minutes=10),consumed_at=now)
        session=StaffSession.objects.create(member=member,flow=flow,
            token_hash=hashlib.sha256(token.encode()).hexdigest(),revision=1,mfa_verified_at=now,
            mfa_type='totp',encrypted_payload='',expires_at=now+timedelta(minutes=50))
        return token,member,session

    def payload(self):
        suffix=uid().replace('-','').translate(str.maketrans('0123456789','klmnopqrst'))
        return {'schema':'alisa-catalog-package/v1',
            **{k:self.info[k]for k in ['engine_sha256','base_template_hash','qualification_sha256']},
            'additions':[{'kind':'ALIAS','id':'PILOT.'+suffix,
                'purpose':'Количество заказанных штук '+suffix,
                'template_ids':['B01.ordered_units'],
                'answer_spec':{'meaning':'Заказанные единицы, по дате заказа',
                    'known_negatives':['Не выкупы, не выплаты и не прибыль']}}]}

    def draft(self,value=None):
        return changes.fast('draft.create',{'candidate_id':str(self.candidate.pk),
            'package':value or self.payload()},self.editor)

    def approve(self,value=None):
        draft=self.draft(value)
        valid=changes.validate({'draft_id':draft['id'],'expected_revision':1},self.editor,lambda:self.client)
        self.assertTrue(valid['valid'],valid)
        result=changes.fast('approve',{'draft_id':draft['id'],'expected_revision':1,
            'validation_id':valid['validation_id'],'package_sha256':draft['package_sha256'],
            'reviewed':True},self.approver)
        return result['package_sha256']

    def command(self,target,expected=0):
        return {'request_id':uid(),'tenant_id':str(self.f.tenant.pk),
            'expected_revision':expected,'package_sha256':target}

    def publish(self,target,expected=0):
        command=self.command(target,expected)
        result=changes.publish('publish'if target else'rollback',command,self.publisher,lambda:self.client)
        self.assertEqual(result['state'],'APPLIED',result)
        return command

    def deny(self,code,call):
        with self.assertRaises(ReleaseFailure)as caught:call()
        self.assertEqual(caught.exception.code,code)

    def submit(self):return self.f.submit('Количество и сумма заказанных товаров за второе ноября')

    def finish(self,receipt):
        for _ in range(120):
            row=self.f.row(receipt)
            if row['state']not in {'QUEUED','RUNNING'}:break
            self.f.clock.advance(max(0,row['due']-self.f.clock())+1);self.f.worker.step()
        row=self.f.row(receipt)
        self.assertEqual(row['state'],'READY',row['error']);self.assertIsNone(row['error'])
        self.assertTrue(self.f.client.read_result(receipt['job_ref'])['complete'])
        return row

    def plan(self,receipt):return json.loads(self.f.row(receipt)['plan'])

    def test_waiting_old_job_new_job_and_rollback_keep_immutable_binding(self):
        before=self.f.port.versions_for(self.f.peer)
        first=self.approve();self.publish(first)
        old=self.submit();old_plan=self.plan(old)
        second=self.approve();self.publish(second,1)
        new=self.submit();new_plan=self.plan(new)
        self.assertEqual(old_plan['catalog_package_sha256'],first)
        self.assertEqual(new_plan['catalog_package_sha256'],second)
        self.publish('',2)
        baseline=self.submit();self.assertNotIn('catalog_package_sha256',self.plan(baseline))
        for receipt in [old,new,baseline]:self.finish(receipt)
        self.assertEqual(before,self.f.port.versions_for(self.f.peer))
        self.assertEqual(self.plan(old)['catalog_package_sha256'],first)
        self.assertEqual(self.plan(new)['catalog_package_sha256'],second)
        plans=[self.plan(x)for x in [old,new,baseline]]
        self.assertEqual(plans[0]['fragments'][0]['plan'],plans[1]['fragments'][0]['plan'])
        self.assertEqual(plans[1]['fragments'][0]['plan'],plans[2]['fragments'][0]['plan'])
        self.assertEqual([c.operation for c in self.f.transport.calls].count('ozon_orders'),3)
        calls=len(self.f.transport.calls)
        for receipt in [old,new,baseline]:self.f.client.read_result(receipt['job_ref'])
        self.assertEqual(len(self.f.transport.calls),calls)

    def test_alias_executes_existing_numeric_source_without_new_operator(self):
        value=self.payload();target=self.approve(value);self.publish(target)
        catalog=question_catalog_extension.read(self.f.port,self.f.peer,
            self.f.authorizer.prepare('capabilities'),
            {'search':value['additions'][0]['id'],'kind':'','offset':0})
        self.assertEqual([row['id']for row in catalog['items']],[value['additions'][0]['id']])
        self.assertEqual(catalog['template_hash'],self.registry.snapshot(target).template_hash)
        self.assertEqual(self.f.transport.calls,[])
        self.f.transport.selection=selection([value['additions'][0]['id']],store='native-store')
        receipt=self.submit()
        self.assertEqual(len(template_catalog.compile_selection(self.f.engine,self.plan(receipt),self.f.transport.selection)),1)
        self.finish(receipt)
        self.assertEqual([c.operation for c in self.f.transport.calls],
            ['template_select','ozon_orders','model_answer'])
        self.assertEqual(self.f.transport.calls[1].body['metrics'],['ordered_units'])
        raw=self.f.transport.calls[-1].body['messages'][-1]['content']
        data=json.loads(raw.split('\n',1)[1])
        def metrics(value):
            if isinstance(value,dict):
                if 'metrics'in value:yield value['metrics']
                for child in value.values():yield from metrics(child)
            elif isinstance(value,list):
                for child in value:yield from metrics(child)
        self.assertIn([4],list(metrics(data)))
        snapshot=self.registry.snapshot(target)
        self.assertEqual(snapshot.catalog.TEMPLATES['B01.ordered_units'],
            template_catalog.TEMPLATES['B01.ordered_units'])
        self.assertEqual(snapshot.evidence['inherited'][0]['base_template_ids'],['B01.ordered_units'])

    def test_report_archive_preserves_alias_identity_and_package_template_hash(self):
        value=self.payload();target=self.approve(value);self.publish(target)
        self.f.transport.selection=selection([value['additions'][0]['id']],store='native-store')
        archive=report_archive.Archive(self.f.repo);self.f.engine.report_archive=archive
        receipt=self.submit();self.finish(receipt)
        with archive.connection()as conn:
            rows=conn.execute('SELECT template_id,template_name,catalog_hash FROM reports WHERE tenant=?',
                ['native-tenant']).fetchall()
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['template_id'],value['additions'][0]['id'])
        self.assertEqual(rows[0]['template_name'],value['additions'][0]['purpose'])
        self.assertEqual(rows[0]['catalog_hash'],self.registry.snapshot(target).template_hash)

    def test_lost_ack_requires_actual_readback_same_id_and_one_effect(self):
        target=self.approve();command=self.command(target);real=self.client.apply
        def lost(*args):
            real(*args);raise RuntimeFailure('UNKNOWN_OUTCOME',outcome='UNKNOWN')
        with patch.object(self.client,'apply',side_effect=lost):
            result=changes.publish('publish',command,self.publisher,lambda:self.client)
        self.assertEqual(result['state'],'PENDING')
        self.assertEqual(CatalogAssignment.objects.get(pk=self.f.tenant.pk).applied_revision,0)
        with patch.object(self.client,'apply',side_effect=AssertionError('replayed mutation')):
            for _ in range(2):
                result=changes.publish('retry',{'request_id':command['request_id']},self.publisher,lambda:self.client)
                self.assertEqual(result['state'],'APPLIED')
        with self.f.repo.connection()as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM catalog_commands').fetchone()[0],1)
        self.assertEqual(CatalogDecision.objects.filter(action='READBACK_APPLIED',object_id=command['request_id']).count(),1)

    def test_changed_duplicate_intent_and_nonpilot_are_rejected_before_apply(self):
        target=self.approve();command=self.publish(target)
        self.deny('CATALOG_IDEMPOTENCY_CONFLICT',lambda:changes.publish('rollback',
            {**command,'package_sha256':''},self.publisher,lambda:self.client))
        other={**self.command(target,1),'tenant_id':uid()}
        self.deny('CATALOG_TENANT_NOT_ALLOWED',lambda:changes.publish('publish',other,self.publisher,lambda:self.client))

    def test_editor_cannot_approve_or_publish_and_model_json_cannot_approve(self):
        target=self.approve()
        self.deny('CATALOG_FORBIDDEN',lambda:changes.publish('publish',self.command(target),self.editor,lambda:self.client))
        self.deny('CATALOG_FORBIDDEN',lambda:changes.fast('approve',{},self.editor))
        self.assertFalse(CatalogAssignment.objects.filter(pk=self.f.tenant.pk).exists())
        changed=self.payload();changed['additions'][0]['kind']='EXECUTE_PYTHON'
        self.deny('CATALOG_CORE_CHANGE_REQUIRED',lambda:self.draft(changed))

    def test_stale_approval_after_edit_cannot_release_old_or_new_payload(self):
        draft=self.draft();valid=changes.validate({'draft_id':draft['id'],'expected_revision':1},self.editor,lambda:self.client)
        changes.fast('draft.edit',{'draft_id':draft['id'],'expected_revision':1,'package':self.payload()},self.editor)
        self.deny('CATALOG_APPROVAL_HASH_MISMATCH',lambda:changes.fast('approve',{'draft_id':draft['id'],
            'expected_revision':2,'validation_id':valid['validation_id'],
            'package_sha256':draft['package_sha256'],'reviewed':True},self.approver))

    def test_semantic_collision_unknown_source_and_qualification_are_negative(self):
        for mutate,code in [
            (lambda p:p['additions'][0].update(purpose=template_catalog.TEMPLATES['B01.ordered_units']['purpose']),
             'CATALOG_SEMANTIC_COLLISION'),
            (lambda p:p['additions'][0].update(template_ids=['INVENTED.source']),'CATALOG_SOURCE_UNQUALIFIED'),
            (lambda p:p.update(qualification_sha256='0'*64),'CATALOG_QUALIFICATION_CHANGED')]:
            value=self.payload();mutate(value);result=self.client.validate(value)
            self.assertEqual(result,{'valid':False,'code':code})
        receipt=self.registry.factory.root/'catalog_release/base_qualification.json'
        backup=receipt.with_suffix('.owned-backup');receipt.rename(backup)
        try:
            result=self.client.validate(self.payload())
            self.assertEqual(result,{'valid':False,'code':'CATALOG_QUALIFICATION_MISSING'})
        finally:backup.rename(receipt)

    def test_revoked_staff_ticket_does_not_change_native_assignment(self):
        target=self.approve();command=self.command(target)
        publication=changes.prepare_publication('publish',command,self.publisher,self.info)
        ticket=control.mint(publication.pk,self.publisher)
        self.publisher_member.revision+=1;self.publisher_member.save(update_fields=['revision'])
        with self.assertRaises(RuntimeFailure):self.client.apply(command['request_id'],CatalogRelease.objects.get(pk=target).package,ticket)
        self.assertEqual(self.registry.readback('native-tenant')['assignment_revision'],0)

    def test_source_revocation_before_dispatch_keeps_zero_provider_calls(self):
        target=self.approve();self.publish(target);receipt=self.submit()
        AccessAdjustment.objects.create(id=uid(),grant=self.f.grant,cutoff=self.f.grant.starts_at,
            actor_id=uid(),reason='S13_OWNED_FIXTURE_REVOKE')
        self.f.worker.step()
        self.assertEqual(self.f.row(receipt)['state'],'FAILED')
        self.assertEqual(self.f.transport.calls,[])

    def test_durable_package_and_publication_intent_are_database_immutable(self):
        target=self.approve();command=self.publish(target)
        with self.assertRaises(DatabaseError),transaction.atomic():
            with connection.cursor()as cursor:
                cursor.execute('UPDATE catalog_catalogrelease SET package=%s WHERE package_sha256=%s',['{}',target])
        with self.assertRaises(DatabaseError),transaction.atomic():
            CatalogPublication.objects.filter(pk=command['request_id']).update(template_hash='0'*64)
        with self.assertRaises(sqlite3.DatabaseError):
            with self.f.repo.connection(True)as conn:conn.execute('UPDATE catalog_packages SET payload=?',('{}',))
        with self.assertRaises(sqlite3.DatabaseError):
            with self.f.repo.connection(True)as conn:conn.execute('DELETE FROM catalog_commands')
        self.assertEqual(self.registry.readback('native-tenant')['package_sha256'],target)

    def test_final_principal_loss_rolls_back_draft_and_audit(self):
        before=CatalogDraft.objects.count();decisions=CatalogDecision.objects.count()
        with patch.object(changes,'principal',side_effect=[self.editor_member,None]):
            self.deny('CATALOG_FORBIDDEN',lambda:self.draft())
        self.assertEqual(CatalogDraft.objects.count(),before)
        self.assertEqual(CatalogDecision.objects.count(),decisions)

    def test_flag_off_retains_pinned_job_but_new_admission_uses_base(self):
        target=self.approve();self.publish(target);old=self.submit()
        self.registry.admissions_enabled=False
        new=self.submit();self.assertNotIn('catalog_package_sha256',self.plan(new))
        self.finish(old);self.finish(new)
        self.assertEqual(self.plan(old)['catalog_package_sha256'],target)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();original=socket.socket.connect
    def confined(peer,address):
        if peer.family==socket.AF_UNIX or peer.family==socket.AF_INET and address==('127.0.0.1',55480):
            return original(peer,address)
        raise AssertionError('External network forbidden')
    try:
        with patch.object(socket.socket,'connect',confined),patch('socket.getaddrinfo',side_effect=AssertionError('DNS forbidden')):
            result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ReleaseChecks))
        args.output.write_text(json.dumps({'scope':'S13_REAL_PG_UNIX_SYNTHETIC_IO_NOT_INSTALLED',
            'status':'PASS'if result.wasSuccessful()else'FAILED','tests_run':result.testsRun,
            'failures':len(result.failures),'errors':len(result.errors),'provider_calls':0,'installed':False},indent=2)+'\n')
        raise SystemExit(0 if result.wasSuccessful()else 1)
    finally:connections.close_all();TEMP.cleanup()
