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
