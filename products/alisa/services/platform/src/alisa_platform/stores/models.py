import uuid
from django.db import models

PRODUCT = 'alisa_market'


def native_reference():
    return 'platform-' + uuid.uuid4().hex


class Store(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product_id = models.CharField(max_length=40, default=PRODUCT)
    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.PROTECT)
    provider = models.CharField(max_length=8, choices=[('OZON', 'OZON'), ('WB', 'WB')])
    name = models.CharField(max_length=80)
    voice_alias = models.CharField(max_length=80, blank=True, default='')
    status = models.CharField(max_length=16, default='ACTIVE')
    revision = models.PositiveIntegerField(default=1)
    verified_identity = models.CharField(max_length=160, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['tenant', 'id'], name='stores_tenant_id_unique'),
            models.UniqueConstraint(fields=['product_id', 'tenant', 'provider', 'verified_identity'], name='stores_verified_identity_once'),
            models.CheckConstraint(condition=models.Q(product_id=PRODUCT), name='stores_alisa_product'),
            models.CheckConstraint(condition=models.Q(status__in=['ACTIVE', 'DISABLED', 'DELETED']), name='stores_valid_state'),
        ]


class VaultSecret(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product_id = models.CharField(max_length=40, default=PRODUCT)
    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.PROTECT)
    store = models.ForeignKey(Store, on_delete=models.PROTECT)
    kind = models.CharField(max_length=16)
    revision = models.PositiveIntegerField()
    key_version = models.CharField(max_length=16)
    ciphertext = models.TextField()

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(product_id=PRODUCT), name='vault_alisa_product'),
            models.UniqueConstraint(fields=['id', 'tenant', 'store', 'kind', 'revision'], name='vault_secret_context_unique'),
        ]


class CredentialRevision(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product_id = models.CharField(max_length=40, default=PRODUCT)
    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.PROTECT)
    store = models.ForeignKey(Store, on_delete=models.PROTECT)
    kind = models.CharField(max_length=16)
    revision = models.PositiveIntegerField()
    secret = models.OneToOneField(VaultSecret, on_delete=models.PROTECT)
    status = models.CharField(max_length=16, default='PENDING')
    check_code = models.CharField(max_length=40, default='NOT_CHECKED')
    checked_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['store', 'kind', 'revision'], name='stores_credential_revision_once'),
            models.UniqueConstraint(fields=['id', 'tenant', 'store'], name='stores_credential_context_unique'),
            models.CheckConstraint(condition=models.Q(product_id=PRODUCT), name='credential_alisa_product'),
            models.CheckConstraint(condition=models.Q(status__in=['PENDING', 'ACTIVE', 'REVOKED']), name='credential_valid_state'),
        ]


class StoreCommand(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    request_id = models.UUIDField()
    product_id = models.CharField(max_length=40, default=PRODUCT)
    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.PROTECT)
    customer = models.ForeignKey('accounts.Customer', on_delete=models.PROTECT)
    fingerprint = models.CharField(max_length=64)
    action = models.CharField(max_length=24)
    state = models.CharField(max_length=16, default='DONE')
    result = models.JSONField(default=dict)
    http_status = models.PositiveSmallIntegerField(default=200)
    store = models.ForeignKey(Store, on_delete=models.PROTECT, null=True)
    credential = models.ForeignKey(CredentialRevision, on_delete=models.PROTECT, null=True)
    store_revision = models.PositiveIntegerField(null=True)
    security_revision = models.PositiveIntegerField()
    deadline = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['product_id', 'tenant', 'customer', 'request_id'], name='stores_customer_command_once'),
            models.CheckConstraint(condition=models.Q(product_id=PRODUCT), name='store_command_alisa_product'),
        ]


class StoreAudit(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product_id = models.CharField(max_length=40, default=PRODUCT)
    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.PROTECT)
    customer = models.ForeignKey('accounts.Customer', on_delete=models.PROTECT)
    store = models.ForeignKey(Store, on_delete=models.PROTECT)
    action = models.CharField(max_length=24)
    outcome = models.CharField(max_length=40)
    revision = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.CheckConstraint(condition=models.Q(product_id=PRODUCT), name='store_audit_alisa_product')]


class RuntimeTenantBinding(models.Model):
    tenant = models.OneToOneField('accounts.Tenant', primary_key=True, on_delete=models.CASCADE)
    native_tenant = models.CharField(max_length=128, default=native_reference)


class RuntimeStoreBinding(models.Model):
    store = models.OneToOneField(Store, primary_key=True, on_delete=models.CASCADE)
    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.CASCADE)
    native_id = models.CharField(max_length=160, default=native_reference)
    native_identity = models.CharField(max_length=160, default=native_reference)
    verified_identity = models.CharField(max_length=160)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['tenant', 'native_id'], name='stores_runtime_native_once')]
