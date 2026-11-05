"""Closed fixed-domain cutover of the existing authority; never creates people/factors."""
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction, connection
from django.contrib.sessions.models import Session
from django.utils import timezone
from allauth.idp.oidc.models import Client, Token
from octoport_identity.accounts.models import ProtocolCache, IdentityMail

OLD='https://alisa-admin-stage.octoport.ru/auth/callback'
NEW='https://alisa-admin.octoport.ru/auth/callback'

class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', required=True)
    @transaction.atomic
    def handle(self, *args, **options):
        if not (settings.ALISA_ENV=='stage' and settings.CANONICAL_AUTH_ENABLED
                and settings.IDENTITY_ENABLED and settings.IDENTITY_STAFF_ENABLED
                and settings.IDENTITY_ISSUER=='https://id.octoport.ru'
                and settings.IDENTITY_STAFF_CLIENT_ID=='alisa_admin_stage'
                and settings.IDENTITY_STAFF_CALLBACK==NEW):
            raise CommandError('Fixed canonical authority configuration required')
        # Stop this authority and its mail worker before calling this command.
        # Locks also prevent stale protocol/session writes from racing this transaction.
        with connection.cursor() as cursor:
            cursor.execute('LOCK TABLE allauth_idp_oidc_client, allauth_idp_oidc_token, django_session, identity_protocol_cache, accounts_identitymail IN SHARE ROW EXCLUSIVE MODE')
        client=Client.objects.select_for_update().filter(pk=settings.IDENTITY_STAFF_CLIENT_ID, type=Client.Type.CONFIDENTIAL).first()
        if client is not None and client.redirect_uris==NEW:
            self.stdout.write('CANONICAL_STAFF_CALLBACK_ALREADY_APPLIED')
            return
        if client is None or client.redirect_uris!=OLD:
            raise CommandError('Exact previous confidential admin callback required; inspect before retry')
        client.redirect_uris=NEW
        client.save(update_fields=['redirect_uris'])
        # Opaque token rows have no issuer column; retaining them would carry old authority forward.
        Token.objects.all().delete()
        ProtocolCache.objects.all().delete()
        Session.objects.all().delete()
        IdentityMail.objects.filter(sent_at__isnull=True).update(
            encrypted_payload='', expires_at=timezone.now(), lease_until=None, error_code='AUTHORITY_DOMAIN_CHANGED')
        self.stdout.write('CANONICAL_STAFF_CALLBACK_APPLIED')
