"""Deliver owned real-address fixtures into loopback SMTP; no product bypass."""
import os
if not (os.environ.get('ALISA_ENV')=='dev' and os.environ.get('ALISA_DB_HOST')=='127.0.0.1'
        and os.environ.get('ALISA_DB_PORT')=='55480' and os.environ.get('ALISA_DB_NAME')=='alisa_stage_identity'):
    raise RuntimeError('Owned disposable identity database required')
import django
django.setup()
from unittest.mock import patch
from django.core.mail import get_connection
from octoport_identity.accounts.management.commands.identity_deliver import Command
def fixture_connection(backend,**options):
    if backend=='octoport_identity.protocol.smtp.EmailBackend':
        if not (options.get('host')=='mail.octoport.ru' and options.get('use_tls') is True
                and options.get('use_ssl') is False and options.get('password')=='synthetic-owned-smtp-fixture-password-0001'):
            raise RuntimeError('Expected verified real SMTP routing')
        return get_connection('django.core.mail.backends.smtp.EmailBackend',host='127.0.0.1',port=18226,timeout=4)
    if backend!='django.core.mail.backends.smtp.EmailBackend' or options.get('host')!='127.0.0.1':
        raise RuntimeError('Only owned loopback SMTP is allowed')
    return get_connection(backend,**options)
with patch('octoport_identity.protocol.mail_delivery.get_connection',side_effect=fixture_connection):
    Command().deliver()
