from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('alice_link', '0001_initial')]
    operations = [
        migrations.AddField(model_name='alicelink', name='parameter_write_binding_revision',
                            field=models.PositiveIntegerField(default=0, db_default=0)),
        migrations.AddField(model_name='alicelink', name='parameter_write_consent_revision',
                            field=models.PositiveIntegerField(default=0, db_default=0)),
        migrations.AddField(model_name='alicelink', name='parameter_write_consented_at',
                            field=models.DateTimeField(null=True)),
    ]
