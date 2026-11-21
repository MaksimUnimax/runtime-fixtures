import django.db.models.deletion
import uuid
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
    ]

    operations = [
        migrations.CreateModel(
            name='Lead',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('email', models.EmailField(max_length=254, unique=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('expires_at', models.DateTimeField()),
                ('confirmed_at', models.DateTimeField(null=True)),
                ('token_hash', models.CharField(max_length=64)),
                ('token_expires_at', models.DateTimeField()),
                ('failed_attempts', models.PositiveSmallIntegerField(default=0)),
                ('consent_version', models.CharField(default='s01-synthetic-1', max_length=32)),
                ('marketing_consent', models.BooleanField(default=False)),
            ],
        ),
        migrations.CreateModel(
            name='RateBucket',
            fields=[
                ('key', models.CharField(max_length=80, primary_key=True, serialize=False)),
                ('count', models.PositiveIntegerField(default=0)),
                ('expires_at', models.DateTimeField()),
            ],
        ),
        migrations.CreateModel(
            name='MailOutbox',
            fields=[
                ('lead', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, primary_key=True, serialize=False, to='leads.lead')),
                ('body', models.TextField()),
                ('sent_at', models.DateTimeField(null=True)),
                ('attempts', models.PositiveSmallIntegerField(default=0)),
            ],
        ),
        migrations.CreateModel(
            name='Submission',
            fields=[
                ('id', models.UUIDField(primary_key=True, serialize=False)),
                ('contact_digest', models.CharField(max_length=64)),
                ('lead', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='leads.lead')),
            ],
        ),
    ]
