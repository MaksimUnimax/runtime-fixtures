"""Isolated installed-core check with synthetic marketplace data.

By default all model/provider replies are fixtures. --live-selector performs
ONE paid DeepSeek selector request using the supplied credential directory;
marketplace requests and user accounts remain synthetic and isolated. It never
opens the production database, reads a portal session, or calls a marketplace.
"""
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
import argparse
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import uuid
from contextvars import ContextVar


def exercise(core_root, *, live_selector=False, credential_directory=None, clarification=False,
             revoke_before_provider=False, restart_before_read=False):
    sys.path.insert(0, str(Path(core_root).resolve()))
    from semantics import Scope, Store, Rejected, strict_json
    from repository import Repository
    from engine import Engine, Worker, CallError
    from model_answer import Settings
    from runtime_port import RuntimePort, Peer, pins
    from runtime_port_contract import utc
    from template_catalog import HASH
    from direct_response import answer_step
    import model_answer
    from runtime_adapter import AlisaPipeline, dispatch_context
    from security import Failure
    from types import SimpleNamespace
    from zoneinfo import ZoneInfo

    actor, tenant, store_id = [str(uuid.uuid4()) for _ in range(3)]
    scope = Scope('harness-isolated-fixture', 'fixture-revision',
                  (Store('fixture-ozon', 'ozon', 'fixture-seller', 'access1', 'source1', 'RUB'),))
    context = {'tenant_id': tenant, 'actor_id': actor,
        'store_scope': [{'store_id': store_id, 'credential_revision': 1, 'scope_revision': 1}],
        'security_revision': 1, 'access_revision': 1, 'business_timezone': 'Europe/Moscow',
        'execution_ticket': 'isolated-fixture-only', 'not_after': utc(time.time() + 120),
        'catalog_release_id': 'isolated-core-fixture', 'runtime_contract_version': 'runtime_port_v1'}
    class FixtureIdentity:
        revoked = set()
        def profile(self, token):
            if token not in ('fixture-session-a', 'fixture-session-b') or token in self.revoked:
                raise Failure('AUTH_REQUIRED', 401)
            return {'customer_id': actor, 'tenant_id': tenant}
    identity = FixtureIdentity()
    class FixtureAuthority:
        active = True
        current_session = ContextVar('fixture_authority_session', default=None)
        def bind(self, _context, token):
            self.current_session.set(token)
        def clear(self):
            self.current_session.set(None)
        def verify(self, ticket, service_id):
            if not self.active or ticket != context['execution_ticket'] or service_id != 'fixture':
                raise Rejected('AUTH_REQUIRED')
            return {'product_id': 'alisa_market', **{k: v for k, v in context.items() if k != 'execution_ticket'}}
        def resolve(self, approved, action):
            try:
                identity.profile(self.current_session.get())
            except Failure:
                raise Rejected('AUTH_REQUIRED') from None
            if not self.active or approved != pins(context):
                raise Rejected('PERMISSION_DENIED')
            return scope
    authority = FixtureAuthority()
    active_token = 'fixture-session-a'
    def authorized(function, *args):
        authority.bind(None, active_token)
        return function(*args)
    day = (datetime.now(ZoneInfo('Europe/Moscow')).date() - timedelta(days=1)).isoformat()
    decision = {'action': 'plan', 'complete': True, 'missing': [],
        'requirements': [{'id': 'r1', 'description': 'Количество заказанных товаров', 'invocations': ['a']}],
        'invocations': [{'id': 'a', 'template_id': 'B01.ordered_units', 'store_id': 'fixture-ozon',
            'input': {'period': {'from': day, 'to': day}, 'comparison': None, 'filters': {}, 'group_by': 'marketplace'}}]}
    class FixtureTransport:
        model_source = 'model:deepseek-flash'
        def __init__(self):
            self.operations = []
            self.selector_calls = 0
            self.live = None
            if live_selector:
                from http_transport import HTTPTransport
                self.live = HTTPTransport(credential_directory, {}, {}, enabled=True)
        def execute_observed(self, request, store, on_dispatch):
            # Native shared_http runs the dispatch guard on a fresh I/O thread.
            # Exercise the actual context bridge, including per-job login.
            on_dispatch = dispatch_context(on_dispatch)
            def dispatch():
                received = []
                def invoke():
                    try:
                        on_dispatch()
                    except BaseException as error:
                        received.append(error)
                thread = threading.Thread(target=invoke)
                thread.start(); thread.join(2)
                if thread.is_alive():
                    raise AssertionError('dispatch authorization deadlocked')
                if received:
                    raise received[0]
            self.operations.append(request.operation)
            if request.operation == 'template_select':
                self.selector_calls += 1
                if self.live:
                    if self.selector_calls != 1:
                        raise CallError('SMOKE_SELECTOR_LIMIT')
                    return self.live.execute_observed(request, store, on_dispatch)
                dispatch()
                value = ({'action': 'clarify', 'question': 'За какой период?', 'missing': ['period']}
                         if clarification and self.selector_calls == 1 else decision)
                reply = {'content': json.dumps(value, ensure_ascii=False), 'finish_reason': 'stop'}
                return reply, {'status': 200, 'elapsed_ms': 1, 'bytes': len(reply['content'].encode()),
                    'model_usage': {'requested_model': 'deepseek-flash', 'model': 'fixture',
                        'usage': {'prompt_tokens': 100, 'completion_tokens': 20, 'total_tokens': 120,
                                  'prompt_cache_hit_tokens': 80, 'prompt_cache_miss_tokens': 20}}}
            if request.operation != 'ozon_orders':
                raise CallError('SMOKE_UNEXPECTED_OPERATION')
            if revoke_before_provider:
                identity.revoked.add('fixture-session-a')
            dispatch()
            # This is a raw source response, not precomputed handler output.
            # The actual installed decoder verifies dimensions and totals.
            response = {'result': {'data': [{'dimensions': [{'id': day[:7], 'name': day[:7]}],
                                            'metrics': [17]}], 'totals': [17]}}
            return response, {'status': 200, 'elapsed_ms': 1, 'bytes': len(json.dumps(response))}

    previous_answer = model_answer.step
    model_answer.step = answer_step
    try:
        with tempfile.TemporaryDirectory(prefix='harness-isolated-') as directory:
            repo = Repository(str(Path(directory) / 'runtime.sqlite3'))
            engine = Engine(repo, lambda _: scope, template_mode=True,
                selector_policy=lambda: {'layout': 'catalog_prefix_v2', 'isolation': 'tenant_v1'},
                answer_settings=Settings(Path(directory) / 'answer-settings.json'))
            engine.program_answers = False
            port = RuntimePort(engine, authority, catalog_release_id=context['catalog_release_id'], service_id='fixture')
            adapter = AlisaPipeline.__new__(AlisaPipeline)
            adapter.engine, adapter.repo, adapter.authority, adapter.identity = engine, repo, authority, identity
            adapter._install_job_authorization()
            peer = Peer('fixture', 'alisa_market')
            transport = FixtureTransport()
            worker = Worker(engine, transport)
            rid = str(uuid.uuid4())
            task = {'schema_version': 'runtime_task_v1', 'request_id': rid, 'logical_query_id': rid,
                    'trace_id': rid, 'context': context,
                    'query_input': {'kind': 'utterance', 'text': 'Сколько товаров заказали на Ozon вчера?'}}
            with adapter.admission_lock:
                accepted = authorized(port.submit, task, peer)
                with repo.connection() as connection:
                    job_id = connection.execute('SELECT jid FROM rt_job_refs WHERE ref=?', (accepted['job_ref'],)).fetchone()[0]
                adapter._bind_job(job_id, active_token)
                # Another active login of the same account must not rescue a
                # provider execution whose original login was revoked.
                adapter._bind_job('another-fixture-job', 'fixture-session-b')
            ref = accepted['job_ref']
            for _ in range(30):
                if not adapter._worker_step(worker):
                    break
                with repo.connection() as connection:
                    row = connection.execute('SELECT jobs.* FROM jobs JOIN rt_job_refs ON rt_job_refs.jid=jobs.id WHERE rt_job_refs.ref=?', (ref,)).fetchone()
                if row['state'] in ('READY', 'FAILED', 'UNKNOWN', 'CANCELLED'):
                    break
            if revoke_before_provider:
                if row['state'] not in ('FAILED', 'UNKNOWN'):
                    raise AssertionError('revoked request was not stopped')
                if any(op in transport.operations for op in ('model_answer', 'model_answer_program')):
                    raise AssertionError('final model was called')
                return {'ok': True, 'fixture_data': True, 'revocation_stopped': True,
                        'state': row['state'], 'selector_calls': transport.selector_calls}
            if restart_before_read:
                adapter.job_sessions.clear()
                identity.revoked.add(active_token)
                active_token = 'fixture-session-b'
            status = authorized(port.status, ref, context, peer)
            if status['state'] != ('NEEDS_INPUT' if clarification else 'READY'):
                raise AssertionError('runtime did not finish: ' + row['state'] + '/' + str(row['error']))
            result = authorized(port.read_result, ref, context, peer)
            if clarification:
                request = str(uuid.uuid4())
                with adapter.admission_lock:
                    authorized(port.clarify, {'schema_version': 'runtime_clarification_task_v1', 'context': context,
                        'request_id': request, 'logical_query_id': rid, 'trace_id': request, 'job_ref': ref,
                        'expected_revision': result['clarification']['revision'], 'answer': 'За вчера'}, peer)
                    adapter._bind_job(job_id, active_token)
                for _ in range(30):
                    if not adapter._worker_step(worker):
                        break
                    if authorized(port.status, ref, context, peer)['state'] == 'READY':
                        break
                result = authorized(port.read_result, ref, context, peer)
            text = '\n\n'.join(result['pages'])
            if '17' not in text:
                raise AssertionError('fixture quantity not rendered')
            if transport.operations.count('ozon_orders') != 1:
                raise AssertionError('provider fixture dispatch count changed')
            if any(op in transport.operations for op in ('model_answer', 'model_answer_program', 'template_verify')):
                raise AssertionError('final model was called')
            usage, metadata = AlisaPipeline._usage(SimpleNamespace(repo=repo, catalog_hash=HASH), ref, 0)
            # Native admission replay must reuse the same reference and result.
            before = list(transport.operations)
            repeated = authorized(port.submit, task, peer)
            if repeated['job_ref'] != ref or adapter._worker_step(worker) or transport.operations != before:
                raise AssertionError('admission replay dispatched work')
            return {'ok': True, 'fixture_data': True, 'live_selector': live_selector,
                    'clarification': clarification, 'restart_before_read': restart_before_read,
                    'text': text, 'usage': usage, 'metadata': metadata,
                    'presentation': AlisaPipeline._presentation(SimpleNamespace(repo=repo), ref),
                    'operations': transport.operations, 'no_final_model': True, 'replay_no_dispatch': True}
    finally:
        model_answer.step = previous_answer


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--core-root', required=True)
    parser.add_argument('--credentials-directory')
    parser.add_argument('--live-selector', action='store_true')
    arguments = parser.parse_args()
    if arguments.live_selector and not arguments.credentials_directory:
        parser.error('--live-selector requires --credentials-directory')
    print(json.dumps(exercise(arguments.core_root, live_selector=arguments.live_selector,
        credential_directory=arguments.credentials_directory), ensure_ascii=False, indent=2))
