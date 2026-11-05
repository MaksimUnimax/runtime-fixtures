"""Native SMTP transport selection and bounded outcomes, with no message data in errors."""
from smtplib import SMTPDataError,SMTPRecipientsRefused,SMTPSenderRefused
from django.conf import settings
from django.core.mail import EmailMessage,get_connection
from cryptography.fernet import InvalidToken
from .storage import open_sealed

def deliver_mail(mail_id,payload,recipient):
    # Re-check the recipient at the delivery boundary, not only in the HTTP form.
    if recipient.endswith('@example.invalid'):
        backend='django.core.mail.backends.smtp.EmailBackend'
        options={'host':settings.EMAIL_HOST,'port':settings.EMAIL_PORT,'timeout':4}
        sender=settings.DEFAULT_FROM_EMAIL;domain='identity.example.invalid'
    elif (settings.REAL_LOGIN_OPEN or recipient in settings.REAL_LOGIN_RECIPIENTS) and settings.REAL_SMTP:
        backend='octoport_identity.protocol.smtp.EmailBackend'
        options=settings.REAL_SMTP;sender=settings.REAL_FROM_EMAIL
        domain='id-stage.octoport.ru'
    else:return 'DELIVERY_REJECTED'
    try:
        data=open_sealed(payload)
        if not all(isinstance(data[k],str) and data[k] for k in ['subject','body']):return 'INVALID_PAYLOAD'
        connection=get_connection(backend,**options)
    except (InvalidToken,ValueError,KeyError,TypeError):return 'INVALID_PAYLOAD'
    try:
        # Connection/authentication failures happen before DATA and can safely retry.
        try:connection.open()
        except (OSError,ValueError):return 'DELIVERY_UNAVAILABLE'
        try:
            sent=EmailMessage(data['subject'],data['body'],sender,[recipient],
                headers={'Message-ID':'<'+str(mail_id)+'@'+domain+'>'},connection=connection).send(fail_silently=False)
            return 'SENT' if sent==1 else 'DELIVERY_OUTCOME_UNKNOWN'
        except (SMTPDataError,SMTPSenderRefused) as exc:
            return 'DELIVERY_UNAVAILABLE' if 400<=exc.smtp_code<500 else 'DELIVERY_REJECTED'
        except SMTPRecipientsRefused as exc:
            return 'DELIVERY_UNAVAILABLE' if exc.recipients and all(400<=v[0]<500 for v in exc.recipients.values()) else 'DELIVERY_REJECTED'
        except ValueError:return 'INVALID_PAYLOAD'
        except OSError:return 'DELIVERY_OUTCOME_UNKNOWN'
    finally:
        # A QUIT failure cannot undo an acknowledged DATA.
        try:connection.close()
        except OSError:pass
