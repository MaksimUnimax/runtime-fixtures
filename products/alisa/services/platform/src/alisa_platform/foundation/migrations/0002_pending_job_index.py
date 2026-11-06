"""Expand-only queue index: old and new code use the same rows and columns."""
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('foundation', '0001_initial')]
    operations = [migrations.AddIndex(
        model_name='foundationjob',
        index=models.Index(fields=['probe'], condition=models.Q(done=False), name='foundation_pending_job_idx'),
    )]
