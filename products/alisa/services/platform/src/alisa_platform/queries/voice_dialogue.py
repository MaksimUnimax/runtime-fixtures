"""Bounded store clarification, separate from template/model interpretation.

Only encrypted server state is used. Yandex session_state is untrusted and has a
1 KiB limit. No question, store ID or authority ticket is sent in session_state.
"""
from datetime import timedelta
import hashlib
import re

from django.db import transaction
from django.conf import settings
from django.utils import timezone
from alisa_platform.accounts.models import Customer
from alisa_platform.alice_link.models import TokenFamily
from alisa_platform.alice_link.vault import seal, unseal
from alisa_platform.runtime_adapter.job_client import encode, need, RuntimeFailure
from alisa_platform.stores.models import Store, CredentialRevision
from .models import VoiceDialogue, Query

LIFETIME = timedelta(minutes=10)
CONTROL = {'готово', 'статус', 'ответ', 'повтори', 'отмена', 'отмени'}
CANCEL = {'отмена', 'отмени'}
ALL = {'все', 'всё', 'все магазины', 'по всем', 'по всем магазинам'}
EXPIRED = 'Уточнение больше не действует. Задайте вопрос заново вместе с магазином.'
ACCEPTED = 'Задание принято. Спросите: готово? Отчёт также появится в кабинете.'
UNKNOWN = 'Отправка не подтверждена. Откройте задание в кабинете. Новый расчёт автоматически не запущен.'
ORDINALS = {'первый': 1, 'первое': 1, 'второй': 2, 'второе': 2,
            'третий': 3, 'третье': 3, 'четвертый': 4, 'пятый': 5}
PROVIDERS = {'OZON': {'озон', 'ozon'}, 'WB': {'вайлдберриз', 'вайлдберис', 'wildberries', 'вб', 'wb'}}


class SelectionChanged(RuntimeFailure):
    def __init__(self):
        super().__init__('PERMISSION_DENIED')


def normalized(value):
    return ' '.join(value.casefold().replace('ё', 'е').strip(' ?!.,;:').split())


def providers(value):
    words = set(re.findall(r'\w+', normalized(value)))
    return {key for key, names in PROVIDERS.items() if words & names}


def all_stores(value):
    return normalized(value) in ALL or bool(re.search(
        r'\b(?:по всем(?: магазинам)?|во всех магазинах|все магазины)\b', normalized(value)))


def bindings(tenant):
    from . import service
    authority = service.configured_authority()
    mapping = authority.bindings.load(environment=settings.ALISA_ENV, service_id=authority.service_id,
                                     catalog_release_id=authority.catalog_release_id).get(tenant)
    return mapping


def snapshot(store, mapping):
    credentials = list(CredentialRevision.objects.filter(store=store, status='ACTIVE').order_by('kind', 'id')
                       .values('id', 'kind', 'revision', 'check_code'))
    pin = {'id': str(store.pk), 'revision': store.revision, 'provider': store.provider,
           'identity': store.verified_identity, 'status': store.status,
           'mapping': ({key: mapping[key] for key in ('runtime_tenant', 'revision')} |
                       {'store': mapping['stores'].get(str(store.pk))}) if mapping else None,
           'credentials': [{**row, 'id': str(row['id'])} for row in credentials]}
    return {'id': str(store.pk), 'provider': store.provider, 'name': store.name,
            'alias': store.voice_alias, 'pin': hashlib.sha256(encode(pin)).hexdigest()}


def candidates(tenant, utterance):
    rows = Store.objects.filter(tenant_id=tenant, product_id='alisa_market', status='ACTIVE',
                                verified_identity__isnull=False).order_by('id')
    wanted = providers(utterance)
    if len(wanted) == 1:
        rows = rows.filter(provider=next(iter(wanted)))
    rows = list(rows[:1001])
    need(len(rows) <= 1000, 'CAPABILITY_UNAVAILABLE')
    mapping = bindings(tenant)
    return [snapshot(row, mapping) for row in rows]


