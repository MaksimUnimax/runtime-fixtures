"""Minimal store checks, not analytical recipes, jobs, or credential storage."""
import json
import socket
import time
import urllib.error
import urllib.request
import uuid
from shared_http import read_response

VERSION = 'rt_check_v1'
MAX_MESSAGE = 32768
RESPONSE_LIMIT = 65536
ENDPOINTS = {
    'WB': ('GET', 'https://common-api.wildberries.ru/api/v1/seller-info'),
    'SELLER': ('POST', 'https://api-seller.ozon.ru/v1/seller/info'),
    'PERFORMANCE': ('POST', 'https://api-performance.ozon.ru/api/client/token'),
}
CODES = frozenset({'CONNECTED', 'AUTH_DENIED', 'SCOPE_MISSING', 'TIMEOUT', 'RATE_LIMITED',
    'CHECK_UNAVAILABLE', 'PROVIDER_UNAVAILABLE', 'IDENTITY_NOT_VERIFIED',
    'UNKNOWN_OUTCOME', 'PROVIDER_PLAN_REQUIRED', 'AUTHENTICATED_UNLINKED'})


def object_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError()
        result[key] = value
    return result


def bad_constant(_):
    raise ValueError()


def loads(raw):
    return json.loads(raw, object_pairs_hook=object_pairs, parse_constant=bad_constant)


def validate(message, environment):
    if (not isinstance(message, dict) or set(message) != {'schema_version', 'operation', 'pins', 'credential'}
            or message['schema_version'] != VERSION or message['operation'] != 'check_store'):
        raise ValueError()
    pins = message['pins']
    if not isinstance(pins, dict) or set(pins) != {'environment', 'product_id', 'tenant_id', 'store_id',
            'provider', 'kind', 'credential_revision', 'store_revision', 'request_id'}:
        raise ValueError()
    if pins['environment'] != environment or pins['product_id'] != 'alisa_market':
        raise ValueError()
    for field in ['tenant_id', 'store_id', 'request_id']:
        if not isinstance(pins[field], str) or str(uuid.UUID(pins[field])) != pins[field]:
            raise ValueError()
    for field in ['credential_revision', 'store_revision']:
        if type(pins[field]) is not int or not 1 <= pins[field] < 2**31:
            raise ValueError()
    kind = pins['kind']
    if (kind not in ENDPOINTS or pins['provider'] != ('WB' if kind == 'WB' else 'OZON')):
        raise ValueError()
    fields = {'WB': {'token'}, 'SELLER': {'client_id', 'api_key'}, 'PERFORMANCE': {'client_id', 'client_secret'}}[kind]
    credential = message['credential']
    if not isinstance(credential, dict) or set(credential) != fields:
        raise ValueError()
    for name, value in credential.items():
        if (not isinstance(value, str) or not (1 if name == 'client_id' else 12) <= len(value) <= (160 if name == 'client_id' else 8192)
                or not value.isascii() or any(ord(c) <= 32 or ord(c) >= 127 for c in value)):
            raise ValueError()
    if kind == 'SELLER' and (not credential['client_id'].isdigit() or int(credential['client_id']) < 1):
        raise ValueError()
    return pins, credential


def safe_result(result, pins):
    if not isinstance(result, dict) or result.get('code') not in CODES:
        return False
    if result['code'] == 'AUTHENTICATED_UNLINKED' and pins['kind'] != 'PERFORMANCE':
        return False
    if result['code'] != 'CONNECTED':
        return set(result) == {'code'}
    value = result.get('identity')
    fields = {'code', 'identity', 'capabilities'}
    if 'identity_provenance' in result:
        if pins['kind'] != 'PERFORMANCE' or result['identity_provenance'] != 'NATIVE_OWNER_CONFIGURED_PAIR':
            return False
        fields.add('identity_provenance')
    return (set(result) == fields and isinstance(value, str)
        and 1 <= len(value) <= 160 and all(c.isascii() and (c.isalnum() or c in ':_-') for c in value)
        and result['capabilities'] == [pins['kind']])


def error_code(kind, status, body=None):
    if status == 429:
        return 'RATE_LIMITED'
    if status == 401:
        return 'AUTH_DENIED'
    if kind == 'WB' and status == 402:
        return 'PROVIDER_PLAN_REQUIRED'
    if kind == 'SELLER' and isinstance(body, dict):
        message = body.get('message', '')
        if isinstance(message, str):
            if status == 404 and message.startswith('Invalid Api-Key'):
                return 'AUTH_DENIED'
            if status == 403 and message.startswith('Api-Key is deactivated'):
                return 'AUTH_DENIED'
            if status == 403 and message.startswith('Api-Key is missing a required role'):
                return 'SCOPE_MISSING'
        # 403 can also mean IP restrictions or an unsigned offer. Do not guess.
    # WB seller-info accepts every token category. A bare 403 does not prove
    # missing scope; preserve the unclassified safe failure below.
    elif kind == 'PERFORMANCE' and status == 400 and isinstance(body, dict) and body.get('error') == 'invalid_client':
        return 'AUTH_DENIED'
    return 'PROVIDER_UNAVAILABLE' if 500 <= status <= 599 else 'CHECK_UNAVAILABLE'


