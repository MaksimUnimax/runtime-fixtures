"""Explicit finite synthetic outbox probe; never sends to a real recipient."""
import hashlib
import json
import os
from django.conf import settings
from django.core.mail import send_mail
from django.core.management.base import BaseCommand,CommandError
from django.db import connection
from django.utils import timezone
from alisa_platform.accounts.models import Membership
from alisa_platform.entitlements.models import PRODUCT,AccessNotification


class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument('--allow-private-sink',action='store_true',required=True)
        parser.add_argument('--limit',type=int,default=10)

    def handle(self, *args, **options):
        if (not settings.ENTITLEMENTS_ENABLED or settings.ALISA_ENV not in {'dev','stage'}
            or os.environ.get('ALISA_ACCESS_SINK_DELIVERY')!='1'
            or settings.EMAIL_HOST!='127.0.0.1'
            or settings.EMAIL_PORT!=(18226 if settings.ALISA_ENV=='dev' else 18225)
            or not 1<=options['limit']<=20):
            raise CommandError('Only explicitly admitted private synthetic delivery is available')
        key=int.from_bytes(hashlib.sha256((PRODUCT+':access-synthetic-mail').encode()).digest()[:8],'big',signed=True)
        with connection.cursor() as cursor:
            cursor.execute('SELECT pg_try_advisory_lock(%s)',[key]);locked=cursor.fetchone()[0]
        if not locked:raise CommandError('Own access mail delivery is already active')
        sent,failed=0,0
        try:
            rows=AccessNotification.objects.select_related('grant','customer').filter(product_id=PRODUCT,
                email_sent_at__isnull=True,customer__email__iendswith='@example.invalid',
                grant__product_id=PRODUCT,grant__source__in=['GIFT','COMPENSATION']).order_by('created_at')[:options['limit']]
            for row in rows:
                if not Membership.objects.filter(customer=row.customer,tenant_id=row.grant.tenant_id).exists():
                    failed+=1;continue
                text=('Вам предоставлен период доступа к Алисе.' if row.kind=='GRANTED'
                      else 'Оставшаяся часть выбранного периода доступа к Алисе отозвана.')
                try:
                    # Autocommit, bounded SMTP to a pinned private sink. No DB
                    # transaction spans network delivery. Ack loss may repeat a
                    # notification, never a grant or financial operation.
                    result=send_mail('Доступ к Алисе',text+'\nhttps://alisa.octoport.ru/app/access',
                        settings.DEFAULT_FROM_EMAIL,[row.customer.email],fail_silently=False)
                    if result!=1:raise RuntimeError('Sink did not acknowledge')
                    row.email_sent_at=timezone.now();row.save(update_fields=['email_sent_at']);sent+=1
                except Exception:
                    failed+=1
        finally:
            with connection.cursor() as cursor:cursor.execute('SELECT pg_advisory_unlock(%s)',[key])
        self.stdout.write(json.dumps({'sent_to_private_sink':sent,'failed':failed}))
