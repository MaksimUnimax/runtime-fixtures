import uuid
from django.db import migrations, models
import django.db.models.deletion
import alisa_platform.query_insights.models


class Migration(migrations.Migration):
    dependencies = [('query_insights', '0001_initial')]
    operations = [
        migrations.CreateModel(name='DemandPolicy', fields=[
            ('id', models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False, serialize=False)),
            ('revision', models.PositiveIntegerField(default=1)),
            ('configuration', models.JSONField(default=alisa_platform.query_insights.models.demand_policy_defaults)),
            ('updated_at', models.DateTimeField(auto_now=True))]),
        migrations.CreateModel(name='DemandCluster', fields=[
            ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
            ('fingerprint', models.CharField(max_length=64, unique=True)),
            ('profile', models.JSONField()), ('example', models.CharField(max_length=1000)),
            ('revision', models.PositiveIntegerField(default=1)),
            ('updated_at', models.DateTimeField(auto_now=True)),
            ('merged_into', models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT,
                related_name='merged_sources', to='query_insights.demandcluster'))]),
        migrations.CreateModel(name='DemandContribution', fields=[
            ('episode', models.OneToOneField(primary_key=True, on_delete=django.db.models.deletion.CASCADE,
                serialize=False, to='query_insights.episode')),
            ('source_revision', models.PositiveIntegerField()),
            ('tenant_pseudonym', models.CharField(max_length=64)),
            ('occurred_at', models.DateTimeField(db_index=True)),
            ('paid_at_event', models.BooleanField(default=False)),
            ('internal_test', models.BooleanField(default=False)),
            ('eligible', models.BooleanField(default=False)),
            ('manual_assignment', models.BooleanField(default=False)),
            ('cluster', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT,
                related_name='contributions', to='query_insights.demandcluster')),
            ('home', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT,
                related_name='canonical_contributions', to='query_insights.demandcluster')),
            ('origin', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT,
                related_name='original_contributions', to='query_insights.demandcluster'))],
            options={'indexes': [models.Index(fields=['cluster', 'occurred_at'], name='demand_cluster_time')]}),
        migrations.CreateModel(name='DemandReceipt', fields=[
            ('episode', models.OneToOneField(primary_key=True, on_delete=django.db.models.deletion.CASCADE,
                serialize=False, to='query_insights.episode')),
            ('source_received_at', models.DateTimeField())]),
        migrations.CreateModel(name='DemandCandidate', fields=[
            ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
            ('state', models.CharField(max_length=32, default='CANDIDATE')),
            ('priority', models.CharField(max_length=16, default='NORMAL')),
            ('assignee_id', models.UUIDField(null=True)),
            ('revision', models.PositiveIntegerField(default=1)),
            ('policy_revision', models.PositiveIntegerField()), ('evidence', models.JSONField()),
            ('created_at', models.DateTimeField(auto_now_add=True)),
            ('updated_at', models.DateTimeField(auto_now=True)),
            ('cluster', models.OneToOneField(on_delete=django.db.models.deletion.PROTECT,
                related_name='candidate', to='query_insights.demandcluster'))]),
        migrations.CreateModel(name='DemandDecision', fields=[
            ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
            ('actor_id', models.UUIDField(null=True)), ('action', models.CharField(max_length=32)),
            ('facts', models.JSONField(default=dict)), ('created_at', models.DateTimeField(auto_now_add=True)),
            ('cluster', models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT,
                related_name='decisions', to='query_insights.demandcluster'))]),
    ]
