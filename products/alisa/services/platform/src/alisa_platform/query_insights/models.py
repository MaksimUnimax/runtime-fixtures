import uuid
from django.db import models

class Episode(models.Model):
    id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False)
    tenant_pseudonym=models.CharField(max_length=64)
    logical_query_id=models.UUIDField()
    revision=models.PositiveIntegerField()
    revision_hash=models.CharField(max_length=64)
    producer=models.CharField(max_length=32)
    event=models.JSONField()
    reason=models.CharField(max_length=48,db_index=True)
    outcome=models.CharField(max_length=24,db_index=True)
    internal_test=models.BooleanField(default=False,db_index=True)
    occurred_at=models.DateTimeField(db_index=True)
    received_at=models.DateTimeField(auto_now=True)
    class Meta:
        constraints=[models.UniqueConstraint(fields=['tenant_pseudonym','logical_query_id'],name='gap_episode_once')]

class Inbox(models.Model):
    event_id=models.UUIDField(primary_key=True)
    payload_hash=models.CharField(max_length=64)
    received_at=models.DateTimeField(auto_now_add=True)

class Coverage(models.Model):
    stream_id=models.UUIDField(primary_key=True)
    kind=models.CharField(max_length=24,db_index=True)
    coverage_start=models.DateTimeField()
    dropped=models.PositiveBigIntegerField(default=0)
    pending_bytes=models.PositiveBigIntegerField(default=0)
    oldest_pending_at=models.DateTimeField(null=True)
    internal_test=models.BooleanField(default=False)
    seen_at=models.DateTimeField()

class Feedback(models.Model):
    query=models.OneToOneField('queries.Query',primary_key=True,on_delete=models.CASCADE)
    created_at=models.DateTimeField(auto_now_add=True)
    episode=models.OneToOneField(Episode,on_delete=models.CASCADE)
