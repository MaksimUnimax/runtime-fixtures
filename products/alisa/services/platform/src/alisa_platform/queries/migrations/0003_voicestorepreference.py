import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('queries', '0002_voicedialogue'), ('stores', '0001_initial')]
    operations = [migrations.CreateModel(name='VoiceStorePreference', fields=[
        ('customer', models.OneToOneField(primary_key=True, serialize=False,
            on_delete=django.db.models.deletion.CASCADE, to='accounts.customer')),
        ('tenant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='accounts.tenant')),
        ('store', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='stores.store')),
        ('updated_at', models.DateTimeField(auto_now=True)),
    ])]
