"""HTTP and request ownership checks, independent of Django and the runtime."""
from dataclasses import dataclass, field
import hashlib
import hmac
import re
import threading
import time
import uuid


class Failure(Exception):
    def __init__(self, code, status=400, message=None, meter=None):
        self.meter = meter
        self.code, self.status = code, status
        self.message = message or {
            'AUTH_REQUIRED': 'Войдите в свой аккаунт Octoport.',
            'FORBIDDEN': 'Нет доступа к этому диалогу.',
            'NO_STORES': 'Подключите магазин в личном кабинете.',
            'IDEMPOTENCY_CONFLICT': 'Этот запрос уже использован для другого сообщения.',
            'REQUEST_AUTH_EXPIRED': 'Сессия запроса истекла. Войдите и отправьте новый запрос.',
            'SERVICE_UNAVAILABLE': 'Сервис временно недоступен. Сохраните вопрос и повторите позже.',
            'REQUEST_UNKNOWN': 'Исход запроса ещё не подтверждён. Повторная отправка не запущена.',
        }.get(code, 'Не удалось выполнить запрос: ' + code)
        super().__init__(code)


def identifier(value):
    if not isinstance(value, str):
        raise Failure('INVALID_ID', 422)
    try:
        result = str(uuid.UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise Failure('INVALID_ID', 422) from None
    if result != value:
        raise Failure('INVALID_ID', 422)
    return result


def session_cookie(header):
    values = [part.strip().split('=', 1)[1] for part in (header or '').split(';')
              if part.strip().startswith('__Host-alisa_session=')]
    if len(values) != 1 or re.fullmatch(r'[A-Za-z0-9_-]{43}', values[0]) is None:
        raise Failure('AUTH_REQUIRED', 401)
    return values[0]


def require_origin(host, origin, expected='https://alisa.octoport.ru'):
    if host != expected.removeprefix('https://') or origin != expected:
        raise Failure('FORBIDDEN', 403)


def require_bearer(value, secret):
    expected = 'Bearer ' + secret
    if not secret or not hmac.compare_digest((value or '').encode(), expected.encode()):
        raise Failure('FORBIDDEN', 403)


def question(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 1200 or '\x00' in value:
        raise Failure('INVALID_QUESTION', 422, 'Введите вопрос длиной от 1 до 1200 символов.')
    return value.strip()


@dataclass(repr=False)
class Binding:
    actor_id: str
    tenant_id: str
    session_id: str
    request_id: str
    text_hash: str
    portal_token: str = field(repr=False)
    store_ids: tuple
    created: float
    active: bool = False
    completed: dict | None = None

    def __repr__(self):
        return '<AuthenticatedHarnessRequest>'


class Bindings:
    """Only the authenticated gateway can create a model-side request binding.

    A caller knowing an actor UUID and the bridge secret still cannot select an
    account. The original web session must be present and is checked again by
    the platform when the internal query executes.
    """
    def __init__(self, clock=time.time, ttl=1800):
        self.clock, self.ttl = clock, ttl
        self._values = {}
        self._lock = threading.RLock()

    @staticmethod
    def digest(text):
        return hashlib.sha256(text.encode()).hexdigest()

    def admit(self, profile, token, chat_id, request_id, text, store_ids):
        actor, tenant = identifier(profile['customer_id']), identifier(profile['tenant_id'])
        identifier(chat_id); identifier(request_id)
        wanted = (actor, tenant, chat_id, request_id, self.digest(text))
        with self._lock:
            for key, value in list(self._values.items()):
                if value.created + self.ttl <= self.clock() and not value.active:
                    del self._values[key]
            old = self._values.get(request_id)
            if old:
                if ((old.actor_id, old.tenant_id, old.session_id, old.request_id, old.text_hash) != wanted
                        or old.store_ids != tuple(sorted(store_ids))):
                    raise Failure('IDEMPOTENCY_CONFLICT', 409)
                # A replay cannot replace the login admitted for this request.
                # Another valid owner login can read job status/history, while
                # a new question or clarification receives its own request ID.
                return old
            value = Binding(*wanted, token, tuple(sorted(store_ids)), self.clock())
            self._values[request_id] = value
            return value

    def resolve(self, data):
        expected = {'actor_id', 'tenant_id', 'session_id', 'request_id', 'text'}
        if not isinstance(data, dict) or set(data) != expected:
            raise Failure('INVALID_PAYLOAD', 422)
        for field in expected - {'text'}:
            identifier(data[field])
        text = question(data['text'])
        with self._lock:
            value = self._values.get(data['request_id'])
            if not value or value.created + self.ttl <= self.clock():
                raise Failure('REQUEST_AUTH_EXPIRED', 401)
            actual = (value.actor_id, value.tenant_id, value.session_id, value.text_hash)
            wanted = (data['actor_id'], data['tenant_id'], data['session_id'], self.digest(text))
            if actual != wanted:
                raise Failure('FORBIDDEN', 403)
            return value

