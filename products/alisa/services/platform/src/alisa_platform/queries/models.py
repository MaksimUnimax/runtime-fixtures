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

    class Meta:
        indexes = [models.Index(fields=['customer', '-created_at'], name='query_customer_created')]


class VoiceDialogue(models.Model):
    """One encrypted pending question per owner/skill/session; never a job queue."""
    id = models.CharField(primary_key=True, max_length=64)
    customer = models.ForeignKey('accounts.Customer', on_delete=models.CASCADE)
    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.CASCADE)
    last_message_id = models.PositiveIntegerField()
    input_hash = models.CharField(max_length=64)
    encrypted_payload = models.TextField(blank=True)
    phase = models.CharField(max_length=12, default='CHOOSE')
    query_id = models.UUIDField(null=True)
    cancel_id = models.UUIDField(null=True)
    expires_at = models.DateTimeField(db_index=True)
    retire_at = models.DateTimeField(db_index=True)
