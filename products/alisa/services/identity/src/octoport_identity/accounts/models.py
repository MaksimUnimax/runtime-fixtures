import uuid
from django.contrib.auth.models import AbstractUser
from django.db import models

class Person(AbstractUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # No email-based merge. OIDC protocol and verified contacts arrive in AL-S02.
