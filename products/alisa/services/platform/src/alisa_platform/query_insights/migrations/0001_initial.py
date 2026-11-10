import uuid
from django.db import migrations,models
import django.db.models.deletion

class Migration(migrations.Migration):
    initial=True
    dependencies=[('queries','0001_initial')]
    operations=[
        migrations.CreateModel(name='Episode',fields=[
            ('id',models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False,serialize=False)),
            ('tenant_pseudonym',models.CharField(max_length=64)),('logical_query_id',models.UUIDField()),
            ('revision',models.PositiveIntegerField()),('revision_hash',models.CharField(max_length=64)),
            ('producer',models.CharField(max_length=32)),('event',models.JSONField()),
            ('reason',models.CharField(max_length=48,db_index=True)),('outcome',models.CharField(max_length=24,db_index=True)),
            ('internal_test',models.BooleanField(default=False,db_index=True)),('occurred_at',models.DateTimeField(db_index=True)),
            ('received_at',models.DateTimeField(auto_now=True))],
            options={'constraints':[models.UniqueConstraint(fields=['tenant_pseudonym','logical_query_id'],name='gap_episode_once')]}),
        migrations.CreateModel(name='Inbox',fields=[('event_id',models.UUIDField(primary_key=True,serialize=False)),
            ('payload_hash',models.CharField(max_length=64)),('received_at',models.DateTimeField(auto_now_add=True))]),
        migrations.CreateModel(name='Coverage',fields=[('stream_id',models.UUIDField(primary_key=True,serialize=False)),
            ('kind',models.CharField(max_length=24,db_index=True)),('coverage_start',models.DateTimeField()),
            ('dropped',models.PositiveBigIntegerField(default=0)),('pending_bytes',models.PositiveBigIntegerField(default=0)),
            ('oldest_pending_at',models.DateTimeField(null=True)),('internal_test',models.BooleanField(default=False)),('seen_at',models.DateTimeField())]),
        migrations.CreateModel(name='Feedback',fields=[
            ('query',models.OneToOneField(primary_key=True,on_delete=django.db.models.deletion.CASCADE,serialize=False,to='queries.query')),
            ('created_at',models.DateTimeField(auto_now_add=True)),
            ('episode',models.OneToOneField(on_delete=django.db.models.deletion.CASCADE,to='query_insights.episode'))])]
