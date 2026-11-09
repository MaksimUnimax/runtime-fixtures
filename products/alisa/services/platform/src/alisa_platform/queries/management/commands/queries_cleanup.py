from django.core.management.base import BaseCommand
from django.utils import timezone
from alisa_platform.queries.models import Query


class Command(BaseCommand):
    help = 'Delete expired query receipts; never read or recompute reports.'

    def handle(self, *args, **options):
        count, _ = Query.objects.filter(expires_at__lte=timezone.now()).delete()
        self.stdout.write(str(count))