class Checker:
    def __init__(self, *, enabled=(), seller_binding_qualified=False, exchange=read_response, native_binding_resolver=None):
        if set(enabled)-ENDPOINTS.keys() or type(seller_binding_qualified) is not bool:
            raise ValueError()
        self.enabled = frozenset(enabled)
        self.seller_binding_qualified = seller_binding_qualified
        self.exchange = exchange
        self.native_binding_resolver = native_binding_resolver

    def check(self, message, environment):
        pins, credential = validate(message, environment)
        kind = pins['kind']
        if kind not in self.enabled:
            return {'code': 'CHECK_UNAVAILABLE'}
        method, url = ENDPOINTS[kind]
        headers = {'Content-Type': 'application/json', 'Accept': 'application/json'}
        payload = None
        if kind == 'WB':
            headers['Authorization'] = credential['token']
        elif kind == 'SELLER':
            # Minimum response shape only, not the complete provider schema.
            headers.update({'Client-Id': credential['client_id'], 'Api-Key': credential['api_key']})
            payload = b'{}'
        else:
            payload = json.dumps({'client_id': credential['client_id'], 'client_secret': credential['client_secret'],
                'grant_type': 'client_credentials'}, separators=(',', ':')).encode()
        request = urllib.request.Request(url, data=payload, headers=headers, method=method)
        try:
            raw, status = self.exchange(request, timeout=2.3, limit=RESPONSE_LIMIT, deadline=time.monotonic()+2.3)
        except urllib.error.HTTPError as error:
            try:
                raw = error.read(RESPONSE_LIMIT+1)
                body = loads(raw) if len(raw) <= RESPONSE_LIMIT else None
            except (OSError, ValueError, UnicodeError):
                body = None
            finally:
                error.close()
            return {'code': error_code(kind, error.code, body)}
        except (TimeoutError, socket.timeout):
            return {'code': 'TIMEOUT'}
        except urllib.error.URLError as error:
            return {'code': 'TIMEOUT' if isinstance(error.reason, TimeoutError) else 'PROVIDER_UNAVAILABLE'}
        except (OSError, ValueError):
            return {'code': 'PROVIDER_UNAVAILABLE'}
        if len(raw) > RESPONSE_LIMIT:
            return {'code': 'PROVIDER_UNAVAILABLE'}
        try:
            data = loads(raw)
        except (ValueError, UnicodeError):
            return {'code': 'IDENTITY_NOT_VERIFIED'}
        if status != 200:
            return {'code': error_code(kind, status, data)}
        if kind == 'WB':
            try:
                sid = data['sid']
                if not isinstance(sid, str) or uuid.UUID(sid).version != 4:
                    raise ValueError()
                identity = 'wb:sid:'+str(uuid.UUID(sid))
            except (ValueError, KeyError, TypeError, AttributeError):
                return {'code': 'IDENTITY_NOT_VERIFIED'}
        elif kind == 'SELLER':
            company = data.get('company') if isinstance(data, dict) else None
            if (not isinstance(company, dict) or not all(isinstance(company.get(k), str)
                    and 0 < len(company[k]) <= 300 for k in ['name', 'country', 'currency', 'inn'])
                    or not self.seller_binding_qualified):
                return {'code': 'IDENTITY_NOT_VERIFIED'}
            # Root-controlled qualification must prove Client-Id/key pair binding;
            # never infer the cabinet from company name, INN or OGRN.
            identity = 'ozon:client:'+str(int(credential['client_id']))
        else:
            # Issuance alone never proves Seller identity. The optional root-owned
            # projection reuses an existing, explicitly qualified native pair.
            token = data.get('access_token') if isinstance(data, dict) else None
            if (not isinstance(token, str) or not 12 <= len(token) <= 16384
                    or not token.isascii() or any(ord(c) <= 32 or ord(c) >= 127 for c in token)
                    or not isinstance(data.get('token_type'), str) or data['token_type'].lower() != 'bearer'
                    or type(data.get('expires_in')) is not int or not 0 < data['expires_in'] < 2**31):
                return {'code': 'IDENTITY_NOT_VERIFIED'}
            try:
                if self.native_binding_resolver is None:
                    from native_store_binding import resolve
                    identity = resolve(pins, credential)
                else:
                    identity = self.native_binding_resolver(pins, credential)
            except Exception:
                identity = None
            if identity:
                result = {'code': 'CONNECTED', 'identity': identity, 'capabilities': [kind],
                          'identity_provenance': 'NATIVE_OWNER_CONFIGURED_PAIR'}
                if safe_result(result, pins):
                    return result
            return {'code': 'AUTHENTICATED_UNLINKED'}
        return {'code': 'CONNECTED', 'identity': identity, 'capabilities': [kind]}
