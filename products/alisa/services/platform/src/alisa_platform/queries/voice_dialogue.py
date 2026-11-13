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
from .models import VoiceDialogue, VoiceStorePreference, Query

LIFETIME = timedelta(minutes=10)
CONTROL = {'готово', 'статус', 'ответ', 'повтори', 'отмена', 'отмени'}
CANCEL = {'отмена', 'отмени'}
ALL = {'все', 'всё', 'все магазины', 'по всем', 'по всем магазинам'}
EXPLICIT_ALL = {'все магазины', 'по всем магазинам'}
EXPIRED = 'Уточнение больше не действует. Задайте вопрос заново вместе с магазином.'
ACCEPTED = 'Задание принято. Спросите: готово? Отчёт также появится в кабинете.'
UNKNOWN = 'Отправка не подтверждена. Откройте задание в кабинете. Новый расчёт автоматически не запущен.'
ORDINALS = {'первый': 1, 'первое': 1, 'второй': 2, 'второе': 2,
            'третий': 3, 'третье': 3, 'четвертый': 4, 'пятый': 5}
PROVIDERS = {'OZON': {'озон', 'ozon'}, 'WB': {'вайлдберриз', 'вайлдберис', 'wildberries', 'вб', 'wb'}}
SWITCH = {'смени магазин', 'сменить магазин', 'сменим магазин', 'выбери магазин',
          'выбрать магазин', 'другой магазин', 'переключить магазин', 'магазины'}
SWITCH_PREFIXES = ('смени магазин на ', 'сменить магазин на ', 'переключись на магазин ',
                   'переключи на магазин ', 'выбери магазин ', 'выбрать магазин ',
                   'теперь магазин ', 'смени магазин ', 'магазин ')


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


class TurnPrincipal:
    """Narrow admission lifetime; OAuth proof and all rights remain unchanged."""
    def __init__(self, delegate, deadline):
        self.delegate, self.deadline = delegate, deadline

    def current(self):
        customer, tenant, until, proof = self.delegate.current()
        return customer, tenant, min(until, self.deadline), proof


class PinnedAuthorizer:
    """Normal authority remains responsible for access; reject changed selection.

    Check on EVERY prepare, including RuntimeClient's second prepare. Its normal
    current(ticket) guard then rejects a change after prepare and before IPC.
    """
    def __init__(self, delegate, customer, tenant, selected, session_hash, query_id):
        self.delegate, self.tenant, self.selected = delegate, tenant, selected
        self.customer, self.session_hash, self.query_id = customer, session_hash, query_id
        row = VoiceDialogue.objects.filter(session_hash=session_hash, customer_id=customer,
                    tenant_id=tenant, query_id=query_id, phase='SUBMITTING').first()
        if row is None:
            raise SelectionChanged()
        # Runtime verifies this signed not_after too. Even a paused socket sender
        # cannot admit an abandoned turn after its deadline.
        self.delegate.principal = TurnPrincipal(self.delegate.principal, row.expires_at.timestamp())

    def check(self):
        # Fence a sender that resumes after its dispatch was abandoned/replaced.
        if not VoiceDialogue.objects.filter(session_hash=self.session_hash, customer_id=self.customer,
                tenant_id=self.tenant, query_id=self.query_id, phase='SUBMITTING',
                expires_at__gt=timezone.now()).exists():
            raise SelectionChanged()
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
        result = self.delegate.current(context, operation)
        self.check()
        return result


def prompt(state):
    rows, start = state['stores'], state['page']
    labels = [f"{i + 1}. {row['name'][:80]} ({'Озон' if row['provider'] == 'OZON' else 'Вайлдберриз'})"
              for i, row in enumerate(rows) if start <= i < start + 5]
    more = ' Для продолжения списка скажите: дальше.' if start + 5 < len(rows) else ''
    notice = 'Ранее выбранный магазин недоступен. Выберите другой. ' if state.get('default_unavailable') else ''
    return (notice + f"Уточните магазин. В списке {len(rows)}. " + '; '.join(labels) +
            '. Назовите номер или название; при совпадении с командой скажите: магазин, затем название. '
            'Для всех скажите: все магазины.' + more)