class PinnedAuthorizer:
    """Normal authority remains responsible for access; reject changed selection.

    Check on EVERY prepare, including RuntimeClient's second prepare. Its normal
    current(ticket) guard then rejects a change after prepare and before IPC.
    """
    def __init__(self, delegate, tenant, selected):
        self.delegate, self.tenant, self.selected = delegate, tenant, selected

    def check(self):
        mapping = bindings(self.tenant)
        for saved in self.selected:
            store = Store.objects.filter(pk=saved['id'], tenant_id=self.tenant, product_id='alisa_market').first()
            if store is None or snapshot(store, mapping)['pin'] != saved['pin']:
                raise SelectionChanged()

    def prepare(self, operation):
        self.check()
        context = self.delegate.prepare(operation)
        self.check()
        return context

    def current(self, context, operation):
        self.check()
        return self.delegate.current(context, operation)


def prompt(state):
    rows, start = state['stores'], state['page']
    labels = [f"{i + 1}. {row['name'][:80]} ({'Озон' if row['provider'] == 'OZON' else 'Вайлдберриз'})"
              for i, row in enumerate(rows) if start <= i < start + 5]
    more = ' Для продолжения списка скажите: дальше.' if start + 5 < len(rows) else ''
    return (f"Уточните магазин. В списке {len(rows)}. " + '; '.join(labels) +
            '. Назовите номер, название или скажите: все.' + more)


def selection(state, utterance):
    command = normalized(utterance)
    rows = state['stores']
    if not command:
        return []
    if command in ALL:
        return rows
    index = ORDINALS.get(command)
    match = re.fullmatch(r'(?:номер )?(\d{1,4})', command)
    if match:
        index = int(match[1])
    if index is not None:
        return rows[index - 1:index] if 1 <= index <= len(rows) else []
    exact = [row for row in rows if command in {normalized(row['name']), normalized(row['alias'])} - {''}]
    if len(exact) == 1:
        return exact
    if exact:
        # Duplicate names are preserved. Their existing absolute numbers disambiguate.
        return []
    wanted = providers(command)
    if len(wanted) == 1 and command in set().union(*PROVIDERS.values()):
        selected = [row for row in rows if row['provider'] in wanted]
        if len(selected) == 1:
            return selected
        if selected:
            state['stores'], state['page'] = selected, 0
    return []


def auth_binding(principal):
    _, _, _, proof = principal.current()
    family = TokenFamily.objects.select_related('link').get(pk=proof['id'])
    return {'link': str(family.link_id), 'revision': family.link.revision,
            'security_revision': family.link.security_revision}


def save(row, state):
    row.phase = state['phase']
    if 'query_id' in state:
        row.query_id = state['query_id']
    row.encrypted_payload = seal('voice-dialogue/v1', row.pk, state)
    row.save()


def receipt_message(customer, tenant, query_id):
    row = Query.objects.filter(pk=query_id, customer_id=customer, tenant_id=tenant,
                               expires_at__gt=timezone.now()).first()
    return ACCEPTED if row is not None and row.runtime_job_ref else UNKNOWN


