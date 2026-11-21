"""Bounded cleanup invoked by the existing account cleanup timer."""
from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import AuthorizationRequest, AuthorizationCode, TokenFamily


def cleanup():
    now = timezone.now()
    with transaction.atomic():
        expired = AuthorizationRequest.objects.select_for_update(of=('self',), skip_locked=True).filter(
            Q(expires_at__lte=now) | Q(session__revoked_at__isnull=False) | Q(session__expires_at__lte=now))
        ids = list(expired.exclude(encrypted_payload='').values_list('pk', flat=True)[:1000])
        AuthorizationRequest.objects.filter(pk__in=ids).update(encrypted_payload='', consumed_at=now)
        stale = TokenFamily.objects.select_for_update(skip_locked=True).filter(
            Q(retry_until__lte=now) | Q(revoked_at__isnull=False) | Q(refresh_expires_at__lte=now))
        ids = list(stale.exclude(encrypted_response='').values_list('pk', flat=True)[:1000])
        TokenFamily.objects.filter(pk__in=ids).update(encrypted_response='', retry_until=None)
        for model, field in [(AuthorizationRequest, 'expires_at'), (AuthorizationCode, 'expires_at'),
                             (TokenFamily, 'refresh_expires_at')]:
            ids = list(model.objects.select_for_update(skip_locked=True).filter(
                **{field + '__lt': now - timedelta(days=1)}).values_list('pk', flat=True)[:1000])
            model.objects.filter(pk__in=ids).delete()