def selection(state, utterance):
    command = normalized(utterance)
    rows = state['stores']
    if not command:
        return []
    # Explicit grammar is stable even when a shop is named after a command.
    if command in EXPLICIT_ALL:
        return rows
    match = re.fullmatch(r'номер (\d{1,4})', command)
    if match:
        index = int(match[1])
        return rows[index - 1:index] if 1 <= index <= len(rows) else []
    literal = command.startswith('магазин ')
    name = command[len('магазин '):] if literal else command
    exact = [row for row in rows if name in {normalized(row['name']), normalized(row['alias'])} - {''}]
    if literal or len(exact) > 1:
        return exact if len(exact) == 1 else []
    selected = None
    if command in ALL:
        selected = rows
    index = ORDINALS.get(command)
    match = re.fullmatch(r'(\d{1,4})', command)
    if match:
        index = int(match[1])
    if index is not None:
        selected = rows[index - 1:index] if 1 <= index <= len(rows) else []
    wanted = providers(command)
    if len(wanted) == 1 and command in set().union(*PROVIDERS.values()):
        selected = [row for row in rows if row['provider'] in wanted]
    if exact:
        if selected is not None and {row['id'] for row in exact} != {row['id'] for row in selected}:
            # Do not dispatch or narrow the frozen list on competing meanings.
            return []
        return exact
    if selected is not None:
        if command in ALL or index is not None:
            return selected
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


def switch_target(command):
    if command in SWITCH:
        return ''
    for prefix in SWITCH_PREFIXES:
        if command.startswith(prefix):
            return command[len(prefix):].strip()
    return None


def explicit_target(state, target):
    # Without a displayed list a number is a literal shop name, not a position.
    exact = selection(state, 'магазин ' + target)
    if exact:
        return exact
    if target in set().union(*PROVIDERS.values()):
        return selection(state, target)
    return []


def named_stores(rows, command):
    marker = r'\b(?:в магазине|из магазина|по магазину|для магазина|магазин)\s+'
    markers = list(re.finditer(marker, command))
    if not markers:
        return False, []
    requested = []
    for match in markers:
        tail = command[match.end():].strip()
        if tail.startswith(('«', '"')):
            end = tail.find('»' if tail[0] == '«' else '"', 1)
            if end < 0:
                return True, []
            name = tail[1:end]
        else:
            # A trailing unquoted name is exact too. Never guess its boundary
            # inside an unknown longer name; use quotes for a name mid-question.
            name = re.split(r'[,;.!?]', tail, maxsplit=1)[0]
        requested.append(normalized(name))
    names = {row['id']: {normalized(row['name']).strip('«»"'), normalized(row['alias']).strip('«»"')} - {''}
             for row in rows}
    if any(not name or not any(name in choices for choices in names.values()) for name in requested):
        return True, []
    return True, [row for row in rows if any(name in names[row['id']] for name in requested)]


def preferred_store(customer, tenant, rows):
    preference = VoiceStorePreference.objects.filter(customer_id=customer, tenant_id=tenant).first()
    if preference is None:
        return None, False
    selected = next((row for row in rows if row['id'] == str(preference.store_id)), None)
    if selected is None:
        return None, True
    # Local readiness only: ordinary authority still checks actual rights on IPC.
    mapping = bindings(tenant)
    entry = mapping['stores'].get(selected['id']) if mapping else None
    store = Store.objects.get(pk=preference.store_id)
    credentials = list(CredentialRevision.objects.filter(store=store, status='ACTIVE'))
    actual = [{'id': str(c.pk), 'kind': c.kind, 'revision': c.revision} for c in credentials]
    if (entry is None or entry['provider'] != store.provider or
            entry['verified_identity'] != store.verified_identity or
            any(c.check_code not in {'CONNECTED', 'CONNECTED_NATIVE_OWNER'} for c in credentials) or
            sorted(actual, key=lambda c: c['kind']) != sorted(entry['credentials'], key=lambda c: c['kind'])):
        return None, True
    return selected, True


