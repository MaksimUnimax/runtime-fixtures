"""Private authority RPC. Credential replies are restricted to the native peer."""
import hashlib
import hmac

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from .authority import PRODUCT, RuntimeAuthority
from .bindings import BindingFile
from .job_client import RuntimeFailure, decode, encode, exact, identifier, need

MAX_BODY = 131072


def configured_authority():
    return RuntimeAuthority(BindingFile(settings.RUNTIME_BINDINGS_PATH),
        service_id=settings.RUNTIME_SERVICE_ID, catalog_release_id=settings.RUNTIME_CATALOG_RELEASE_ID)


def signed_reply(value, status=200):
    mac = hmac.new(settings.RUNTIME_AUTHORITY_TOKEN.encode(), encode(value), hashlib.sha256).hexdigest()
    return JsonResponse({'payload': value, 'mac': mac}, status=status,
        headers={'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'})


@csrf_exempt
def check(request):
    if not getattr(settings, 'RUNTIME_AUTHORITY_ENABLED', False):
        return JsonResponse({'code': 'NOT_FOUND'}, status=404)
    if (request.method != 'POST' or request.content_type != 'application/json'
        or request.META.get('QUERY_STRING') or request.headers.get('Origin')
        or request.headers.get('Transfer-Encoding')):
        return JsonResponse({'code': 'VALIDATION_FAILED'}, status=422)
    expected = ('Bearer ' + settings.RUNTIME_AUTHORITY_TOKEN).encode()
    if not hmac.compare_digest(request.headers.get('Authorization', '').encode(), expected):
        return JsonResponse({'code': 'UNAUTHORIZED'}, status=401)
    request_id = None
    try:
        length = request.headers.get('Content-Length', '')
        need(length.isascii() and length.isdigit() and 0 < int(length) <= MAX_BODY)
        # Bound the stream without inheriting the smaller public form body limit.
        raw = request.read(MAX_BODY + 1)
        need(len(raw) == int(length) and len(raw) <= MAX_BODY)
        body = decode(raw)
        exact(body, {'schema', 'request_id', 'service_id', 'operation', 'payload'})
        request_id = identifier(body['request_id'])
        need(body['schema'] == 'runtime_authority_v1' and body['service_id'] == settings.RUNTIME_SERVICE_ID)
        if body['operation']=='gap_ingest':
            from alisa_platform.query_insights.service import ingest
            data=ingest(body['payload'])
        elif body['operation'] == 'credentials':
            from .store_registry import credentials
            data = credentials(configured_authority(), body['payload'])
        elif body['operation'] == 'verify':
            authority=configured_authority()
            exact(body['payload'], {'ticket'})
            data = authority.verify(body['payload']['ticket'], body['service_id'])
        else:
            need(body['operation'] == 'resolve')
            authority=configured_authority()
            exact(body['payload'], {'pins', 'action'})
            data = authority.resolve(body['payload']['pins'], body['payload']['action'])
        result = {'schema': 'runtime_authority_v1', 'product_id': PRODUCT,
                  'request_id': request_id, 'ok': True, 'data': data}
        need(len(encode(result)) <= 524288, 'CAPABILITY_UNAVAILABLE')
        return signed_reply(result)
    except RuntimeFailure as failure:
        return signed_reply({'schema': 'runtime_authority_v1', 'product_id': PRODUCT,
            'request_id': request_id, 'ok': False, 'code': failure.code}, failure.http_status)
    except Exception:
        return signed_reply({'schema': 'runtime_authority_v1', 'product_id': PRODUCT,
            'request_id': request_id, 'ok': False, 'code': 'DEPENDENCY_UNAVAILABLE'}, 503)
