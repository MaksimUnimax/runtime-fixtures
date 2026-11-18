"""The Alisa template runtime as an authenticated Harness channel.

The installed catalogue, selector, worker, HTTP transport, arithmetic and access
authority are imported in this independent process. The voice final-answer hook
is replaced only in this interpreter; no installed Alisa source is modified.
"""
from copy import deepcopy
from contextvars import ContextVar, copy_context
from datetime import timedelta
from pathlib import Path
import hashlib
import json
import os
import sys
import threading
import time
import uuid

from security import Failure


def dispatch_context(callback):
    """The native HTTP transport runs its final guard in an I/O thread."""
    if callback is None:
        return None
    context = copy_context()
    return lambda: context.run(callback)


def bootstrap():
    platform = Path(os.environ['ALISA_PLATFORM_SOURCE'])
    core = Path(os.environ.get('ALISA_CORE_ROOT', '/opt/alice-market/releases/current')).resolve()
    sys.path.insert(0, str(platform / 'services/platform/src'))
    sys.path.insert(0, str(core))
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'alisa_platform.config.settings')
    import django
    django.setup()
    return core


class Identity:
    def __init__(self):
        from alisa_platform.accounts.views import session, profile
        from alisa_platform.stores.models import Store
        self.session, self.projection, self.Store = session, profile, Store

    def profile(self, token):
        from django.db import close_old_connections
        close_old_connections()
        row = self.session({'session_token': token})
        if row is None:
            raise Failure('AUTH_REQUIRED', 401)
        return self.projection(row)

    def stores(self, profile):
        return [{'id': str(row.pk), 'name': row.name, 'marketplace': row.provider,
                 'provider': row.provider, 'status': row.status}
                for row in self.Store.objects.filter(product_id='alisa_market',
                    tenant_id=profile['tenant_id']).exclude(status='DELETED').order_by('pk')]

    def logout(self, token):
        from django.utils import timezone
        from alisa_platform.accounts.models import WebSession
        from alisa_platform.accounts.views import digest
        WebSession.objects.filter(token_hash=digest(token), revoked_at__isnull=True).update(
            revoked_at=timezone.now(), encrypted_payload='')


class AuthorityAdapter:
    """Original platform checks plus the gateway's still-current web session."""
    def __init__(self, identity):
        from alisa_platform.runtime_adapter.authority_rpc import configured_authority
        self.original = configured_authority()
        self.identity = identity
        self.current_session = ContextVar('harness_authority_session', default=None)

    def bind(self, context, token):
        self.current_session.set(token)

    def clear(self):
        self.current_session.set(None)

    def _session(self, pins):
        from semantics import Rejected
        token = self.current_session.get()
        if token is None:
            raise Rejected('AUTH_REQUIRED')
        try:
            value = self.identity.profile(token)
        except Failure:
            raise Rejected('AUTH_REQUIRED') from None
        if value['customer_id'] != pins['actor_id'] or value['tenant_id'] != pins['tenant_id']:
            raise Rejected('PERMISSION_DENIED')

    @staticmethod
    def _translate(function, *args):
        from semantics import Rejected
        try:
            return function(*args)
        except Rejected:
            raise
        except Exception as error:
            code = getattr(error, 'code', 'DEPENDENCY_UNAVAILABLE')
            if not isinstance(code, str) or not code.replace('_', '').isalnum():
                code = 'DEPENDENCY_UNAVAILABLE'
            raise Rejected(code) from None

    def verify(self, ticket, service_id):
        return self._translate(self.original.verify, ticket, service_id)

    def resolve(self, pins, action):
        from platform_authority_client import scope_shape
        self._session(pins)
        return scope_shape(self._translate(self.original.resolve, pins, action))

    def credentials(self, pins, store):
        from alisa_platform.runtime_adapter.store_registry import credentials
        self._session(pins)
        value = self._translate(credentials, self.original, {'pins': pins, 'store': store})
        if value.get('store') != store:
            from semantics import Rejected
            raise Rejected('PERMISSION_DENIED')
        return value['credentials']

    def parameter_collection(self, payload):
        from alisa_platform.owner_data.parameter_collection import rpc
        return self._translate(rpc, self.original, payload)

    def store_names(self, pins):
        """Human labels use the same current platform/runtime store mapping."""
        self._session(pins)
        from alisa_platform.stores.models import Store
        scope = self._translate(self.original.resolve, pins, 'execute')
        rows = Store.objects.filter(tenant_id=pins['tenant_id'],
            pk__in=[store['store_id'] for store in pins['store_scope']])
        names = {str(row.pk): row.name for row in rows}
        return {store['id']: names.get(pin['store_id'], store['platform'])
                for pin, store in zip(pins['store_scope'], scope['stores'])}


