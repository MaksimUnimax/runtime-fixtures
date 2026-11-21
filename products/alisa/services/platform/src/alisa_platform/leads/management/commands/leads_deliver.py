import smtplib
from django.conf import settings
from django.core.mail import send_mail
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from alisa_platform.leads.models import MailOutbox, Lead, RateBucket
from alisa_platform.leads.views import enabled

class Command(BaseCommand):
    help = 'Finite delivery of at most 20 private synthetic confirmation messages; no contacts/tokens are logged.'
    def handle(self, *args, **options):
        if not enabled(): raise CommandError('Test lead intake is not enabled')
        now = timezone.now()
        Lead.objects.filter(expires_at__lte=now).delete()
        RateBucket.objects.filter(expires_at__lte=now).delete()
        MailOutbox.objects.filter(lead__token_expires_at__lte=now, sent_at__isnull=True).update(body='')
        sent = 0
        for _ in range(20):
            with transaction.atomic():
                row = MailOutbox.objects.select_for_update(skip_locked=True).filter(sent_at__isnull=True, attempts__lt=3, lead__token_expires_at__gt=now).order_by('lead__created_at').first()
                if not row: break
                row.attempts += 1
                try:
                    accepted = send_mail('Подтвердите тестовую заявку Алисы', row.body, settings.DEFAULT_FROM_EMAIL, [row.lead.email], fail_silently=False)
                    if accepted != 1: raise OSError('SMTP not accepted')
                except (OSError, smtplib.SMTPException):
                    row.save(update_fields=['attempts'])
                    self.stdout.write('MAIL_TEMPORARILY_UNAVAILABLE'); break
                row.sent_at = timezone.now(); row.body = ''; row.save(update_fields=['sent_at', 'body', 'attempts']); sent += 1
        self.stdout.write('MAIL_BATCH_FINISHED sent='+str(sent))
