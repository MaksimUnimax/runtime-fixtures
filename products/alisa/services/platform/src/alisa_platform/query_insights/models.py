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


def demand_policy_defaults():
    from .demand_rules import DEFAULT_POLICY
    return dict(DEFAULT_POLICY)


class DemandPolicy(models.Model):
    id=models.PositiveSmallIntegerField(primary_key=True,default=1,editable=False)
    revision=models.PositiveIntegerField(default=1)
    configuration=models.JSONField(default=demand_policy_defaults)
    updated_at=models.DateTimeField(auto_now=True)


class DemandCluster(models.Model):
    id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False)
    fingerprint=models.CharField(max_length=64,unique=True)
    profile=models.JSONField()
    example=models.CharField(max_length=1000)
    revision=models.PositiveIntegerField(default=1)
    merged_into=models.ForeignKey('self',null=True,on_delete=models.PROTECT,related_name='merged_sources')
    updated_at=models.DateTimeField(auto_now=True)


class DemandContribution(models.Model):
    episode=models.OneToOneField(Episode,primary_key=True,on_delete=models.CASCADE)
    cluster=models.ForeignKey(DemandCluster,on_delete=models.PROTECT,related_name='contributions')
    origin=models.ForeignKey(DemandCluster,on_delete=models.PROTECT,related_name='original_contributions')
    home=models.ForeignKey(DemandCluster,on_delete=models.PROTECT,related_name='canonical_contributions')
    source_revision=models.PositiveIntegerField()
    tenant_pseudonym=models.CharField(max_length=64)
    occurred_at=models.DateTimeField(db_index=True)
    paid_at_event=models.BooleanField(default=False)
    internal_test=models.BooleanField(default=False)
    eligible=models.BooleanField(default=False)
    manual_assignment=models.BooleanField(default=False)
    class Meta:
        indexes=[models.Index(fields=['cluster','occurred_at'],name='demand_cluster_time')]


class DemandReceipt(models.Model):
    episode=models.OneToOneField(Episode,primary_key=True,on_delete=models.CASCADE)
    source_received_at=models.DateTimeField()


class DemandCandidate(models.Model):
    id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False)
    cluster=models.OneToOneField(DemandCluster,on_delete=models.PROTECT,related_name='candidate')
    state=models.CharField(max_length=32,default='CANDIDATE')
    priority=models.CharField(max_length=16,default='NORMAL')
    assignee_id=models.UUIDField(null=True)
    revision=models.PositiveIntegerField(default=1)
    policy_revision=models.PositiveIntegerField()
    evidence=models.JSONField()
    created_at=models.DateTimeField(auto_now_add=True)
    updated_at=models.DateTimeField(auto_now=True)


class DemandDecision(models.Model):
    id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False)
    cluster=models.ForeignKey(DemandCluster,null=True,on_delete=models.PROTECT,related_name='decisions')
    actor_id=models.UUIDField(null=True)
    action=models.CharField(max_length=32)
    facts=models.JSONField(default=dict)
    created_at=models.DateTimeField(auto_now_add=True)
