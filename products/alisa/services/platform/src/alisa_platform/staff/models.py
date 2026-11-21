import uuid
from django.db import models
from .policy import PRODUCT

class StaffMember(models.Model):
    id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False)
    product_id=models.CharField(max_length=40,default=PRODUCT)
    issuer=models.CharField(max_length=256)
    client_id=models.CharField(max_length=100)
    subject=models.CharField(max_length=256)
    name=models.CharField(max_length=80)
    role=models.CharField(max_length=16,choices=[('OWNER','OWNER'),('ADMIN','ADMIN')])
    permissions=models.JSONField(default=list)
    active=models.BooleanField(default=True)
    revision=models.PositiveIntegerField(default=1)
    created_at=models.DateTimeField(auto_now_add=True)
    class Meta:
        constraints=[models.UniqueConstraint(fields=['product_id','issuer','client_id','subject'],name='staff_product_identity_once')]

class StaffAuthFlow(models.Model):
    id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False)
    product_id=models.CharField(max_length=40,default=PRODUCT)
    secret_hash=models.CharField(max_length=64,unique=True)
    encrypted_payload=models.TextField()
    created_at=models.DateTimeField(auto_now_add=True)
    expires_at=models.DateTimeField()
    consumed_at=models.DateTimeField(null=True)

class StaffSession(models.Model):
    id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False)
    product_id=models.CharField(max_length=40,default=PRODUCT)
    token_hash=models.CharField(max_length=64,unique=True)
    member=models.ForeignKey(StaffMember,on_delete=models.PROTECT)
    flow=models.OneToOneField(StaffAuthFlow,on_delete=models.PROTECT)
    revision=models.PositiveIntegerField()
    mfa_verified_at=models.DateTimeField()
    mfa_type=models.CharField(max_length=24)
    encrypted_payload=models.TextField()
    created_at=models.DateTimeField(auto_now_add=True)
    expires_at=models.DateTimeField()
    revoked_at=models.DateTimeField(null=True)

class AppendOnlyQuerySet(models.QuerySet):
    def update(self,**kwargs):raise TypeError('Audit is append-only')
    def delete(self):raise TypeError('Audit is append-only')
    def bulk_update(self,*args,**kwargs):raise TypeError('Audit is append-only')

class StaffAuditEvent(models.Model):
    id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False)
    product_id=models.CharField(max_length=40,default=PRODUCT)
    actor_id=models.UUIDField(null=True)
    action=models.CharField(max_length=48)
    target_id=models.UUIDField(null=True)
    reason=models.CharField(max_length=40)
    outcome=models.CharField(max_length=24)
    before=models.JSONField(default=dict)
    after=models.JSONField(default=dict)
    created_at=models.DateTimeField(auto_now_add=True)
    objects=AppendOnlyQuerySet.as_manager()
    def save(self,*args,**kwargs):
        if not self._state.adding:raise TypeError('Audit is append-only')
        return super().save(*args,**kwargs)
    def delete(self,*args,**kwargs):raise TypeError('Audit is append-only')

class StaffCommandReceipt(models.Model):
    id=models.UUIDField(primary_key=True)
    product_id=models.CharField(max_length=40,default=PRODUCT)
    actor_id=models.UUIDField()
    fingerprint=models.CharField(max_length=64)
    result=models.JSONField()
    http_status=models.PositiveSmallIntegerField()
    created_at=models.DateTimeField(auto_now_add=True)
