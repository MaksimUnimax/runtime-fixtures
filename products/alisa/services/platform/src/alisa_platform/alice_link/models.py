import uuid

from django.db import models


class AliceLink(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    customer = models.ForeignKey('accounts.Customer', on_delete=models.CASCADE)
    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.CASCADE)
    client_id = models.CharField(max_length=100)
    revision = models.PositiveIntegerField(default=1)
    security_revision = models.PositiveIntegerField()
    voice_private = models.BooleanField(default=True)
    authorized_at = models.DateTimeField(null=True)
    confirmed_at = models.DateTimeField(null=True)
    revoked_at = models.DateTimeField(null=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['customer', 'client_id'], name='alice_customer_client_once')]


class AuthorizationRequest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    secret_hash = models.CharField(max_length=64, unique=True)
    encrypted_payload = models.TextField()
    session = models.ForeignKey('accounts.WebSession', null=True, on_delete=models.CASCADE)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True)


class AuthorizationCode(models.Model):
    code_hash = models.CharField(max_length=64, primary_key=True)
    link = models.ForeignKey(AliceLink, on_delete=models.CASCADE)
    revision = models.PositiveIntegerField()
    redirect_uri = models.CharField(max_length=256)
    challenge = models.CharField(max_length=128, blank=True)
    challenge_method = models.CharField(max_length=8, blank=True)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True)


class TokenFamily(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    link = models.ForeignKey(AliceLink, on_delete=models.CASCADE)
    revision = models.PositiveIntegerField()
    access_hash = models.CharField(max_length=64, unique=True)
    refresh_hash = models.CharField(max_length=64, unique=True)
    access_expires_at = models.DateTimeField()
    refresh_expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True)
    encrypted_response = models.TextField(blank=True)
    retry_until = models.DateTimeField(null=True)
