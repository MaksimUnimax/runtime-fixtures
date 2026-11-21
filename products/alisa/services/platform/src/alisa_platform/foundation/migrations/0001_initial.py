import alisa_platform.foundation.models
import django.db.models.deletion
import django.utils.timezone
import uuid
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
    ]

    operations = [
        migrations.CreateModel(
            name='FoundationProbe',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('kind', models.CharField(default='foundation-v1', max_length=32)),
                ('correlation_id', models.UUIDField(default=uuid.uuid4)),
                ('state', models.CharField(default='ACCEPTED', max_length=16)),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('expires_at', models.DateTimeField(db_index=True, default=alisa_platform.foundation.models.expiry)),
                ('processed_at', models.DateTimeField(null=True)),
                ('accepted_release', models.CharField(max_length=96)),
                ('processed_release', models.CharField(blank=True, max_length=96)),
                ('effect_count', models.PositiveSmallIntegerField(default=0)),
            ],
        ),
        migrations.CreateModel(
            name='FoundationJob',
            fields=[
                ('probe', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, primary_key=True, serialize=False, to='foundation.foundationprobe')),
                ('done', models.BooleanField(default=False)),
            ],
        ),
        migrations.AddConstraint(
            model_name='foundationprobe',
            constraint=models.CheckConstraint(condition=models.Q(('effect_count__lte', 1)), name='probe_at_most_one_effect'),
        ),
    ]
