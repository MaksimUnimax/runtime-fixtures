"""Platform OAuth channel; the installed native/Station webhook is untouched."""
import hashlib
import uuid
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from alisa_platform.accounts.models import Customer
from alisa_platform.alice_link.oauth import server, SCOPE
from alisa_platform.runtime_adapter.authority import AlicePrincipal
from alisa_platform.runtime_adapter.job_client import RuntimeFailure, need, text
from alisa_platform.stores.models import Store
from . import service
from .models import Query

NAMESPACE = uuid.UUID('a54db138-f38d-4b7d-ac23-aaf12768b9c5')
MESSAGES = {
    'ACCESS_REQUIRED': 'Доступ к отчётам пока не активен. Проверьте срок доступа в кабинете.',
    'ACCOUNT_BLOCKED': 'Доступ к аккаунту ограничен.',
    'CREDENTIAL_REVOKED': 'Проверьте подключение ключей магазина в кабинете.',
    'CAPABILITY_UNAVAILABLE': 'Магазин пока не подключён к расчётам платформы.',
    'RESULT_EXPIRED': 'Срок хранения отчёта истёк. Для нового расчёта задайте вопрос заново.',
    'RESULT_NOT_READY': 'Расчёт ещё идёт. Спросите: готово?',
    'UNKNOWN_OUTCOME': 'Отправка не подтверждена. Откройте задание в кабинете. Новый расчёт автоматически не запущен.',
    'IDEMPOTENCY_CONFLICT': 'Это сообщение уже обработано с другим содержимым. Задайте новый вопрос.',
}


def response(token, customer, message, *, pages=None, result_kind='DATA', delivery_guard=None):
    # Privacy and token revocation are checked AFTER IPC, under the same customer
    # lock as unlink/privacy; no network runs while that lock is held.
    with transaction.atomic():
        need(Customer.objects.select_for_update(no_key=True).filter(pk=customer).exists(), 'AUTH_REQUIRED')
        valid, request = server().verify_request('https://alisa.octoport.ru/alice/oauth/token',
            http_method='POST', headers={'Authorization': 'Bearer ' + token}, scopes=[SCOPE])
        need(valid and str(request.user.customer_id) == customer, 'AUTH_REQUIRED')
        if pages is not None:
            need(isinstance(delivery_guard, service.DeliveryGuard), 'PERMISSION_DENIED')
            delivery_guard.check()
            message = (('Запрос пока не поддерживается.' if result_kind == 'UNSUPPORTED_QUERY' else 'Подготовлено пояснение об ограничении доступа.' if result_kind == 'PROVIDER_REFUSAL'
                        else 'Отчёт готов.') + ' Откройте его в разделе «Задания» в кабинете.'
                       if request.user.voice_private else pages[0] +
                       (' Полный отчёт доступен в кабинете.' if len(pages) > 1 else ''))
        return {'version': '1.0', 'response': {'text': message, 'end_session': False}}


def handle(token, payload):
    principal = AlicePrincipal(token)
    customer, tenant = service.actor(principal)
    session, request = payload.get('session'), payload.get('request')
    need(type(session) is dict and type(request) is dict)
    sid = text(session.get('session_id'), 128)
    mid = session.get('message_id'); need(type(mid) is int and 0 <= mid < 2**31)
    utterance = request.get('original_utterance', request.get('command', ''))
    text(utterance, 1200, empty=True)
    dialogue = ':'.join((settings.ALICE_SKILL_ID, customer, tenant, sid))
    session_hash = hashlib.sha256(dialogue.encode()).hexdigest()
    rid = str(uuid.uuid5(NAMESPACE, dialogue + ':' + str(mid)))
    command = utterance.strip().lower().rstrip('?!.,')
    try:
        if not command:
            return response(token, customer, 'Какой отчёт подготовить? Например: сколько заказов на Озон за вчера?')
        if command in {'готово', 'статус', 'ответ', 'повтори', 'отмена', 'отмени'}:
            row = Query.objects.filter(customer_id=customer, tenant_id=tenant, channel='ALICE',
                voice_session_hash=session_hash, expires_at__gt=timezone.now()).order_by('-created_at').first()
            if row is None:
                return response(token, customer, 'В этой беседе пока нет задания. Задайте вопрос для отчёта.')
            if command in {'отмена', 'отмени'}:
                value = service.cancel(principal, str(row.pk), rid)
                status = value.get('status', {})
                message = ('Задание отменено.' if status.get('cancelled') is True
                           else MESSAGES['UNKNOWN_OUTCOME'] if value.get('code') or status.get('state') == 'UNKNOWN'
                           or status.get('code') == 'UNKNOWN_OUTCOME' else 'Задание уже завершено.')
                return response(token, customer, message)
            value = service.read(principal, str(row.pk))
            if value.get('code'): return response(token, customer, MESSAGES['UNKNOWN_OUTCOME'])
            state = value['status']['state']
            if state == 'READY':
                value = service.read(principal, str(row.pk), result=True, with_delivery_guard=True)
                result = value['result']
                return response(token, customer, '', pages=result['pages'], result_kind=result.get('result_kind', 'DATA'),
                                delivery_guard=value['delivery_guard'])
            message = {'CANCELLED': 'Задание отменено.', 'FAILED': 'Расчёт не завершился. Подробности доступны в кабинете.',
                       'UNKNOWN': MESSAGES['UNKNOWN_OUTCOME'], 'EXPIRED': MESSAGES['RESULT_EXPIRED']}.get(
                           state, 'Расчёт ещё идёт. Спросите: готово?')
            return response(token, customer, message)
        # Explicit provider selection is allowed; ambiguous shops are never picked by order/name coincidence.
        stores = Store.objects.filter(tenant_id=tenant, product_id='alisa_market', status='ACTIVE',
                                      verified_identity__isnull=False)
        if 'озон' in command or 'ozon' in command: stores = stores.filter(provider='OZON')
        elif 'вайлдберриз' in command or 'wildberries' in command: stores = stores.filter(provider='WB')
        ids = [str(x) for x in stores.values_list('id', flat=True)[:2]]
        if len(ids) != 1:
            return response(token, customer, 'Выберите магазин и задайте вопрос в разделе «Задания» в кабинете.')
        value, _ = service.submit(principal, rid, ids, utterance, channel='ALICE', voice_session_hash=session_hash)
        return response(token, customer, MESSAGES['UNKNOWN_OUTCOME'] if not value['query']['submission_confirmed']
                        else 'Задание принято. Спросите: готово? Отчёт также появится в кабинете.')
    except RuntimeFailure as error:
        return response(token, customer, MESSAGES.get(error.code,
                        'Сейчас не удалось проверить отчёт. Откройте раздел «Задания» в кабинете.'))
