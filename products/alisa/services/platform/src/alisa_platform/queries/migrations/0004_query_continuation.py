from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('queries', '0003_voicestorepreference')]
    operations = [migrations.AddField(model_name='query', name='continuation',
                                     field=models.JSONField(default=dict, db_default={}))]
