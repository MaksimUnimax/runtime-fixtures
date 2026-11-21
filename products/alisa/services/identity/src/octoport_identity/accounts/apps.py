from django.apps import AppConfig


class AccountsConfig(AppConfig):
    name = 'octoport_identity.accounts'

    def ready(self):
        from allauth.mfa.signals import authenticator_used
        from octoport_identity.protocol.staff import native_factor_used
        authenticator_used.connect(native_factor_used, dispatch_uid='alisa.staff.native_factor', weak=False)
