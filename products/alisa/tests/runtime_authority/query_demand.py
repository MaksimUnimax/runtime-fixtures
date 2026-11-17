#!/usr/bin/env python3
"""S12 contracts in the existing disposable PostgreSQL/Unix authority fixture."""
import argparse
import json
import socket
import unittest
from copy import deepcopy
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch
from django.db import transaction
from django.test import override_settings
from query_insights import InsightsChecks, connections, TEMP
from alisa_platform.query_insights import demand, views
from alisa_platform.query_insights.demand_rules import DEFAULT_POLICY
from alisa_platform.query_insights.models import (Episode, DemandPolicy, DemandCluster,
    DemandContribution, DemandReceipt, DemandCandidate, DemandDecision)


class DemandChecks(unittest.TestCase):
    @staticmethod
    def clear():
        DemandDecision.objects.all().delete()
        DemandCandidate.objects.all().delete()
        DemandContribution.objects.all().delete()
        DemandReceipt.objects.all().delete()
        DemandCluster.objects.all().update(merged_into=None)
        DemandCluster.objects.all().delete()
        DemandPolicy.objects.all().delete()

    def setUp(self):
        self.clear()
        self.fixture = InsightsChecks('runTest')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.flags = override_settings(QUERY_DEMAND_ENABLED=True)
        self.flags.enable()
        self.addCleanup(self.flags.disable)
        self.addCleanup(self.clear)
        self.token, self.owner, _ = self.fixture.staff()
        self.owner.role = 'OWNER'
        self.owner.save(update_fields=['role'])

    def event(self, client=1, days=1, **changes):
        return self.fixture.event(tenant_pseudonym=f'{client:064x}',
            occurred_at=(self.fixture.now-timedelta(days=days)).isoformat(),
            final_outcome='UNSUPPORTED', **changes)

    def send(self, events):
        for offset in range(0, len(events), 16):
            self.fixture.send(events[offset:offset+16])

    def execute(self, action, data):
        with transaction.atomic():
            return demand.command(action, data, self.owner)

    def api(self, token, action, data):
        return self.fixture.staff_request(token, action='demand.'+action, filters=data)

    def test_general_threshold_and_retry_create_one_candidate(self):
        events = [self.event(client, day) for client in range(1,6) for day in range(1,5)]
        self.send(events)
        self.send(events)
        self.execute('refresh', {})
        self.assertEqual(DemandCandidate.objects.count(), 1)
        self.assertEqual(DemandContribution.objects.count(), 20)
        evidence = DemandCandidate.objects.get().evidence
        self.assertEqual((evidence['general']['raw'], evidence['general']['contributions'],
                          evidence['general']['clients']), (20,20,5))
        self.assertEqual(DemandDecision.objects.filter(action='CANDIDATE_CREATED').count(), 1)

    def test_one_hundred_logical_ids_have_one_daily_contribution(self):
        self.send([self.event() for _ in range(100)])
        item = demand.listing({})['items'][0]
        self.assertEqual((item['general']['raw'], item['general']['contributions'],
                          item['general']['clients']), (100,1,1))
        self.assertIsNone(item['candidate'])

    def test_paid_at_event_threshold_and_later_revision_cannot_rewrite_basis(self):
        events = [self.event(client, day, access_basis_at_event='PAYMENT')
                  for client,day in [(1,1),(1,2),(2,1),(2,2),(3,1)]]
        self.send(events)
        candidate = DemandCandidate.objects.get()
        self.assertEqual(candidate.evidence['trigger'], 'PAID_AT_EVENT')
        changed = deepcopy(events[0])
        from uuid import uuid4
        changed.update(event_id=str(uuid4()), episode_revision=2, access_basis_at_event='GIFT')
        self.send([changed])
        self.assertEqual(demand.listing({})['items'][0]['paid']['contributions'], 5)

    def test_internal_checks_never_create_customer_candidates(self):
        for client in range(1,6):
            for day in range(1,5):
                event = self.event(client, day, internal_test=True, access_basis_at_event='PAYMENT')
                self.fixture.send([event], internal_test=True)
        self.assertEqual(DemandCandidate.objects.count(), 0)
        self.assertEqual(demand.listing({})['items'], [])

    def test_explicit_lexical_equivalents_share_one_cluster(self):
        self.send([self.event(safe_utterance='Покажи заказы за вчера'),
                   self.event(safe_utterance='Покажите заказов за вчера')])
        self.assertEqual(DemandCluster.objects.count(), 1)
        self.assertEqual(DemandContribution.objects.count(), 2)

    def test_incompatible_date_axis_or_exclusion_cannot_merge(self):
        self.send([self.event(semantic_axis='order_date'), self.event(semantic_axis='event_date'),
                   self.event(safe_utterance='Покажи все выкупы за вчера')])
        rows = list(DemandCluster.objects.all())
        for other in rows[1:]:
            with self.assertRaises(demand.DemandFailure) as caught:
                self.execute('merge', {'source':str(rows[0].pk), 'source_revision':1,
                    'target':str(other.pk), 'target_revision':1})
            self.assertEqual(caught.exception.code, 'DEMAND_INCOMPATIBLE_MEANING')
        self.assertEqual(DemandContribution.objects.count(), 3)

    def test_split_and_merge_preserve_origin_and_do_not_double_count(self):
        self.send([self.event(client, day) for client in (1,2) for day in (1,2)])
        source = DemandCluster.objects.get()
        before = {str(m.pk):str(m.origin_id) for m in DemandContribution.objects.all()}
        chosen = list(before)[:2]
        split = self.execute('split', {'cluster':str(source.pk), 'expected_revision':1, 'episodes':chosen})
        source.refresh_from_db()
        self.execute('merge', {'source':split['cluster'], 'source_revision':split['revision'],
            'target':str(source.pk), 'target_revision':source.revision})
        self.assertEqual({str(m.pk):str(m.origin_id) for m in DemandContribution.objects.all()}, before)
        item = demand.listing({})['items'][0]
        self.assertEqual((item['general']['raw'],item['general']['contributions']), (4,4))
        self.assertEqual(len(demand.listing({})['items']), 1)

    def test_rare_defect_and_provider_waiting_do_not_need_threshold(self):
        self.send([self.event(), self.event(safe_utterance='Покажи расходы на рекламу за вчера')])
        first, second = list(DemandCluster.objects.all())
        urgent = self.execute('create', {'cluster':str(first.pk),'expected_revision':1,
                                        'reason':'CONFIRMED_FINANCIAL_ERROR'})
        waiting = self.execute('create', {'cluster':str(second.pk),'expected_revision':1,
                                         'reason':'PROVIDER_DEPENDENCY'})
        self.assertEqual(urgent['priority'], 'URGENT')
        self.assertEqual(waiting['state'], 'WAITING_FOR_PROVIDER')
        self.assertEqual(DemandCandidate.objects.count(), 2)

    def test_creation_retry_does_not_overwrite_later_workflow(self):
        self.send([self.event()])
        cluster = DemandCluster.objects.get()
        request = {'cluster':str(cluster.pk), 'expected_revision':1, 'reason':'CONFIRMED_DEFECT'}
        candidate = self.execute('create', request)
        self.execute('update', {'cluster':str(cluster.pk), 'expected_revision':1,
            'candidate_revision':candidate['revision'], 'state':'ACCEPTED', 'priority':'NORMAL',
            'assignee_id':str(self.owner.pk), 'reason':'REVIEW_COMPLETE'})
        repeated = self.execute('create', request)
        self.assertEqual((repeated['state'],repeated['priority'],repeated['assignee_id']),
                         ('ACCEPTED','NORMAL',str(self.owner.pk)))
        self.assertEqual(DemandCandidate.objects.count(), 1)

    def test_read_permission_does_not_allow_mutation(self):
        token, _, _ = self.fixture.staff(('insights.read',))
        self.assertEqual(self.api(token,'list',{}).status_code, 200)
        response = self.api(token,'policy',{'expected_revision':0,'policy':dict(DEFAULT_POLICY)})
        self.assertEqual(response.status_code, 403)
        self.assertFalse(DemandPolicy.objects.exists())

    def test_final_authority_refusal_rolls_back_policy_and_audit(self):
        with patch.object(views, 'principal', side_effect=[self.owner, None]):
            response = self.api(self.token,'policy',{'expected_revision':0,'policy':dict(DEFAULT_POLICY)})
        self.assertEqual(response.status_code, 403)
        self.assertFalse(DemandPolicy.objects.exists())
        self.assertFalse(DemandDecision.objects.exists())

    def test_invalid_uuid_and_boolean_policy_are_rejected_without_changes(self):
        response = self.api(self.token,'list',{'cluster':'not-a-uuid'})
        self.assertEqual(response.status_code, 422)
        invalid = {**DEFAULT_POLICY, 'min_clients':True}
        response = self.api(self.token,'policy',{'expected_revision':0,'policy':invalid})
        self.assertEqual(response.status_code, 422)
        self.assertFalse(DemandPolicy.objects.exists())


if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();original=socket.socket.connect
    def confined(peer,address):
        if peer.family==socket.AF_UNIX or peer.family==socket.AF_INET and address==('127.0.0.1',55480):
            return original(peer,address)
        raise AssertionError('External network forbidden')
    try:
        with patch.object(socket.socket,'connect',confined),patch('socket.getaddrinfo',side_effect=AssertionError('DNS forbidden')):
            result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(DemandChecks))
        args.output.write_text(json.dumps({'scope':'S12_DEMAND_REAL_PG_SYNTHETIC_JOURNAL',
            'status':'PASS'if result.wasSuccessful()else'FAILED','tests_run':result.testsRun,
            'failures':len(result.failures),'errors':len(result.errors)},indent=2)+'\n')
        raise SystemExit(0 if result.wasSuccessful()else 1)
    finally:
        connections.close_all();TEMP.cleanup()
