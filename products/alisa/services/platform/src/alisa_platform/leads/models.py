import uuid
from django.db import models

class Lead(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True, max_length=254)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    confirmed_at = models.DateTimeField(null=True)
    token_hash = models.CharField(max_length=64)
    token_expires_at = models.DateTimeField()
    failed_attempts = models.PositiveSmallIntegerField(default=0)
    consent_version = models.CharField(max_length=32, default='s01-synthetic-1')
    marketing_consent = models.BooleanField(default=False)

class MailOutbox(models.Model):
    lead = models.OneToOneField(Lead, on_delete=models.CASCADE, primary_key=True)
    # Private, short-lived mail payload; removed immediately after SMTP accepts it.
    body = models.TextField()
    sent_at = models.DateTimeField(null=True)
    attempts = models.PositiveSmallIntegerField(default=0)

class RateBucket(models.Model):
    key = models.CharField(max_length=80, primary_key=True)
    count = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField()

class Submission(models.Model):
    id = models.UUIDField(primary_key=True)
    lead = models.ForeignKey(Lead, on_delete=models.CASCADE)
    contact_digest = models.CharField(max_length=64)
