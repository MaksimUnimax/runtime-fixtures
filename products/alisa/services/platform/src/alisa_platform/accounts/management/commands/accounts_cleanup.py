"""Finite cleanup of only owned expired/revoked account state."""
from datetime import timedelta
from django.conf import settings
from django.core.management.base import BaseCommand,CommandError
from django.db import transaction,DatabaseError
from django.db.models import Q
from django.utils import timezone
from alisa_platform.accounts.models import AuthFlow,WebSession
from alisa_platform.staff.models import StaffAuthFlow,StaffSession
from alisa_platform.staff.policy import PRODUCT

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
                for model in [StaffSession,StaffAuthFlow]:
                    stale=Q(expires_at__lte=now)
                    if model is StaffSession:stale|=Q(revoked_at__isnull=False)
                    ids=list(model.objects.select_for_update(skip_locked=True).filter(stale,product_id=PRODUCT).exclude(encrypted_payload='').values_list('pk',flat=True)[:1000])
                    model.objects.filter(pk__in=ids).update(encrypted_payload='')
                ids=list(StaffSession.objects.select_for_update(skip_locked=True).filter(product_id=PRODUCT,expires_at__lt=now-timedelta(days=1)).values_list('pk',flat=True)[:1000])
                StaffSession.objects.filter(pk__in=ids).delete()
                ids=list(StaffAuthFlow.objects.select_for_update(of=('self',),skip_locked=True).filter(product_id=PRODUCT,expires_at__lt=now-timedelta(days=1),staffsession__isnull=True).values_list('pk',flat=True)[:1000])
                StaffAuthFlow.objects.filter(pk__in=ids).delete()
        except DatabaseError:raise CommandError('Account state storage unavailable') from None
