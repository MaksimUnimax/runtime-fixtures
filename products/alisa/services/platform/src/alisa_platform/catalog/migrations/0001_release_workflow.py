import uuid
from django.db import migrations,models
import django.db.models.deletion


class Migration(migrations.Migration):
 initial=True
 dependencies=[('query_insights','0002_demand_queue')]
 operations=[
  migrations.CreateModel(name='CatalogDraft',fields=[
   ('id',models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False,serialize=False)),
   ('author_id',models.UUIDField()),('revision',models.PositiveIntegerField(default=1)),
   ('package',models.JSONField()),('updated_at',models.DateTimeField(auto_now=True)),
   ('created_at',models.DateTimeField(auto_now_add=True)),
   ('candidate',models.ForeignKey(on_delete=django.db.models.deletion.PROTECT,to='query_insights.demandcandidate'))]),
  migrations.CreateModel(name='CatalogValidation',fields=[
   ('id',models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False,serialize=False)),
   ('draft_revision',models.PositiveIntegerField()),('package_sha256',models.CharField(max_length=64)),
   ('template_hash',models.CharField(max_length=64)),('engine_sha256',models.CharField(max_length=64)),
   ('evidence',models.JSONField()),('created_at',models.DateTimeField(auto_now_add=True)),
   ('draft',models.ForeignKey(on_delete=django.db.models.deletion.PROTECT,related_name='validations',to='catalog.catalogdraft'))]),
  migrations.CreateModel(name='CatalogRelease',fields=[
   ('package_sha256',models.CharField(primary_key=True,editable=False,max_length=64,serialize=False)),
   ('author_id',models.UUIDField()),('approver_id',models.UUIDField()),
   ('package',models.JSONField()),('manifest',models.JSONField()),('created_at',models.DateTimeField(auto_now_add=True)),
   ('validation',models.OneToOneField(on_delete=django.db.models.deletion.PROTECT,to='catalog.catalogvalidation'))]),
  migrations.CreateModel(name='CatalogAssignment',fields=[
   ('tenant_id',models.UUIDField(primary_key=True,editable=False,serialize=False)),
   ('revision',models.PositiveIntegerField(default=0)),('applied_revision',models.PositiveIntegerField(default=0)),
   ('observed_package_sha256',models.CharField(max_length=64,blank=True)),
   ('observed_template_hash',models.CharField(max_length=64,blank=True)),
   ('state',models.CharField(max_length=16,default='BASELINE')),('updated_at',models.DateTimeField(auto_now=True)),
   ('release',models.ForeignKey(on_delete=django.db.models.deletion.PROTECT,null=True,to='catalog.catalogrelease'))]),
  migrations.CreateModel(name='CatalogPublication',fields=[
   ('id',models.UUIDField(primary_key=True,editable=False,serialize=False)),
   ('actor_id',models.UUIDField()),('tenant_id',models.UUIDField()),
   ('fingerprint',models.CharField(max_length=64)),('revision',models.PositiveIntegerField()),
   ('expected_revision',models.PositiveIntegerField()),('package_sha256',models.CharField(max_length=64,blank=True)),
   ('engine_sha256',models.CharField(max_length=64)),('template_hash',models.CharField(max_length=64)),
   ('runtime_tenant',models.CharField(max_length=256)),('binding_sha256',models.CharField(max_length=64)),
   ('qualification_sha256',models.CharField(max_length=64)),('outcome',models.JSONField(default=dict)),
   ('created_at',models.DateTimeField(auto_now_add=True))]),
  migrations.CreateModel(name='CatalogDecision',fields=[
   ('id',models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False,serialize=False)),
   ('actor_id',models.UUIDField(null=True)),('action',models.CharField(max_length=32)),
   ('object_id',models.CharField(max_length=64)),('facts',models.JSONField(default=dict)),
   ('created_at',models.DateTimeField(auto_now_add=True))]),
  migrations.RunSQL('''
   CREATE FUNCTION alisa_catalog_release_immutable_row() RETURNS trigger
   LANGUAGE plpgsql AS $$ BEGIN
    RAISE EXCEPTION 'catalog evidence is immutable' USING ERRCODE='23000';
   END $$;
   CREATE TRIGGER catalog_validation_immutable BEFORE UPDATE OR DELETE ON catalog_catalogvalidation
    FOR EACH ROW EXECUTE FUNCTION alisa_catalog_release_immutable_row();
   CREATE TRIGGER catalog_release_immutable BEFORE UPDATE OR DELETE ON catalog_catalogrelease
    FOR EACH ROW EXECUTE FUNCTION alisa_catalog_release_immutable_row();
   CREATE TRIGGER catalog_decision_immutable BEFORE UPDATE OR DELETE ON catalog_catalogdecision
    FOR EACH ROW EXECUTE FUNCTION alisa_catalog_release_immutable_row();
   ''',reverse_sql='''
   DROP TRIGGER catalog_decision_immutable ON catalog_catalogdecision;
   DROP TRIGGER catalog_release_immutable ON catalog_catalogrelease;
   DROP TRIGGER catalog_validation_immutable ON catalog_catalogvalidation;
   DROP FUNCTION alisa_catalog_release_immutable_row();
   ''')
 ]
