"""Use the server's password-compatible SASL mechanism after verified STARTTLS."""
import ssl
from smtplib import SMTP,SMTPNotSupportedError
from django.core.mail.backends.smtp import EmailBackend as LibraryEmailBackend

class VerifiedTLSLoginSMTP(SMTP):
    def login(self,user,password,*,initial_response_ok=True):
        # Dovecot stores this service principal as a salted password hash.
        # CRAM-MD5 requires a different secret representation; do not negotiate it.
        if not isinstance(self.sock,ssl.SSLSocket) or not self.sock.context.check_hostname or self.sock.context.verify_mode!=ssl.CERT_REQUIRED:
            raise SMTPNotSupportedError('Verified TLS required for service authentication')
        self.ehlo_or_helo_if_needed()
        if 'PLAIN' not in self.esmtp_features.get('auth','').upper().split():
            raise SMTPNotSupportedError('Password authentication unavailable')
        self.user=user;self.password=password
        return self.auth('PLAIN',self.auth_plain,initial_response_ok=initial_response_ok)

class EmailBackend(LibraryEmailBackend):
    @property
    def connection_class(self):return VerifiedTLSLoginSMTP
