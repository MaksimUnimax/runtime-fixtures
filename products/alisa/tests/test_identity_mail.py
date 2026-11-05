"""Native SMTP boundary: known failures retry, ambiguous submission never replays."""
import sys,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock,patch
from smtplib import SMTPDataError,SMTPRecipientsRefused
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'services/identity/src'))
from octoport_identity.protocol import mail_delivery as delivery

class IdentityMailTransportTests(unittest.TestCase):
    def setUp(self):
        self.connection=Mock()
        self.message=Mock()
        self.message.return_value.send.return_value=1
        self.settings=SimpleNamespace(EMAIL_HOST='127.0.0.1',EMAIL_PORT=18225,
            DEFAULT_FROM_EMAIL='alisa-identity@example.invalid',
            REAL_LOGIN_RECIPIENTS={'invited@example.test'},
            REAL_SMTP={'host':'mail.octoport.ru','port':25,'username':'alisa-mailer@octoport.ru',
                       'password':'synthetic-fixture-only','use_tls':True,'use_ssl':False,'timeout':4},
            REAL_FROM_EMAIL='no-reply@octoport.ru')
        self.patches=[patch.object(delivery,'settings',self.settings),
            patch.object(delivery,'open_sealed',return_value={'subject':'Code','body':'Synthetic'}),
            patch.object(delivery,'get_connection',return_value=self.connection),
            patch.object(delivery,'EmailMessage',self.message)]
        for p in self.patches:p.start()
        self.addCleanup(lambda:[p.stop() for p in reversed(self.patches)])
    def send(self,recipient='invited@example.test'):return delivery.deliver_mail('fixture','encrypted',recipient)
    def test_invited_recipient_requires_authenticated_starttls(self):
        self.assertEqual(self.send(),'SENT')
        self.assertEqual(delivery.get_connection.call_args.kwargs,self.settings.REAL_SMTP)
        self.assertEqual(delivery.get_connection.call_args.args[0],'octoport_identity.protocol.smtp.EmailBackend')
        self.assertEqual(self.message.call_args.args[2],'no-reply@octoport.ru')
        self.connection.open.assert_called_once();self.connection.close.assert_called_once()
    def test_synthetic_recipient_stays_on_private_sink(self):
        self.assertEqual(self.send('fixture@example.invalid'),'SENT')
        self.assertEqual(delivery.get_connection.call_args.kwargs,{'host':'127.0.0.1','port':18225,'timeout':4})
    def test_other_recipient_never_opens_smtp(self):
        self.assertEqual(self.send('not-invited@example.test'),'DELIVERY_REJECTED')
        delivery.get_connection.assert_not_called()
    def test_open_failure_is_safe_to_retry(self):
        self.connection.open.side_effect=OSError()
        self.assertEqual(self.send(),'DELIVERY_UNAVAILABLE');self.message.assert_not_called()
    def test_disconnect_during_data_has_unknown_outcome(self):
        self.message.return_value.send.side_effect=OSError()
        self.assertEqual(self.send(),'DELIVERY_OUTCOME_UNKNOWN')
    def test_explicit_smtp_temporary_and_permanent_rejections(self):
        for code,outcome in [(451,'DELIVERY_UNAVAILABLE'),(550,'DELIVERY_REJECTED')]:
            self.message.return_value.send.side_effect=SMTPDataError(code,b'fixture')
            self.assertEqual(self.send(),outcome)
    def test_refused_recipient_is_terminal(self):
        self.message.return_value.send.side_effect=SMTPRecipientsRefused({'invited@example.test':(550,b'fixture')})
        self.assertEqual(self.send(),'DELIVERY_REJECTED')
    def test_quit_failure_cannot_retry_accepted_message(self):
        self.connection.close.side_effect=OSError()
        self.assertEqual(self.send(),'SENT')
    def test_corrupt_payload_never_opens_smtp(self):
        delivery.open_sealed.return_value={'subject':'Code','body':[]}
        self.assertEqual(self.send(),'INVALID_PAYLOAD');delivery.get_connection.assert_not_called()

class VerifiedSMTPAuthenticationTests(unittest.TestCase):
    def test_plain_auth_requires_verified_tls_and_advertised_mechanism(self):
        import ssl
        from smtplib import SMTPNotSupportedError
        from octoport_identity.protocol.smtp import VerifiedTLSLoginSMTP
        smtp=VerifiedTLSLoginSMTP()
        smtp.ehlo_or_helo_if_needed=Mock()
        smtp.auth=Mock(return_value=(235,b'accepted'))
        smtp.esmtp_features={'auth':'CRAM-MD5 PLAIN LOGIN'}
        for socket in [None,Mock()]:
            smtp.sock=socket
            with self.assertRaises(SMTPNotSupportedError):smtp.login('fixture','not-live')
        socket=Mock(spec=ssl.SSLSocket);socket.context=SimpleNamespace(check_hostname=True,verify_mode=ssl.CERT_REQUIRED)
        smtp.sock=socket
        self.assertEqual(smtp.login('fixture','not-live')[0],235)
        self.assertEqual(smtp.auth.call_args.args[0],'PLAIN')
        socket.context.check_hostname=False
        with self.assertRaises(SMTPNotSupportedError):smtp.login('fixture','not-live')
        socket.context.check_hostname=True;socket.context.verify_mode=ssl.CERT_NONE
        with self.assertRaises(SMTPNotSupportedError):smtp.login('fixture','not-live')
        socket.context.verify_mode=ssl.CERT_REQUIRED;smtp.esmtp_features={'auth':'CRAM-MD5'}
        with self.assertRaises(SMTPNotSupportedError):smtp.login('fixture','not-live')