class AlisaPipeline:
    def __init__(self, state_directory, identity):
        self.root = bootstrap()
        from pricing_snapshot import install as install_pricing_snapshot
        install_pricing_snapshot(os.environ.get('OCTOPORT_PRICING_CONFIG'))
        from runtime import Configuration
        from engine import Engine, Worker, CallError
        from repository import Repository
        from model_answer import Settings
        from http_transport import HTTPTransport
        from runtime_port import RuntimePort, Peer
        from protected_reads import key
        from template_catalog import TEMPLATES, HASH
        from direct_response import answer_step
        import model_answer
        from semantics import Rejected

        self.identity = identity
        self.state = Path(state_directory)
        self.state.mkdir(parents=True, exist_ok=True)
        directory = Path(os.environ['CREDENTIALS_DIRECTORY'])
        config_path = directory / 'market_config'
        self.config = Configuration(str(config_path))
        d = self.config.ready()
        self.repo = Repository(str(self.state / 'runtime.sqlite3'))
        import model_usage, retention
        model_usage.begin_run(self.repo)
        retention.sweep(self.repo)
        settings = Settings(directory / 'answer_settings')
        from report_archive import Archive
        archive_settings = d.get('report_archive', {})
        archive = (Archive(self.repo, budget=archive_settings.get('max_bytes', 256 * 1024 * 1024))
                   if archive_settings.get('enabled') is True else None)
        # Direct output never invokes the voice/program answer provider.
        model_answer.step = answer_step
        self.engine = Engine(self.repo, self.config.scope, template_mode=True,
            selector_policy=lambda: self.config.read().get('selector_prompt'),
            answer_settings=settings, report_archive=archive, read_surface=None,
            table_capabilities=lambda: self.config.read().get('table_capabilities', {}),
            dataset_capabilities=lambda: self.config.read().get('dataset_capabilities', {}))
        self.engine.parameter_source_policy = lambda: self.config.read().get('parameter_sources')
        self.engine.parameter_compound_policy = lambda: self.config.read().get('parameter_compounds')
        self.engine.economics_composite_policy = lambda: self.config.read().get('economics_composites')
        self.engine.program_answers = False
        self.authority = AuthorityAdapter(identity)
        self.engine.harness_store_names = lambda plan: self.authority.store_names(plan['runtime_guard']['pins'])
        self.engine.harness_report_urls = self._report_urls
        self.port = RuntimePort(self.engine, self.authority,
            catalog_release_id=d['runtime_port']['catalog_release_id'],
            service_id=d['runtime_port']['service_id'])
        self.peer = Peer(d['runtime_port']['service_id'], 'alisa_market')
        class SelectorOnlyTransport(HTTPTransport):
            def execute(self, request, store, *, on_dispatch=None):
                if request.operation in ('model_answer', 'model_answer_program', 'template_verify',
                                         'deepseek_parse', 'deepseek_read_plan'):
                    raise CallError('HARNESS_FINAL_MODEL_DISABLED')
                return super().execute(request, store, on_dispatch=dispatch_context(on_dispatch))
        self.transport = SelectorOnlyTransport(str(directory), d['credential_bindings'],
            d['qualifications'], enabled=True,
            qualification_provider=lambda: self.config.read()['qualifications'],
            read_surface_policy=lambda: self.config.read().get('read_surface', {}))
        key(self.repo)
        self.templates_count, self.catalog_hash = len(TEMPLATES), HASH
        self.stop = threading.Event()
        self.continuations = {}
        self.conversation_locks = {}
        self.lock = threading.RLock()
        self._install_job_authorization()
        self._workers = []
        with self.repo.connection(True) as connection:
            connection.execute('''CREATE TABLE IF NOT EXISTS harness_continuations(
                actor TEXT NOT NULL, tenant TEXT NOT NULL, session TEXT NOT NULL,
                payload TEXT NOT NULL, expires REAL NOT NULL, PRIMARY KEY(actor,tenant,session))''')
        for index in range(2):
            worker = Worker(self.engine, self.transport, execution_ready=self._ready)
            thread = threading.Thread(target=self._work, args=(worker,), daemon=True,
                                      name='harness-matrix-' + str(index))
            thread.start(); self._workers.append(thread)

    def _install_job_authorization(self):
        from semantics import Rejected
        self.admission_lock = threading.RLock()
        self.session_lock = threading.RLock()
        self.worker_context = ContextVar('harness_worker_execution', default=False)
        self.job_sessions = {}
        original_authorize_job = self.engine.authorize_job
        def authorize_job(row):
            # Pins intentionally identify account/store rights, not a login.
            # Bind the particular admitted session to each worker execution so
            # another login of the same owner cannot rescue a revoked session.
            if self.worker_context.get():
                with self.session_lock:
                    saved = self.job_sessions.get(row['id'])
                if saved is None or saved[1] <= time.monotonic():
                    raise Rejected('AUTH_REQUIRED')
                self.authority.bind(None, saved[0])
                try:
                    self.identity.profile(saved[0])
                except Failure:
                    raise Rejected('AUTH_REQUIRED') from None
            # Explicit HTTP status/read/clarify instead uses the newly verified
            # current request context. It must remain readable after restart;
            # the original guard and RuntimePort owner checks still apply.
            return original_authorize_job(row)
        self.engine.authorize_job = authorize_job
        self.repo.execution_authorizer = authorize_job
        original_claim = self.repo.claim
        def claim(*args, **kwargs):
            # Both admission and claiming take this lock BEFORE opening a DB
            # transaction. Authorizing a row never takes the admission lock.
            with self.admission_lock:
                return original_claim(*args, **kwargs)
        self.repo.claim = claim

    def _bind_job(self, job_id, token):
        now = time.monotonic()
        with self.session_lock:
            self.job_sessions = {key: value for key, value in self.job_sessions.items() if value[1] > now}
            self.job_sessions[job_id] = (token, now + 1800)

    def _worker_step(self, worker):
        mode = self.worker_context.set(True)
        try:
            return worker.step()
        finally:
            self.worker_context.reset(mode)
            self.authority.clear()

    def _ready(self):
        from semantics import Rejected
        if self.stop.is_set():
            raise Rejected('WORKER_STOPPING')
        self.config.ready()

    def _report_urls(self, row, plan):
        with self.repo.connection() as connection:
            refs = connection.execute('SELECT ref FROM rt_job_refs WHERE jid=? AND tenant=? AND actor=?',
                (row['id'], plan['runtime_guard']['pins']['tenant_id'], plan['runtime_guard']['pins']['actor_id'])).fetchall()
        if len(refs) != 1:
            raise Failure('REPORT_SCOPE', 403)
        return {fragment['id']: 'https://alisa.octoport.ru/harness/api/reports/' + refs[0]['ref'] + '/' + fragment['id']
                for fragment in plan['fragments']}

    def report(self, token, profile, ref, fragment_id):
        """A current owner can download a full, already finished handler result.

        This performs no replay, model call, provider call or recomputation.
        The normal RuntimePort result authorization remains the read boundary.
        """
        from alisa_platform.queries.models import Query
        from semantics import strict_json
        receipt = Query.objects.filter(runtime_job_ref=ref, customer_id=profile['customer_id'],
            tenant_id=profile['tenant_id'], continuation__has_key='harness_runtime_v1').first()
        if receipt is None:
            raise Failure('NOT_FOUND', 404)
        authorizer = self.authority.original.for_session(token, receipt.store_ids)
        context = self._context(authorizer, 'read_result', token)
        visible = self.port.read_result(ref, context, self.peer)
        if visible['result_kind'] != 'DATA':
            raise Failure('RESULT_NOT_READY', 409)
        with self.repo.connection() as connection:
            row = connection.execute('SELECT jobs.* FROM jobs JOIN rt_job_refs ON rt_job_refs.jid=jobs.id '
                'WHERE rt_job_refs.ref=? AND rt_job_refs.tenant=? AND rt_job_refs.actor=?',
                (ref, profile['tenant_id'], profile['customer_id'])).fetchone()
            if row is None or not self.engine.output_authorized(row):
                raise Failure('FORBIDDEN', 403)
            plan, result = strict_json(row['plan']), strict_json(row['result'])
            fragment = next((item for item in plan['fragments'] if item['id'] == fragment_id), None)
            if fragment is None:
                raise Failure('NOT_FOUND', 404)
            index = plan['fragments'].index(fragment)
            data = result.get('data', {}).get('templates', [])
            if len(data) != len(plan['fragments']) or data[index]['template_ids'] != fragment['template_ids']:
                raise Failure('RESULT_NOT_READY', 409)
            document = {'schema': 'octoport-template-result/v1',
                'template_ids': fragment['template_ids'], 'kind': fragment['kind'],
                'fetched_at': result['fetched_at'], 'period': (fragment.get('plan') or {}).get('period'),
                'handler_result': data[index]['data']}
            # Repeat the authoritative check after materializing data; a read
            # crossing a revocation never relies on its initial cookie alone.
            self.port.read_result(ref, self._context(authorizer, 'read_result', token), self.peer)
        return json.dumps(document, ensure_ascii=False, indent=2).encode()

    def _work(self, worker):
        from django.db import close_old_connections
        while not self.stop.is_set():
            try:
                close_old_connections()
                self._ready()
                worked = self._worker_step(worker)
            except Exception as error:
                # Never log provider payloads, question content or credentials.
                print('matrix_worker_error ' + type(error).__name__, flush=True)
                worked = False
            self.stop.wait(.05 if worked else .3)

    def _authorizer(self, binding):
        profile = self.identity.profile(binding.portal_token)
        if (profile['customer_id'], profile['tenant_id']) != (binding.actor_id, binding.tenant_id):
            raise Failure('FORBIDDEN', 403)
        if not binding.store_ids:
            raise Failure('NO_STORES', 409)
        authorizer = self.authority.original.for_session(binding.portal_token, list(binding.store_ids))
        return authorizer

    def _context(self, authorizer, operation, token):
        context = authorizer.prepare(operation)
        self.authority.bind(context, token)
        return context

    def _receipt(self, binding, text, context):
        """Authentic platform metadata needed by existing compound-report RPCs.

        Marking its dedicated execution channel prevents an ordinary cabinet
        recover from submitting the same request to another runtime.
        """
        from django.db import transaction
        from django.utils import timezone
        from alisa_platform.queries.models import Query
        from alisa_platform.runtime_adapter.authority import SessionPrincipal
        from alisa_platform.owner_data.parameter_report_rpc import remember
        from alisa_platform.runtime_adapter.job_client import encode
        principal = SessionPrincipal(binding.portal_token)
        continuation = remember(principal, 'WEB', text)
        continuation['harness_runtime_v1'] = {
            'session_id': binding.session_id, 'runtime': 'octoport-harness',
            'request_id': binding.request_id}
        mark = hashlib.sha256(encode({'stores': list(binding.store_ids), 'utterance': text})).hexdigest()
        now = timezone.now()
        with transaction.atomic():
            row, created = Query.objects.get_or_create(pk=binding.request_id, defaults={
                'customer_id': binding.actor_id, 'tenant_id': binding.tenant_id,
                'store_ids': list(binding.store_ids), 'input_hash': mark, 'channel': 'WEB',
                'created_at': now, 'expires_at': now + timedelta(days=1),
                'lease_until': now + timedelta(days=1), 'state': 'QUEUED',
                'continuation': continuation})
            if (str(row.customer_id), str(row.tenant_id), row.input_hash) != (
                    binding.actor_id, binding.tenant_id, mark):
                raise Failure('IDEMPOTENCY_CONFLICT', 409)
            if 'harness_runtime_v1' not in row.continuation:
                raise Failure('IDEMPOTENCY_CONFLICT', 409)
        return row

    def _usage(self, ref, baseline, request_id=None):
        from semantics import strict_json
        with self.repo.connection() as connection:
            linked = connection.execute('SELECT jid FROM rt_job_refs WHERE ref=?', (ref,)).fetchone()
            if not linked:
                return None, {'usage_complete': False}
            row = connection.execute('SELECT plan,draft FROM jobs WHERE id=?', (linked['jid'],)).fetchone()
            calls = connection.execute('SELECT source,state,http,dispatched,model_usage,model_context FROM calls '
                'WHERE jid=? AND id>?', (linked['jid'], baseline)).fetchall()
        plan = strict_json(row['plan']) if row and row['plan'] else {}
        ids = [v['template_id'] for v in plan.get('selection', {}).get('invocations', [])]
        from request_meter import measure, object_value
        meter = measure(calls, request_id)
        mapping = {'prompt_tokens': 'prompt', 'completion_tokens': 'completion',
                   'prompt_cache_hit_tokens': 'cache_hit', 'prompt_cache_miss_tokens': 'cache_miss'}
        counts = {key: meter['tokens'][value] for key, value in mapping.items()
                  if meter['tokens'][value] is not None}
        model_calls = [call for call in calls if call['source'].startswith('model:') and call['dispatched'] is not None]
        stages = []
        layouts = set()
        for call in model_calls:
            ctx = object_value(call['model_context'])
            stages.append(ctx.get('stage'))
            if ctx.get('prompt_layout'):
                layouts.add(ctx['prompt_layout'])
        complete = len(counts) == len(mapping) and meter['tokens']['total'] is not None
        return counts if complete else None, {'template_ids': ids, 'selector_calls': stages.count('template_select'),
            'model_calls': len(model_calls), 'final_model_calls': 0,
            'provider_calls': sum(1 for call in calls if not call['source'].startswith('model:') and call['http'] is not None),
            'response_mode': 'matrix_chat_v2', 'meter': meter,
            'catalog_hash': self.catalog_hash, 'selector_layout': next(iter(layouts)) if len(layouts) == 1 else
                ('mixed' if layouts else (strict_json(row['draft']).get('selector_prompt') or {}).get('layout')),
            'usage_complete': complete, **({'known_usage': counts} if not complete else {})}

    def _continuation(self, key, value=None, *, save=False):
        # No session token is persisted. A new authenticated UI message must
        # rebind current rights before a pending clarification can resume.
        with self.repo.connection(True) as connection:
            connection.execute('DELETE FROM harness_continuations WHERE expires<=?', (time.time(),))
            if save:
                connection.execute('DELETE FROM harness_continuations WHERE actor=? AND tenant=? AND session=?', key)
                if value is not None:
                    connection.execute('INSERT INTO harness_continuations VALUES(?,?,?,?,?)',
                        (*key, json.dumps(value, separators=(',', ':')), time.time() + 86400))
                return value
            row = connection.execute('SELECT payload FROM harness_continuations WHERE actor=? AND tenant=? AND session=?', key).fetchone()
            return json.loads(row['payload']) if row else None

    def query(self, binding, text):
        tracking = {'ref': None, 'baseline': 0}
        try:
            return self._query(binding, text, tracking)
        except Exception as error:
            # The immutable ledger also accounts for selector calls preceding
            # a failed provider/handler. An accounting problem must never
            # trigger paid replay or replace the original execution error.
            if tracking['ref']:
                try:
                    error.meter = self._usage(tracking['ref'], tracking['baseline'], binding.request_id)[1].get('meter')
                except Exception:
                    error.meter = None
            raise

    def _presentation(self, ref):
        from semantics import strict_json
        # Called only after RuntimePort.read_result authorizes this current
        # session, query owner, stores and unchanged access revision.
        with self.repo.connection() as connection:
            row = connection.execute('SELECT j.result FROM jobs j JOIN rt_job_refs r ON r.jid=j.id WHERE r.ref=?',
                                     (ref,)).fetchone()
        return strict_json(row['result']).get('chat_presentation') if row and row['result'] else None

    def _query(self, binding, text, tracking):
        from semantics import strict_json
        from alisa_platform.queries.models import Query
        from django.utils import timezone
        authorizer = self._authorizer(binding)
        key = (binding.actor_id, binding.tenant_id, binding.session_id)
        with self.lock:
            chat_lock = self.conversation_locks.setdefault(key, threading.RLock())
        with chat_lock:
            with self.repo.connection() as connection:
                baseline = connection.execute('SELECT COALESCE(MAX(id),0) FROM calls').fetchone()[0]
                tracking['baseline'] = baseline
            context = self._context(authorizer, 'submit', binding.portal_token)
            prior = self._continuation(key)
            with self.admission_lock:
                if prior:
                    task = {'schema_version': 'runtime_clarification_task_v1', 'request_id': binding.request_id,
                        'logical_query_id': prior['logical_query_id'], 'trace_id': binding.request_id,
                        'job_ref': prior['job_ref'], 'expected_revision': prior['revision'],
                        'answer': text, 'context': context}
                    # Use the registered continuation contract; never reinterpret
                    # an answer as a brand-new financial question.
                    accepted = self.port.clarify(task, self.peer)
                    tracking['ref'] = accepted['job_ref']
                    logical_id = prior['logical_query_id']
                else:
                    self._receipt(binding, text, context)
                    task = {'schema_version': 'runtime_task_v1', 'request_id': binding.request_id,
                        'logical_query_id': binding.request_id, 'trace_id': binding.request_id,
                        'context': context, 'query_input': {'kind': 'utterance', 'text': text}}
                    accepted = self.port.submit(task, self.peer)
                    tracking['ref'] = accepted['job_ref']
                    logical_id = binding.request_id
                    Query.objects.filter(pk=logical_id, customer_id=binding.actor_id,
                        tenant_id=binding.tenant_id).update(runtime_job_ref=accepted['job_ref'], state='QUEUED')
                with self.repo.connection() as connection:
                    linked = connection.execute('SELECT jid FROM rt_job_refs WHERE ref=?', (accepted['job_ref'],)).fetchone()
                self._bind_job(linked['jid'], binding.portal_token)
            ref = accepted['job_ref']
            deadline = time.monotonic() + 570
            while time.monotonic() < deadline:
                current = self._context(authorizer, 'status', binding.portal_token)
                status = self.port.status(ref, current, self.peer)
                state = status['state']
                if state in ('READY', 'NEEDS_INPUT'):
                    context = self._context(authorizer, 'read_result', binding.portal_token)
                    result = self.port.read_result(ref, context, self.peer)
                    usage, metadata = self._usage(ref, baseline, binding.request_id)
                    metadata['state'] = state
                    metadata['result_expires_at'] = status.get('result_expires_at')
                    if state == 'NEEDS_INPUT':
                        clarification = result['clarification']
                        self._continuation(key, {'job_ref': ref, 'logical_query_id': logical_id,
                            'revision': clarification['revision']}, save=True)
                        metadata['clarification'] = {k: clarification[k] for k in ('question', 'revision', 'missing')}
                    else:
                        self._continuation(key, save=True)
                    Query.objects.filter(pk=logical_id, customer_id=binding.actor_id,
                        tenant_id=binding.tenant_id).update(state=state, checked_at=timezone.now())
                    presentation = self._presentation(ref) if state == 'READY' else None
                    return {'text': '\n\n'.join(result['pages']), 'usage': usage, 'metadata': metadata,
                            **({'presentation': presentation} if presentation else {})}
                if state in ('FAILED', 'CANCELLED', 'EXPIRED', 'UNKNOWN'):
                    Query.objects.filter(pk=logical_id, customer_id=binding.actor_id,
                        tenant_id=binding.tenant_id).update(state=state, checked_at=timezone.now())
                    from failure_explanations import explain
                    code = 'REQUEST_UNKNOWN' if state == 'UNKNOWN' else status.get('code', 'EXECUTION_FAILED')
                    raise Failure(code, 409, None if code == 'REQUEST_UNKNOWN' else explain(code)['text'])
                self.stop.wait(.3)
            raise Failure('REQUEST_UNKNOWN', 504)

