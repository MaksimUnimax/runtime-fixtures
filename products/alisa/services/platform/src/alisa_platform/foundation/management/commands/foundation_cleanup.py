from django.core.management.base import BaseCommand
from django.utils import timezone
from alisa_platform.foundation.models import FoundationProbe

class Command(BaseCommand):
    help = "Delete only expired technical probes, including when writes are disabled."
    def handle(self, *args, **options):
        deleted, _ = FoundationProbe.objects.filter(expires_at__lte=timezone.now()).delete()
        self.stdout.write(f"Expired technical rows deleted: {deleted}")
