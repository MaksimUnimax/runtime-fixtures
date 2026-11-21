"""Candidate integration policies; the library implements the OIDC protocol.

No custom signing, token verification, code generation, or PKCE algorithm.
DatabaseCache and a transaction lock keep the library's cache read/consume
sequence serialized across processes. This is a disposable prototype only.
"""
import hashlib
import re

from allauth.idp.oidc.adapter import DefaultOIDCAdapter
from django.db import connection, transaction, DatabaseError
from django.http import JsonResponse
from django.urls import reverse


class FixedIssuerAdapter(DefaultOIDCAdapter):
    def get_issuer(self):
        return 'https://id-probe.example.invalid'


class ProviderPolicy:
    def __init__(self,get_response):self.get_response=get_response

    def __call__(self,request):
        if request.get_host()!='id-probe.example.invalid':
            return JsonResponse({'error':'invalid_host'},status=400)
        if request.path==reverse('idp:oidc:authorization') and request.method=='GET':
            if (request.GET.getlist('code_challenge_method')!=['S256'] or
                len(request.GET.getlist('code_challenge'))!=1 or
                not re.fullmatch(r'[A-Za-z0-9_-]{43}',request.GET['code_challenge'])):
                return JsonResponse({'error':'invalid_request'},status=400)
        if (request.path==reverse('idp:oidc:token') and request.method=='POST' and
            request.POST.get('grant_type')=='authorization_code'):
            code=request.POST.get('code','')
            if not 20<=len(code)<=512:
                return JsonResponse({'error':'invalid_grant'},status=400)
            key=int.from_bytes(hashlib.sha256(code.encode()).digest()[:8],'big',signed=True)
            try:
                with transaction.atomic():
                    with connection.cursor() as cursor:
                        cursor.execute("SET LOCAL lock_timeout = '3s'")
                        cursor.execute('SELECT pg_advisory_xact_lock(%s)',[key])
                    response=self.get_response(request)
                    if response.status_code>=500:transaction.set_rollback(True)
                    return response
            except DatabaseError:
                return JsonResponse({'error':'temporarily_unavailable'},status=503)
        return self.get_response(request)
