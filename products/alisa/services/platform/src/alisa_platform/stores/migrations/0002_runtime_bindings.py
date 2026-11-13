import alisa_platform.stores.models
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('stores', '0001_initial')]
    operations = [
        migrations.CreateModel(name='RuntimeTenantBinding', fields=[
            ('tenant', models.OneToOneField(primary_key=True, serialize=False,
                on_delete=django.db.models.deletion.CASCADE, to='accounts.tenant')),
            ('native_tenant', models.CharField(max_length=128,
                default=alisa_platform.stores.models.native_reference)),
        ]),
        migrations.CreateModel(name='RuntimeStoreBinding', fields=[
            ('store', models.OneToOneField(primary_key=True, serialize=False,
                on_delete=django.db.models.deletion.CASCADE, to='stores.store')),
            ('tenant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='accounts.tenant')),
            ('native_id', models.CharField(max_length=160, default=alisa_platform.stores.models.native_reference)),
            ('native_identity', models.CharField(max_length=160, default=alisa_platform.stores.models.native_reference)),
            ('verified_identity', models.CharField(max_length=160)),
        ], options={'constraints': [models.UniqueConstraint(fields=['tenant', 'native_id'], name='stores_runtime_native_once')]}),
    ]
