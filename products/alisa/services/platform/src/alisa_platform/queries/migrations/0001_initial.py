import uuid
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = [('accounts', '0001_initial')]
    operations = [migrations.CreateModel(name='Query', fields=[
        ('id', models.UUIDField(primary_key=True, editable=False, serialize=False)),
        ('store_ids', models.JSONField()), ('input_hash', models.CharField(max_length=64)),
        ('trace_id', models.UUIDField(default=uuid.uuid4, editable=False)),
        ('runtime_job_ref', models.UUIDField(null=True)),
        ('state', models.CharField(default='UNKNOWN', max_length=16)),
        ('attempt', models.UUIDField(null=True)), ('lease_until', models.DateTimeField(null=True)),
        ('channel', models.CharField(max_length=8)),
        ('voice_session_hash', models.CharField(default='', max_length=64)),
        ('created_at', models.DateTimeField()), ('expires_at', models.DateTimeField(db_index=True)),
        ('checked_at', models.DateTimeField(null=True)),
        ('customer', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='accounts.customer')),
        ('tenant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='accounts.tenant')),
    ], options={'indexes': [models.Index(fields=['customer', '-created_at'], name='query_customer_created')]})]