def choose(row, state, selected, customer, tenant):
    if state.get('selection_only') and len(selected) != 1:
        save(row, state)
        return {'message': 'Для магазина по умолчанию выберите один. ' + prompt(state)}
    if len(selected) == 1 and not state.get('all_once'):
        store = Store.objects.filter(pk=selected[0]['id'], tenant_id=tenant, status='ACTIVE',
                                     product_id='alisa_market', verified_identity__isnull=False).first()
        if store is None or snapshot(store, bindings(tenant))['pin'] != selected[0]['pin']:
            raise SelectionChanged()
        VoiceStorePreference.objects.update_or_create(customer_id=customer,
            defaults={'tenant_id': tenant, 'store_id': store.pk})
    if state.get('selection_only'):
        message = 'Текущий магазин: ' + selected[0]['name'][:80] + '. Задайте вопрос для отчёта.'
        save(row, {'auth': state['auth'], 'phase': 'SELECTED', 'query_id': None, 'message': message})
        return {'message': message}
    state['stores'], state['phase'] = selected, 'SUBMITTING'
    save(row, state)
    return {'submit': state.copy()}


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
        row = VoiceDialogue.objects.select_for_update().filter(session_hash=session_hash, customer_id=customer,
                tenant_id=tenant).order_by('-last_message_id').first()
        state = None
        if row:
            if mid < row.last_message_id:
                return {'message': 'Это сообщение уже обработано. Задайте новый вопрос или спросите: готово?'}
            if mid == row.last_message_id:
                need(row.input_hash == mark, 'IDEMPOTENCY_CONFLICT')
            if row.phase == 'SUBMITTING' and row.expires_at <= now:
                row.phase, row.encrypted_payload = 'ABANDONED', ''
                row.save(update_fields=['phase', 'encrypted_payload'])
            if row.phase == 'ABANDONED' and command in CONTROL:
                return ({'message': UNKNOWN} if command in CANCEL else
                        {'query_id': str(row.query_id), 'cancel_id': None})
            if command in CONTROL and row.phase in {'SUBMITTING', 'SENT'}:
                if command in CANCEL:
                    if row.cancel_started and mid == row.last_message_id:
                        return {'message': 'Отмена уже запрошена. Проверьте состояние: готово?'}
                    if row.cancel_id is None:
                        row.cancel_id = query_id
                    row.last_message_id, row.input_hash = mid, mark
                    if row.phase == 'SENT':
                        row.cancel_started = True
                    row.save(update_fields=['cancel_id', 'cancel_started', 'last_message_id', 'input_hash'])
                    if row.phase == 'SUBMITTING':
                        return {'message': 'Запрос на отмену принят. Остановка ещё не подтверждена.'}
                return {'query_id': str(row.query_id), 'cancel_id': str(row.cancel_id) if row.cancel_id else None}
            if row.phase == 'SUBMITTING':
                return {'message': 'Отправка предыдущего вопроса ещё не подтверждена. Дождитесь подтверждения или скажите: отмена.'}
            if command in CONTROL and (row.expires_at <= now or row.phase in {'EXPIRED', 'CANCELLED'}):
                row.encrypted_payload = ''; row.save(update_fields=['encrypted_payload'])
                return {'message': EXPIRED if row.phase != 'CANCELLED' else 'Вопрос отменён. Он не отправлен на расчёт.'}
            if row.phase == 'CHOOSE' and row.expires_at <= now and mid > row.last_message_id and command not in CONTROL:
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
                if state['phase'] == 'SELECTED':
                    return {'message': state['message']}
                return {'message': 'Вопрос не отправлен. Задайте новый вопрос.'}
        if state and state['phase'] == 'CHOOSE':
            row.last_message_id, row.input_hash = mid, mark
            if command in CANCEL:
                save(row, {'auth': binding, 'phase': 'CANCELLED'})
                return {'message': 'Вопрос отменён. Он не отправлен на расчёт.'}
            if command in CONTROL:
                pass  # Status/repeat must not become a shop selection.
            elif command in {'дальше', 'следующие'}:
                state['page'] = min(state['page'] + 5, ((len(state['stores']) - 1) // 5) * 5)
            elif command == 'назад':
                state['page'] = max(0, state['page'] - 5)
            else:
                target = switch_target(command)
                if target is not None:
                    # A clarification always uses the original frozen pins.
                    selected = explicit_target(state, target) if target else []
                else:
                    selected = selection(state, utterance)
                if selected:
                    state['all_once'] = command in ALL and not state.get('selection_only')
                    return choose(row, state, selected, customer, tenant)
            save(row, state)
            return {'message': prompt(state)}
        if command in CONTROL:
            return None
        if not command or command in ALL or command in ORDINALS or re.fullmatch(r'(?:номер )?\d{1,4}', command):
            return {'message': 'Какой отчёт подготовить? Задайте вопрос вместе с периодом.'}
        target = switch_target(command)
        all_rows = candidates(tenant, '')
        explicit, named = named_stores(all_rows, command) if target is None else (False, [])
        wanted = providers(command)
        stores = all_rows if target is not None or len(wanted) != 1 else [r for r in all_rows if r['provider'] in wanted]
        selected, unavailable = [], False
        preference, had_preference = preferred_store(customer, tenant, all_rows)
        if target is None:
            if explicit:
                stores = named or stores
                selected = named if len(named) == 1 else []
            elif all_stores(utterance):
                selected = stores
            elif preference and (len(wanted) != 1 or preference['provider'] in wanted):
                selected = [preference]
            elif had_preference and preference is None:
                unavailable = True  # Never silently replace a disabled/revoked default.
            elif len(stores) == 1:
                selected = stores
        if not stores:
            return {'message': 'Подключите нужный магазин в кабинете и задайте вопрос заново.'}
        state = {'auth': binding, 'phase': 'CHOOSE', 'question': utterance,
                 'query_id': query_id, 'stores': stores, 'page': 0,
                 'selection_only': target is not None, 'default_unavailable': unavailable,
                 'all_once': target is None and not explicit and all_stores(utterance)}
        row = VoiceDialogue(id=hashlib.sha256((session_hash + ':' + query_id).encode()).hexdigest(),
                            session_hash=session_hash, customer_id=customer, tenant_id=tenant)
        row.last_message_id, row.input_hash = mid, mark
        row.cancel_id = None
        row.cancel_started = False
        row.expires_at, row.retire_at = now + LIFETIME, now + timedelta(days=1)
        if target:
            selected = explicit_target(state, target)
        if selected:
            return choose(row, state, selected, customer, tenant)
        save(row, state)
        return {'message': prompt(state)}


def complete(principal, session_hash, query_id):
    """Discard question/snapshot after an attempted dispatch, including UNKNOWN."""
    from . import service
    customer, tenant = service.actor(principal)
    with transaction.atomic():
        Customer.objects.select_for_update(no_key=True).get(pk=customer)
        row = VoiceDialogue.objects.select_for_update().filter(session_hash=session_hash, query_id=query_id,
                customer_id=customer, tenant_id=tenant).first()
        if row and row.phase == 'SUBMITTING' and row.expires_at > timezone.now():
            row.phase, row.encrypted_payload = 'SENT', ''
            cancellation = str(row.cancel_id) if row.cancel_id and not row.cancel_started else None
            if cancellation:
                row.cancel_started = True
            row.save(update_fields=['phase', 'encrypted_payload', 'cancel_started'])
            return cancellation
