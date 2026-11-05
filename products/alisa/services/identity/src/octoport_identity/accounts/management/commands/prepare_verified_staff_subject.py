"""Closed identity mapping only: no factor, token, session or permission is created."""
import uuid
from django.conf import settings
from django.core.management.base import BaseCommand,CommandError
from django.db import transaction
from django.contrib.auth import get_user_model
from allauth.account.models import EmailAddress
from allauth.idp.oidc.models import Client
from octoport_identity.accounts.models import Subject
class Command(BaseCommand):
    def add_arguments(self,parser):
        parser.add_argument('--apply',action='store_true',required=True)
        parser.add_argument('--person-id',required=True)
    @transaction.atomic
    def handle(self,*args,**o):
        if not settings.IDENTITY_ENABLED or not settings.IDENTITY_STAFF_ENABLED or settings.ALISA_ENV not in {'dev','stage'}:
            raise CommandError('Staff subject preparation unavailable')
        try:person_id=uuid.UUID(o['person_id'])
        except (ValueError,TypeError):raise CommandError('Person UUID required') from None
        person=get_user_model().objects.select_for_update().filter(pk=person_id,is_active=True).first()
        if (person is None or not EmailAddress.objects.select_for_update().filter(
                user=person,email__iexact=person.email,primary=True,verified=True).exists()):
            raise CommandError('Active person with verified primary contact required')
        client=Client.objects.filter(pk=settings.IDENTITY_STAFF_CLIENT_ID,type=Client.Type.CONFIDENTIAL,
            redirect_uris=settings.IDENTITY_STAFF_CALLBACK).first()
        if client is None:raise CommandError('Pinned dedicated admin client required')
        subject,_=Subject.objects.get_or_create(person=person,client=client)
        self.stdout.write('VERIFIED_ADMIN_SUBJECT:'+str(subject.pk))
