"""External status changes during Quasar preparation must not lose delivery."""
import json
import unittest
from unittest.mock import patch

import service
import test_delivery as fixtures


class PendingTransitionTests(unittest.TestCase):
    def fixture(self, existing=True):
        fixture = fixtures.DeliveryTests('test_pending_at_10_not_before')
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.settings(interval_seconds=25)
        if existing:
            fixture.core.state['scenario'] = 'own-scenario'
        fixture.after()
        fixture.now += 25
        return fixture

    def finish(self, fixture, state):
        fixture.core.tick()
        self.assertEqual(len(fixture.launches()), 1)
        self.assertFalse(fixture.core.state['uncertain'])
        if state == 'READY':
            self.assertNotIn('PRIVATE_RESULT', json.dumps(fixture.client.calls))
            nonce = fixture.core.state['job']['nonce']
            self.assertEqual(fixture.before('доставка ' + nonce)['reply'], 'PRIVATE_RESULT')
            self.assertEqual(fixture.core.state['job']['delivery'], 'responded_to_skill')
        else:
            self.assertEqual(fixture.core.state['job']['delivery'], 'failed_notified')
        fixture.core.tick()
        self.assertEqual(len(fixture.launches()), 1)

    def test_terminal_transition_after_prepare_rearms_same_job(self):
        for existing in (True, False):
            for state in ('READY', 'FAILED', 'UNKNOWN'):
                with self.subTest(existing_scenario=existing, terminal=state):
                    fixture = self.fixture(existing)
                    job = fixture.core.state['job']
                    def transition(method, path):
                        if not path.endswith('/actions'):
                            fixture.result = {'state': state, 'text': 'PRIVATE_RESULT'}
                            fixture.client.hook = None
                    fixture.client.hook = transition
                    fixture.core.tick()
                    self.assertFalse(fixture.launches())
                    self.assertIs(fixture.core.state['job'], job)
                    self.assertEqual(job['delivery'], 'waiting')
                    self.assertFalse(fixture.core.state['uncertain'])
                    self.assertEqual(fixture.core.state['last_delivery']['state'], 'cancelled_before_launch')
                    self.finish(fixture, state)

    def test_ready_transition_at_second_guard(self):
        fixture = self.fixture()
        statuses = []
        def status(request):
            statuses.append(request['op'])
            if len(statuses) == 4:
                fixture.result = {'state': 'READY', 'text': 'PRIVATE_RESULT'}
            return dict(fixture.result)
        fixture.core.peek = status
        fixture.core.tick()
        self.assertEqual(len(statuses), 4)
        self.assertFalse(fixture.launches())
        self.assertEqual(fixture.core.state['job']['delivery'], 'waiting')
        self.finish(fixture, 'READY')

    def test_context_changes_during_ready_observation_do_not_rearm_old_job(self):
        for action in ('pause_resume', 'new_job', 'manual', 'disconnect'):
            with self.subTest(action=action):
                fixture = self.fixture()
                old_job = fixture.core.state['job']
                statuses = []
                def status(request):
                    statuses.append(request['op'])
                    if len(statuses) == 3:
                        fixture.result = {'state': 'READY', 'text': 'PRIVATE_RESULT'}
                        if action == 'pause_resume':
                            fixture.settings(enabled=False)
                            fixture.settings(enabled=True)
                        elif action == 'new_job':
                            fixture.after('new-job')
                        elif action == 'manual':
                            fixture.before('результат')
                        else:
                            # Mirror disconnect's state transition without waiting
                            # for the transport lock held by this fake HTTP hook.
                            fixture.core.state.update(connected=False, selected=None,
                                job=None, generation=fixture.core.state['generation'] + 1)
                    return dict(fixture.result)
                fixture.core.peek = status
                fixture.core.tick()
                self.assertFalse(fixture.launches())
                if action == 'new_job':
                    self.assertIsNot(fixture.core.state['job'], old_job)
                    self.assertEqual(fixture.core.state['job']['jid'], 'new-job')
                elif action == 'disconnect':
                    self.assertIsNone(fixture.core.state['job'])
                else:
                    self.assertEqual(fixture.core.state['job']['delivery'], 'manual')
                    fixture.core.tick()
                    self.assertFalse(fixture.launches())

    def test_disabled_global_policy_does_not_rearm(self):
        fixture = self.fixture()
        enabled = [True]
        fixture.core.policy_enabled = lambda: enabled[0]
        def disable(method, path):
            fixture.result = {'state': 'READY', 'text': 'PRIVATE_RESULT'}
            enabled[0] = False
            fixture.client.hook = None
        fixture.client.hook = disable
        fixture.core.tick()
        self.assertEqual(fixture.core.state['job']['delivery'], 'manual')
        enabled[0] = True
        fixture.core.tick()
        self.assertFalse(fixture.launches())

    def test_revocation_is_not_a_ready_transition(self):
        fixture = self.fixture()
        fixture.client.hook = lambda method, path: setattr(fixture, 'authorized', False)
        with patch.object(service, 'token_refresh_possible', return_value=False):
            fixture.core.tick()
        self.assertEqual(fixture.core.state['job']['delivery'], 'manual')
        fixture.authorized = True
        fixture.core.tick()
        self.assertFalse(fixture.launches())

    def test_unknown_action_after_rearm_is_not_replayed(self):
        fixture = self.fixture()
        def transition(method, path):
            fixture.result = {'state': 'READY', 'text': 'PRIVATE_RESULT'}
            fixture.client.hook = None
        fixture.client.hook = transition
        fixture.core.tick()
        self.assertEqual(fixture.core.state['job']['delivery'], 'waiting')
        def unknown(method, path):
            if path.endswith('/actions'):
                raise service.Fault('network_outcome_unknown')
        fixture.client.hook = unknown
        fixture.core.tick()
        self.assertEqual(len(fixture.launches()), 1)
        self.assertTrue(fixture.core.state['uncertain'])
        self.assertEqual(fixture.core.state['job']['delivery'], 'unknown')
        before = len(fixture.client.calls)
        fixture.core.tick()
        self.assertEqual(len(fixture.client.calls), before)

    def test_final_regression_to_running_is_not_pending_completion(self):
        fixture = self.fixture()
        fixture.result = {'state': 'READY', 'text': 'PRIVATE_RESULT'}
        fixture.client.hook = lambda method, path: setattr(fixture, 'result', {'state': 'RUNNING', 'text': ''})
        fixture.core.tick()
        self.assertEqual(fixture.core.state['job']['delivery'], 'manual')
        fixture.result = {'state': 'READY', 'text': 'PRIVATE_RESULT'}
        fixture.core.tick()
        self.assertFalse(fixture.launches())


if __name__ == '__main__':
    unittest.main()
