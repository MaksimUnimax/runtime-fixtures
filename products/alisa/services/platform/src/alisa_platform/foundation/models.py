import uuid
from datetime import timedelta
from django.db import models
from django.utils import timezone

def expiry():
    return timezone.now() + timedelta(hours=24)

class FoundationProbe(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=32, default="foundation-v1")
    correlation_id = models.UUIDField(default=uuid.uuid4)
    state = models.CharField(max_length=16, default="ACCEPTED")
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(default=expiry, db_index=True)
    processed_at = models.DateTimeField(null=True)
    accepted_release = models.CharField(max_length=96)
    processed_release = models.CharField(max_length=96, blank=True)
    effect_count = models.PositiveSmallIntegerField(default=0)

    class Meta:
        constraints = [models.CheckConstraint(condition=models.Q(effect_count__lte=1), name="probe_at_most_one_effect")]

class FoundationJob(models.Model):
    probe = models.OneToOneField(FoundationProbe, primary_key=True, on_delete=models.CASCADE)
    done = models.BooleanField(default=False)
