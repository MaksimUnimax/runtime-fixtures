"""Product-local access. Original grants and adjustments are immutable facts."""
import uuid
from django.db import models
from django.db.models import F, Q
from alisa_platform.staff.models import AppendOnlyQuerySet

PRODUCT = 'alisa_market'


class Immutable(models.Model):
    objects = AppendOnlyQuerySet.as_manager()

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise TypeError('Access history is append-only')
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise TypeError('Access history is append-only')


class AccessLedger(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product_id = models.CharField(max_length=40, default=PRODUCT)
    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.PROTECT)
    revision = models.PositiveIntegerField(default=1)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['product_id', 'tenant'], name='access_product_tenant_once')]


class AccessPreview(Immutable):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product_id = models.CharField(max_length=40, default=PRODUCT)
    actor_id = models.UUIDField()
    actor_revision = models.PositiveIntegerField()
    kind = models.CharField(max_length=16)
    snapshot = models.JSONField()
    created_at = models.DateTimeField()
    expires_at = models.DateTimeField()


class AccessBatch(models.Model):
    id = models.UUIDField(primary_key=True)
    product_id = models.CharField(max_length=40, default=PRODUCT)
    actor_id = models.UUIDField()
    actor_revision = models.PositiveIntegerField()
    preview = models.OneToOneField(AccessPreview, on_delete=models.PROTECT)
    fingerprint = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)


class AccessBatchItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch = models.ForeignKey(AccessBatch, on_delete=models.PROTECT, related_name='items')
    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.PROTECT)
    customer = models.ForeignKey('accounts.Customer', on_delete=models.PROTECT)
    snapshot = models.JSONField()
    state = models.CharField(max_length=16, default='PENDING')
    outcome = models.CharField(max_length=40, default='')
    reserved_by = models.UUIDField(null=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['batch', 'tenant'], name='access_batch_tenant_once')]


class AccessCommand(models.Model):
    id = models.UUIDField(primary_key=True)
    product_id = models.CharField(max_length=40, default=PRODUCT)
    actor_id = models.UUIDField()
    batch = models.ForeignKey(AccessBatch, on_delete=models.PROTECT)
    fingerprint = models.CharField(max_length=64)
    payload = models.JSONField()
    item_ids = models.JSONField(default=list)
    result = models.JSONField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)


class AccessGrant(Immutable):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product_id = models.CharField(max_length=40, default=PRODUCT)
    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.PROTECT)
    source = models.CharField(max_length=16)
    source_id = models.UUIDField()
    days = models.PositiveSmallIntegerField()
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    actor_id = models.UUIDField()
    reason = models.CharField(max_length=40)
    comment = models.CharField(max_length=280, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['product_id', 'source_id'], name='access_grant_source_once'),
            models.CheckConstraint(condition=Q(ends_at__gt=F('starts_at')), name='access_grant_positive_interval'),
            models.CheckConstraint(condition=Q(days__gt=0), name='access_grant_positive_days'),
            models.CheckConstraint(condition=Q(source__in=['GIFT', 'COMPENSATION', 'PAYMENT']), name='access_grant_known_source'),
        ]


class AccessAdjustment(Immutable):
    id = models.UUIDField(primary_key=True)
    product_id = models.CharField(max_length=40, default=PRODUCT)
    grant = models.ForeignKey(AccessGrant, on_delete=models.PROTECT, related_name='adjustments')
    cutoff = models.DateTimeField()
    actor_id = models.UUIDField()
    reason = models.CharField(max_length=40)
    created_at = models.DateTimeField(auto_now_add=True)


class AccessNotification(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product_id = models.CharField(max_length=40, default=PRODUCT)
    event_id = models.UUIDField(unique=True)
    customer = models.ForeignKey('accounts.Customer', on_delete=models.PROTECT)
    grant = models.ForeignKey(AccessGrant, on_delete=models.PROTECT)
    kind = models.CharField(max_length=16)
    created_at = models.DateTimeField(auto_now_add=True)
    email_sent_at = models.DateTimeField(null=True)

