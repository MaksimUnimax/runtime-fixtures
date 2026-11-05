"""Explicit own authority configuration; never called by a build or migration."""
import os
import re
from urllib.parse import urlsplit
from django.conf import settings
from django.core.management.base import BaseCommand,CommandError
from django.contrib.auth.hashers import make_password,check_password
from allauth.idp.oidc.models import Client

class Command(BaseCommand):
    def add_arguments(self,parser):parser.add_argument('--apply',action='store_true',required=True)
    def handle(self,*args,**options):
        if not settings.IDENTITY_ENABLED:raise CommandError('Identity is disabled')
        for prefix in ['ALISA_WEB_OIDC','ALISA_PROBE_OIDC']:
            client_id=os.environ.get(prefix+'_CLIENT_ID','');secret=os.environ.get(prefix+'_CLIENT_SECRET','')
            callback=os.environ.get(prefix+'_REDIRECT_URI','');u=urlsplit(callback)
            if not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}',client_id) or not re.fullmatch(r'[A-Za-z0-9_-]{32,128}',secret) or secret.startswith('REPLACE_') or u.query or u.fragment or u.username or u.password:
                raise CommandError('Incomplete client configuration')
            if settings.ALISA_ENV=='stage' and callback not in {'https://alisa-stage.octoport.ru/auth/callback','https://alisa-stage.octoport.ru/oidc-probe/callback'}:
                raise CommandError('Unregistered stage callback')
            if settings.ALISA_ENV=='dev' and not (u.scheme in {'http','https'} and u.hostname in {'127.0.0.1','localhost'}):
                raise CommandError('Dev callback must be loopback')
            existing=Client.objects.filter(pk=client_id).first()
            if existing:
                if existing.redirect_uris!=callback or not check_password(secret,existing.secret):
                    raise CommandError('Existing client differs; explicit rotation procedure required')
                continue
            Client.objects.create(id=client_id,name='Алиса' if prefix=='ALISA_WEB_OIDC' else 'Проверка совместимости',
                secret=make_password(secret),type=Client.Type.CONFIDENTIAL,redirect_uris=callback,
                scopes='openid\nemail\nprofile',default_scopes='openid',grant_types='authorization_code',
                response_types='code',skip_consent=prefix=='ALISA_WEB_OIDC')
