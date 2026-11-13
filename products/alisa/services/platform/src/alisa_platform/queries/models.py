import uuid
from django.db import models


class Query(models.Model):
    id = models.UUIDField(primary_key=True, editable=False)
    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.CASCADE)
    customer = models.ForeignKey('accounts.Customer', on_delete=models.CASCADE)
    store_ids = models.JSONField()
    input_hash = models.CharField(max_length=64)
    trace_id = models.UUIDField(default=uuid.uuid4, editable=False)
    runtime_job_ref = models.UUIDField(null=True)
    state = models.CharField(max_length=16, default='UNKNOWN')
    attempt = models.UUIDField(null=True)
    lease_until = models.DateTimeField(null=True)
    channel = models.CharField(max_length=8)
    voice_session_hash = models.CharField(max_length=64, default='')
    created_at = models.DateTimeField()
    expires_at = models.DateTimeField(db_index=True)
    checked_at = models.DateTimeField(null=True)
    continuation = models.JSONField(default=dict, db_default={})

    class Meta:
        indexes = [models.Index(fields=['customer', '-created_at'], name='query_customer_created')]


class VoiceDialogue(models.Model):
    """Encrypted pending turn plus bounded replay/dispatch metadata; no queue."""
    id = models.CharField(primary_key=True, max_length=64)
    session_hash = models.CharField(max_length=64, db_index=True)
    customer = models.ForeignKey('accounts.Customer', on_delete=models.CASCADE)
    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.CASCADE)
    last_message_id = models.PositiveIntegerField()
    input_hash = models.CharField(max_length=64)
    encrypted_payload = models.TextField(blank=True)
    phase = models.CharField(max_length=12, default='CHOOSE')
    query_id = models.UUIDField(null=True)
    cancel_id = models.UUIDField(null=True)
    cancel_started = models.BooleanField(default=False)
    expires_at = models.DateTimeField(db_index=True)
    retire_at = models.DateTimeField(db_index=True)


class VoiceStorePreference(models.Model):
    """An owner setting, never a cached permission or a report retention row."""
    customer = models.OneToOneField('accounts.Customer', primary_key=True, on_delete=models.CASCADE)
    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.CASCADE)
    store = models.ForeignKey('stores.Store', on_delete=models.CASCADE)
    updated_at = models.DateTimeField(auto_now=True)
