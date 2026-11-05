from datetime import timedelta
from django.conf import settings
from django.core.management.base import BaseCommand,CommandError
from django.contrib.sessions.models import Session
from django.core.mail import EmailMessage,get_connection
from django.db import transaction,DatabaseError
from django.db.models import Q
from django.utils import timezone
from cryptography.fernet import InvalidToken
from octoport_identity.accounts.models import IdentityMail,ProtocolCache
from octoport_identity.protocol.storage import open_sealed

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
        for _ in range(25):
            with transaction.atomic():
                row=IdentityMail.objects.select_for_update(skip_locked=True).filter(sent_at__isnull=True,
                    expires_at__gt=timezone.now(),attempts__lt=5).filter(Q(lease_until__isnull=True)|Q(lease_until__lte=timezone.now())).first()
                if not row:break
                row.lease_until=timezone.now()+timedelta(seconds=30);row.attempts+=1
                row.save(update_fields=['lease_until','attempts'])
                mail_id=row.pk;payload=row.encrypted_payload;recipient=row.recipient
            try:
                data=open_sealed(payload)
                connection=get_connection('django.core.mail.backends.smtp.EmailBackend',host=settings.EMAIL_HOST,
                                          port=settings.EMAIL_PORT,timeout=4)
                sent=EmailMessage(data['subject'],data['body'],data['from_email'],[recipient],
                    headers={'Message-ID':'<'+str(mail_id)+'@identity.example.invalid>'},connection=connection).send(fail_silently=False)
                if sent!=1:raise OSError()
            except (OSError,InvalidToken,ValueError,KeyError):
                IdentityMail.objects.filter(pk=mail_id,sent_at__isnull=True).update(error_code='DELIVERY_UNAVAILABLE')
                continue
            IdentityMail.objects.filter(pk=mail_id,sent_at__isnull=True).update(sent_at=timezone.now(),encrypted_payload='',error_code='')