def advance(principal, session_hash, mid, query_id, utterance):
    """Return a local prompt, frozen submit arguments, or None for status handling.

    Customer locking orders concurrent turns with unlink and state updates. IPC
    is performed by the caller AFTER this transaction commits. Reserving phase
    SUBMITTING makes duplicate/concurrent clarification turns non-submitting.
    """
    from . import service
    customer, tenant = service.actor(principal)
    command = normalized(utterance)
    mark = hashlib.sha256(utterance.encode()).hexdigest()
    with transaction.atomic():
        Customer.objects.select_for_update(no_key=True).get(pk=customer)
        need(service.actor(principal) == (customer, tenant), 'AUTH_REQUIRED')
        binding = auth_binding(principal)
        now = timezone.now()
        row = VoiceDialogue.objects.select_for_update().filter(pk=session_hash, customer_id=customer,
                                                                tenant_id=tenant).first()
        state = None
        if row:
            if mid < row.last_message_id:
                return {'message': 'Это сообщение уже обработано. Задайте новый вопрос или спросите: готово?'}
            if mid == row.last_message_id:
                need(row.input_hash == mark, 'IDEMPOTENCY_CONFLICT')
            if command in CONTROL and row.phase in {'SUBMITTING', 'SENT'}:
                if command in CANCEL:
                    if row.cancel_id is None:
                        row.cancel_id = query_id
                    row.last_message_id, row.input_hash = mid, mark
                    row.save(update_fields=['cancel_id', 'last_message_id', 'input_hash'])
                return {'query_id': str(row.query_id), 'cancel_id': str(row.cancel_id) if row.cancel_id else None}
            if command in CONTROL and (row.expires_at <= now or row.phase in {'EXPIRED', 'CANCELLED'}):
                row.encrypted_payload = ''; row.save(update_fields=['encrypted_payload'])
                return {'message': EXPIRED if row.phase != 'CANCELLED' else 'Вопрос отменён. Он не отправлен на расчёт.'}
            if row.expires_at <= now and mid > row.last_message_id and command not in CONTROL:
                row.last_message_id, row.input_hash = mid, mark
                row.expires_at = now + LIFETIME
                save(row, {'auth': binding, 'phase': 'EXPIRED'})
                return {'message': EXPIRED}
            if row.encrypted_payload and row.expires_at > now:
                try:
                    state = unseal('voice-dialogue/v1', row.pk, row.encrypted_payload)
                    need(state['auth'] == binding, 'AUTH_REQUIRED')
                except (ValueError, KeyError, TypeError):
                    row.phase, row.encrypted_payload = 'EXPIRED', ''
                    row.save(update_fields=['phase', 'encrypted_payload'])
                    return {'message': EXPIRED}
            elif row.encrypted_payload:
                row.encrypted_payload = ''; row.save(update_fields=['encrypted_payload'])
            if mid == row.last_message_id:
                if not state:
                    return {'message': EXPIRED}
                if state['phase'] == 'CHOOSE':
                    return {'message': prompt(state)}
                if state['phase'] in {'SUBMITTING', 'SENT'}:
                    return {'message': receipt_message(customer, tenant, state['query_id'])}
                return {'message': 'Вопрос не отправлен. Задайте новый вопрос.'}
        if state and state['phase'] == 'CHOOSE':
            row.last_message_id, row.input_hash = mid, mark
            if command in CANCEL:
                save(row, {'auth': binding, 'phase': 'CANCELLED'})
                return {'message': 'Вопрос отменён. Он не отправлен на расчёт.'}
            if command in {'дальше', 'следующие'}:
                state['page'] = min(state['page'] + 5, ((len(state['stores']) - 1) // 5) * 5)
            elif command == 'назад':
                state['page'] = max(0, state['page'] - 5)
            else:
                selected = selection(state, utterance)
                if selected:
                    state['stores'], state['phase'] = selected, 'SUBMITTING'
                    save(row, state)
                    return {'submit': state.copy()}
            save(row, state)
            return {'message': prompt(state)}
        if command in CONTROL:
            return None
        if not command or command in ALL or command in ORDINALS or re.fullmatch(r'(?:номер )?\d{1,4}', command):
            return {'message': 'Какой отчёт подготовить? Задайте вопрос вместе с периодом.'}
        stores = candidates(tenant, utterance)
        if not stores:
            return {'message': 'Подключите нужный магазин в кабинете и задайте вопрос заново.'}
        state = {'auth': binding, 'phase': 'CHOOSE', 'question': utterance,
                 'query_id': query_id, 'stores': stores, 'page': 0}
        if row is None:
            row = VoiceDialogue(id=session_hash, customer_id=customer, tenant_id=tenant)
        row.last_message_id, row.input_hash = mid, mark
        row.cancel_id = None
        row.expires_at, row.retire_at = now + LIFETIME, now + timedelta(days=1)
        if len(stores) == 1 or all_stores(utterance):
            state['phase'] = 'SUBMITTING'
        save(row, state)
        return {'submit': state.copy()} if state['phase'] == 'SUBMITTING' else {'message': prompt(state)}


def complete(principal, session_hash, query_id):
    """Discard question/snapshot after an attempted dispatch, including UNKNOWN."""
    from . import service
    customer, tenant = service.actor(principal)
    with transaction.atomic():
        Customer.objects.select_for_update(no_key=True).get(pk=customer)
        row = VoiceDialogue.objects.select_for_update().filter(pk=session_hash, customer_id=customer,
                                                               tenant_id=tenant).first()
        if row and str(row.query_id) == query_id:
            row.phase, row.encrypted_payload = 'SENT', ''
            row.save(update_fields=['phase', 'encrypted_payload'])
            return str(row.cancel_id) if row.cancel_id else None
