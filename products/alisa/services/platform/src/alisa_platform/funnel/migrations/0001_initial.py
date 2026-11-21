import uuid
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
    ]

    operations = [
        migrations.CreateModel(
            name='FunnelEvent',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('event_type', models.CharField(max_length=32)),
                ('subject_id', models.UUIDField(null=True)),
                ('product_id', models.CharField(default='alisa_market', max_length=32)),
                ('environment', models.CharField(max_length=8)),
                ('release', models.CharField(max_length=80)),
                ('content_version', models.CharField(max_length=64)),
                ('occurred_at', models.DateTimeField(auto_now_add=True)),
                ('attribution', models.JSONField(default=dict)),
                ('basis', models.CharField(default='service', max_length=16)),
            ],
            options={
                'constraints': [models.UniqueConstraint(condition=models.Q(('subject_id__isnull', False)), fields=('event_type', 'subject_id'), name='funnel_subject_effect_once')],
            },
        ),
    ]
