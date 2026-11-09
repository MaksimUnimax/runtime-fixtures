from datetime import timedelta
from django.conf import settings
from django.core.management.base import BaseCommand,CommandError
from django.contrib.sessions.models import Session
from django.db import transaction,DatabaseError
from django.db.models import Q
from django.utils import timezone
from octoport_identity.accounts.models import IdentityMail,ProtocolCache
from octoport_identity.protocol.mail_delivery import deliver_mail

class Command(BaseCommand):
    help='Finite identity-only mail batch; no SMTP call while a DB transaction is held.'
    def handle(self,*args,**options):
        if not settings.IDENTITY_ENABLED:return
        try:self.deliver()
        except DatabaseError:raise CommandError('Identity mail storage unavailable') from None
    def deliver(self):
        now=timezone.now()
        ids=list(Session.objects.filter(expire_date__lt=now).values_list('pk',flat=True)[:1000])
        Session.objects.filter(pk__in=ids).delete()
        ids=list(ProtocolCache.objects.filter(expires__lt=now).values_list('pk',flat=True)[:1000])
        ProtocolCache.objects.filter(pk__in=ids).delete()
        IdentityMail.objects.filter(expires_at__lt=now,sent_at__isnull=True).update(encrypted_payload='',error_code='EXPIRED')
        IdentityMail.objects.filter(expires_at__lt=now-timedelta(days=1)).delete()
        # A process lost after submission may have delivered. Never replay that message.
        IdentityMail.objects.filter(sent_at__isnull=True,error_code='SENDING',lease_until__lte=now).update(
            error_code='DELIVERY_OUTCOME_UNKNOWN',attempts=5,encrypted_payload='')
        for _ in range(25):
            with transaction.atomic():
                row=IdentityMail.objects.select_for_update(skip_locked=True).filter(sent_at__isnull=True,
                    expires_at__gt=timezone.now(),attempts__lt=5).filter(Q(lease_until__isnull=True)|Q(lease_until__lte=timezone.now())).first()
                if not row:break
                row.lease_until=timezone.now()+timedelta(seconds=30);row.attempts+=1;row.error_code='SENDING'
                row.save(update_fields=['lease_until','attempts','error_code'])
                mail_id=row.pk;payload=row.encrypted_payload;recipient=row.recipient
            outcome=deliver_mail(mail_id,payload,recipient)
            query=IdentityMail.objects.filter(pk=mail_id,sent_at__isnull=True)
            if outcome=='SENT':
                query.update(sent_at=timezone.now(),encrypted_payload='',error_code='',lease_until=None)
            elif outcome=='DELIVERY_UNAVAILABLE':
                query.update(error_code=outcome)
            else:
                query.update(error_code=outcome,attempts=5,encrypted_payload='')
