import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('queries', '0001_initial')]
    operations = [migrations.CreateModel(name='VoiceDialogue', fields=[
        ('id', models.CharField(primary_key=True, max_length=64, serialize=False)),
        ('last_message_id', models.PositiveIntegerField()),
        ('input_hash', models.CharField(max_length=64)),
        ('encrypted_payload', models.TextField(blank=True)),
        ('phase', models.CharField(max_length=12, default='CHOOSE')),
        ('query_id', models.UUIDField(null=True)),
        ('cancel_id', models.UUIDField(null=True)),
        ('expires_at', models.DateTimeField(db_index=True)),
        ('retire_at', models.DateTimeField(db_index=True)),
        ('customer', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='accounts.customer')),
        ('tenant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='accounts.tenant')),
    ])]
