import uuid
from django.db import models

class Customer(models.Model):
    id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False)
    email=models.EmailField(max_length=254)
    display_name=models.CharField(max_length=80,default='',blank=True)
    is_active=models.BooleanField(default=True)
    security_revision=models.PositiveIntegerField(default=1)
    created_at=models.DateTimeField(auto_now_add=True)

class Tenant(models.Model):
    id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False)
    created_at=models.DateTimeField(auto_now_add=True)

class Membership(models.Model):
    customer=models.OneToOneField(Customer,on_delete=models.CASCADE)
    tenant=models.ForeignKey(Tenant,on_delete=models.CASCADE)
    role=models.CharField(max_length=24,default='OWNER_CLIENT')

class IdentityLink(models.Model):
    customer=models.ForeignKey(Customer,on_delete=models.CASCADE)
    issuer=models.CharField(max_length=256)
    client_id=models.CharField(max_length=100)
    subject=models.CharField(max_length=256)
    class Meta:
        constraints=[models.UniqueConstraint(fields=['issuer','client_id','subject'],name='product_oidc_subject_once')]

class AuthFlow(models.Model):
    id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False)
    secret_hash=models.CharField(max_length=64,unique=True)
    encrypted_payload=models.TextField()
    handoff_id=models.UUIDField(null=True)
    created_at=models.DateTimeField(auto_now_add=True)
    expires_at=models.DateTimeField()
    consumed_at=models.DateTimeField(null=True)
    completed_at=models.DateTimeField(null=True)

class WebSession(models.Model):
    id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False)
    token_hash=models.CharField(max_length=64,unique=True)
    customer=models.ForeignKey(Customer,on_delete=models.CASCADE)
    tenant=models.ForeignKey(Tenant,on_delete=models.CASCADE)
    flow=models.OneToOneField(AuthFlow,on_delete=models.CASCADE)
    encrypted_payload=models.TextField()
    security_revision=models.PositiveIntegerField()
    created_at=models.DateTimeField(auto_now_add=True)
    expires_at=models.DateTimeField()
    revoked_at=models.DateTimeField(null=True)

class ConsentRecord(models.Model):
    customer=models.ForeignKey(Customer,on_delete=models.CASCADE)
    document=models.CharField(max_length=24)
    version=models.CharField(max_length=40)
    accepted_at=models.DateTimeField(auto_now_add=True)
    class Meta:
        constraints=[models.UniqueConstraint(fields=['customer','document','version'],name='customer_consent_once')]

class LeadLink(models.Model):
    lead=models.OneToOneField('leads.Lead',on_delete=models.CASCADE)
    customer=models.ForeignKey(Customer,on_delete=models.CASCADE)
    linked_at=models.DateTimeField(auto_now_add=True)
