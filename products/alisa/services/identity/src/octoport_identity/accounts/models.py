import uuid
from django.contrib.auth.models import AbstractUser
from django.db import models

class Person(AbstractUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # No email-based merge. OIDC protocol and verified contacts arrive in AL-S02.

class Subject(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    person = models.ForeignKey(Person, on_delete=models.CASCADE)
    client = models.ForeignKey('allauth_idp_oidc.Client', on_delete=models.CASCADE)
    class Meta:
        constraints = [models.UniqueConstraint(fields=['person','client'], name='identity_subject_per_client')]

class ProtocolCache(models.Model):
    cache_key = models.CharField(max_length=255, primary_key=True)
    value = models.TextField()
    expires = models.DateTimeField(db_index=True)
    class Meta:
        db_table = 'identity_protocol_cache'

class IdentityConsent(models.Model):
    person = models.ForeignKey(Person, on_delete=models.CASCADE)
    document = models.CharField(max_length=24)
    version = models.CharField(max_length=40)
    accepted_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        constraints = [models.UniqueConstraint(fields=['person','document','version'],name='identity_consent_once')]

class IdentityMail(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recipient = models.EmailField(max_length=254)
    encrypted_payload = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    sent_at = models.DateTimeField(null=True)
    lease_until = models.DateTimeField(null=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    error_code = models.CharField(max_length=32,default='',blank=True)
