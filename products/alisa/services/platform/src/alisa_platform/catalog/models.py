"""Product release decisions. No customer report data or credentials."""
import uuid
from django.db import models


class ImmutableQuerySet(models.QuerySet):
 def update(self,**kwargs):raise TypeError('Catalog evidence is immutable')
 def delete(self):raise TypeError('Catalog evidence is immutable')
 def bulk_update(self,*args,**kwargs):raise TypeError('Catalog evidence is immutable')


class ImmutableModel(models.Model):
 objects=ImmutableQuerySet.as_manager()
 class Meta:abstract=True
 def save(self,*args,**kwargs):
  if not self._state.adding:raise TypeError('Catalog evidence is immutable')
  if kwargs.get('force_update')or kwargs.get('update_fields'):raise TypeError('Catalog evidence is immutable')
  kwargs['force_insert']=True
  return super().save(*args,**kwargs)
 def delete(self,*args,**kwargs):raise TypeError('Catalog evidence is immutable')


class CatalogDraft(models.Model):
 id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False)
 candidate=models.ForeignKey('query_insights.DemandCandidate',on_delete=models.PROTECT)
 author_id=models.UUIDField()
 revision=models.PositiveIntegerField(default=1)
 package=models.JSONField()
 updated_at=models.DateTimeField(auto_now=True)
 created_at=models.DateTimeField(auto_now_add=True)


class CatalogValidation(ImmutableModel):
 id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False)
 draft=models.ForeignKey(CatalogDraft,on_delete=models.PROTECT,related_name='validations')
 draft_revision=models.PositiveIntegerField()
 package_sha256=models.CharField(max_length=64)
 template_hash=models.CharField(max_length=64)
 engine_sha256=models.CharField(max_length=64)
 evidence=models.JSONField()
 created_at=models.DateTimeField(auto_now_add=True)


class CatalogRelease(ImmutableModel):
 # Hash of canonical data payload; approval never mutates that payload.
 package_sha256=models.CharField(max_length=64,primary_key=True,editable=False)
 validation=models.OneToOneField(CatalogValidation,on_delete=models.PROTECT)
 author_id=models.UUIDField()
 approver_id=models.UUIDField()
 package=models.JSONField()
 manifest=models.JSONField()
 created_at=models.DateTimeField(auto_now_add=True)


class CatalogAssignment(models.Model):
 # Audit metadata must not add a reverse FK to the existing account-cleanup ORM.
 tenant_id=models.UUIDField(primary_key=True,editable=False)
 release=models.ForeignKey(CatalogRelease,on_delete=models.PROTECT,null=True)
 revision=models.PositiveIntegerField(default=0)
 applied_revision=models.PositiveIntegerField(default=0)
 observed_package_sha256=models.CharField(max_length=64,blank=True)
 observed_template_hash=models.CharField(max_length=64,blank=True)
 state=models.CharField(max_length=16,default='BASELINE')
 updated_at=models.DateTimeField(auto_now=True)


class CatalogPublication(models.Model):
 id=models.UUIDField(primary_key=True,editable=False)
 actor_id=models.UUIDField()
 tenant_id=models.UUIDField()
 fingerprint=models.CharField(max_length=64)
 revision=models.PositiveIntegerField()
 expected_revision=models.PositiveIntegerField()
 package_sha256=models.CharField(max_length=64,blank=True)
 engine_sha256=models.CharField(max_length=64)
 template_hash=models.CharField(max_length=64)
 runtime_tenant=models.CharField(max_length=256)
 binding_sha256=models.CharField(max_length=64)
 qualification_sha256=models.CharField(max_length=64)
 outcome=models.JSONField(default=dict)
 created_at=models.DateTimeField(auto_now_add=True)


class CatalogDecision(ImmutableModel):
 id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False)
 actor_id=models.UUIDField(null=True)
 action=models.CharField(max_length=32)
 object_id=models.CharField(max_length=64)
 facts=models.JSONField(default=dict)
 created_at=models.DateTimeField(auto_now_add=True)
