"""Fixed authority and serialization around the library, not a new protocol."""
import hashlib
import re
import base64
from urllib.parse import urlsplit,unquote_plus
from django.conf import settings
from django.db import connection,transaction,DatabaseError
from django.http import JsonResponse
from django.urls import reverse

class IdentityPolicy:
    def __init__(self,get_response):self.get_response=get_response
    def __call__(self,request):
        if not settings.IDENTITY_ENABLED or request.path.startswith('/health/'):
            return self.get_response(request)
        if request.get_host()!=urlsplit(settings.IDENTITY_ISSUER).netloc:
            return JsonResponse({'error':'invalid_host'},status=400)
        if request.method=='POST' and request.path==reverse('idp:oidc:token'):
            # RFC 6749 §2.3.1 encodes both Basic components as form data.
            # Pinned allauth's parser does not decode them. Normalize transport
            # once, then delegate secret/grant/PKCE validation to the library.
            auth=request.META.get('HTTP_AUTHORIZATION','')
            scheme,_,credentials=auth.partition(' ')
            if scheme.lower()=='basic':
                try:
                    raw=base64.b64decode(credentials,validate=True).decode('utf-8')
                    client,separator,secret=raw.partition(':')
                    client=unquote_plus(client,errors='strict');secret=unquote_plus(secret,errors='strict')
                    if not separator or not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}',client) or not re.fullmatch(r'[A-Za-z0-9_-]{32,128}',secret):raise ValueError()
                    request.META['HTTP_AUTHORIZATION']='Basic '+base64.b64encode((client+':'+secret).encode()).decode()
                except (ValueError,UnicodeError):return JsonResponse({'error':'invalid_client'},status=401,headers={'WWW-Authenticate':'Basic realm="Alisa identity"'})
        authorization=reverse('idp:oidc:authorization')
        if request.path==authorization and request.method=='GET':
            if (request.GET.getlist('code_challenge_method')!=['S256'] or
                len(request.GET.getlist('code_challenge'))!=1 or
                not re.fullmatch(r'[A-Za-z0-9_-]{43}',request.GET['code_challenge'])):
                return JsonResponse({'error':'invalid_request'},status=400)
        scope=None
        if request.method=='POST' and request.path.startswith('/accounts/'):
            scope='browser:'+request.COOKIES.get(settings.SESSION_COOKIE_NAME,'anonymous')
        if request.method=='POST' and request.path==reverse('idp:oidc:token') and request.POST.get('grant_type')=='authorization_code':
            code=request.POST.get('code','')
            if not 20<=len(code)<=512:return JsonResponse({'error':'invalid_grant'},status=400)
            scope='code:'+code
        if scope is None:return self.get_response(request)
        key=int.from_bytes(hashlib.sha256(scope.encode()).digest()[:8],'big',signed=True)
        try:
            # This wraps SessionMiddleware, so load/save/cycle of a code-bearing
            # identity session participates in the same locked transaction.
            with transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute("SET LOCAL lock_timeout='3s'")
                    cursor.execute('SELECT pg_advisory_xact_lock(%s)',[key])
                response=self.get_response(request)
                if response.status_code>=500:transaction.set_rollback(True)
                return response
        except DatabaseError:return JsonResponse({'error':'temporarily_unavailable'},status=503)
