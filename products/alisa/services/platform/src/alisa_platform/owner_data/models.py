"""Current approved owner settings, not another analytical queue or result cache."""
import uuid
from django.db import models
from django.db.models import Q

PRODUCT = 'alisa_market'

class OwnerDataset(models.Model):
    store = models.OneToOneField('stores.Store', primary_key=True, on_delete=models.PROTECT)
    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.PROTECT)
    product_id = models.CharField(max_length=40, default=PRODUCT)
    revision = models.PositiveIntegerField(default=0)
    approval_id = models.UUIDField(null=True)
    approved_by = models.ForeignKey('accounts.Customer', on_delete=models.PROTECT, null=True)
    approved_security_revision = models.PositiveIntegerField(null=True)
    approved_at = models.DateTimeField(null=True)
    status = models.CharField(max_length=16, default='NOT_PROVIDED')
    catalog_hash = models.CharField(max_length=64, default='')
    content_hash = models.CharField(max_length=64, default='')
    # Only the current user-entered facts persist; accepted jobs pin their own TTL copy.
    facts = models.JSONField(default=dict)
    class Meta:
        constraints = [models.CheckConstraint(condition=Q(product_id=PRODUCT), name='owner_data_product'),
                       models.CheckConstraint(condition=Q(status__in=['NOT_PROVIDED','APPROVED','REVOKED']), name='owner_data_status')]

class OwnerCommand(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    request_id = models.UUIDField()
    product_id = models.CharField(max_length=40, default=PRODUCT)
    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.PROTECT)
    customer = models.ForeignKey('accounts.Customer', on_delete=models.PROTECT)
    store = models.ForeignKey('stores.Store', on_delete=models.PROTECT)
    fingerprint = models.CharField(max_length=64)
    security_revision = models.PositiveIntegerField()
    result = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        constraints = [models.UniqueConstraint(fields=['tenant','customer','request_id'], name='owner_command_once'),
                       models.CheckConstraint(condition=Q(product_id=PRODUCT), name='owner_command_product')]


class CurrentParameter(models.Model):
    """One current value per target. Revision is a CAS token, not history.

    INHERIT keeps no value/passport but retains the monotonic revision, avoiding
    ABA when a SKU exception is removed and later created again.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product_id = models.CharField(max_length=40, default=PRODUCT)
    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.PROTECT)
    store = models.ForeignKey('stores.Store', on_delete=models.PROTECT)
    key = models.CharField(max_length=80)
    scope_kind = models.CharField(max_length=8)
    sku = models.CharField(max_length=20, default='')
    state = models.CharField(max_length=12, default='VALUE')
    value = models.CharField(max_length=80, null=True)
    unit = models.CharField(max_length=40, default='')
    origin = models.CharField(max_length=16, default='')
    revision = models.PositiveBigIntegerField(default=0)
    updated_by = models.ForeignKey('accounts.Customer', on_delete=models.PROTECT)
    updated_at = models.DateTimeField()
    collected_at = models.DateTimeField(null=True)
    calculated_at = models.DateTimeField(null=True)
    requested_period = models.JSONField(null=True)
    actual_period = models.JSONField(null=True)
    evidence = models.JSONField(default=dict)
    definition_hash = models.CharField(max_length=64, default='')
    class Meta:
        constraints = [
          models.UniqueConstraint(fields=['product_id','store','key','scope_kind','sku'],name='current_parameter_one'),
          models.CheckConstraint(condition=Q(product_id=PRODUCT),name='current_parameter_product'),
          models.CheckConstraint(condition=(Q(scope_kind='store',sku='') | (Q(scope_kind='sku') & ~Q(sku=''))),name='current_parameter_scope'),
          models.CheckConstraint(condition=(Q(state='VALUE',value__isnull=False) | Q(state='INHERIT',value__isnull=True,origin='',collected_at__isnull=True,calculated_at__isnull=True,requested_period__isnull=True,actual_period__isnull=True,evidence={})),name='current_parameter_state'),
          models.CheckConstraint(condition=(Q(state='INHERIT') | Q(origin='manual',collected_at__isnull=True,calculated_at__isnull=True,requested_period__isnull=True,actual_period__isnull=True,evidence={}) | Q(origin='calculated',collected_at__isnull=False,calculated_at__isnull=False,requested_period__isnull=False,actual_period__isnull=False)),name='current_parameter_origin'),
        ]
