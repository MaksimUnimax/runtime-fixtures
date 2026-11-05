import uuid
from django.db import models
from django.db.models import Q

class FunnelEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event_type = models.CharField(max_length=32)
    subject_id = models.UUIDField(null=True)
    product_id = models.CharField(max_length=32, default='alisa_market')
    environment = models.CharField(max_length=8)
    release = models.CharField(max_length=80)
    content_version = models.CharField(max_length=64)
    occurred_at = models.DateTimeField(auto_now_add=True)
    # Contains only mapped constants; no raw URL/query/referrer/contact/token.
    attribution = models.JSONField(default=dict)
    basis = models.CharField(max_length=16, default='service')

    class Meta:
        constraints = [models.UniqueConstraint(fields=['event_type', 'subject_id'],
                       condition=Q(subject_id__isnull=False), name='funnel_subject_effect_once')]
