from django.core.management.base import BaseCommand
from django.utils import timezone
from alisa_platform.queries.models import Query, VoiceDialogue


class Command(BaseCommand):
    help = 'Delete expired query receipts; never read or recompute reports.'

    def handle(self, *args, **options):
        now = timezone.now()
        # A delayed timer cannot extend usable state: voice checks expires_at too.
        VoiceDialogue.objects.filter(expires_at__lte=now).exclude(encrypted_payload='').update(encrypted_payload='')
        VoiceDialogue.objects.filter(retire_at__lte=now).delete()
        count, _ = Query.objects.filter(expires_at__lte=now).delete()
        self.stdout.write(str(count))
