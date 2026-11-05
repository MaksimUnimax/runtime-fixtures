"""Finite cleanup of only owned expired/revoked account state."""
from datetime import timedelta
from django.conf import settings
from django.core.management.base import BaseCommand,CommandError
from django.db import transaction,DatabaseError
from django.db.models import Q
from django.utils import timezone
from alisa_platform.accounts.models import AuthFlow,WebSession

class Command(BaseCommand):
    def handle(self,*args,**options):
        if not settings.ACCOUNTS_ENABLED:return
        now=timezone.now()
        try:
            with transaction.atomic():
                expired=WebSession.objects.select_for_update(skip_locked=True).filter(Q(expires_at__lte=now)|Q(revoked_at__isnull=False))
                ids=list(expired.exclude(encrypted_payload='').values_list('pk',flat=True)[:1000])
                WebSession.objects.filter(pk__in=ids).update(encrypted_payload='')
                ids=list(AuthFlow.objects.select_for_update(skip_locked=True).filter(expires_at__lte=now).exclude(encrypted_payload='').values_list('pk',flat=True)[:1000])
                AuthFlow.objects.filter(pk__in=ids).update(encrypted_payload='')
                ids=list(WebSession.objects.select_for_update(skip_locked=True).filter(expires_at__lt=now-timedelta(days=1)).values_list('pk',flat=True)[:1000])
                WebSession.objects.filter(pk__in=ids).delete()
                ids=list(AuthFlow.objects.select_for_update(skip_locked=True).filter(expires_at__lt=now-timedelta(days=1)).values_list('pk',flat=True)[:1000])
                AuthFlow.objects.filter(pk__in=ids).delete()
        except DatabaseError:raise CommandError('Account state storage unavailable') from None
