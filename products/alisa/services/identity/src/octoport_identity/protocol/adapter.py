import uuid
from datetime import timedelta
from allauth.account.adapter import DefaultAccountAdapter
from allauth.idp.oidc.adapter import DefaultOIDCAdapter
from allauth.mfa.adapter import DefaultMFAAdapter
from django.conf import settings
from django.core.exceptions import ValidationError
from django.utils import timezone
from octoport_identity.accounts.models import Subject, IdentityMail
from .storage import seal,open_sealed

class MFAAdapter(DefaultMFAAdapter):
    def encrypt(self,text):return seal({'value':text})
    def decrypt(self,encrypted_text):
        value=open_sealed(encrypted_text).get('value')
        if not isinstance(value,str):raise ValueError('Invalid factor secret')
        return value

class OIDCAdapter(DefaultOIDCAdapter):
    def get_issuer(self):return settings.IDENTITY_ISSUER
    def populate_id_token(self,id_token,client,scopes):
        if client.id==settings.IDENTITY_STAFF_CLIENT_ID:
            from .staff import token_claims
            id_token.update(token_claims(client,id_token))
        else:
            from .customer import customer_client,token_claims
            customer=customer_client()
            if customer is not None and customer.id==client.id:
                id_token.update(token_claims(client,id_token))
    def get_user_sub(self,client,user):
        subject,_=Subject.objects.get_or_create(client=client,person=user)
        return str(subject.pk)
    def get_user_by_sub(self,client,sub):
        try:subject_id=uuid.UUID(sub)
        except (ValueError,TypeError,AttributeError):return None
        subject=Subject.objects.select_related('person').filter(pk=subject_id,client=client,person__is_active=True).first()
        return subject.person if subject else None

class AccountAdapter(DefaultAccountAdapter):
    def get_login_stages(self):
        stages=super().get_login_stages()
        stages=[('octoport_identity.protocol.customer.CustomerAwareMFAStage'
            if path=='allauth.mfa.stages.AuthenticateStage' else path) for path in stages]
        position=stages.index('octoport_identity.protocol.customer.CustomerAwareMFAStage')
        stages.insert(position,'octoport_identity.protocol.customer.CustomerProofStage')
        return ['octoport_identity.protocol.customer.CredentialStage',*stages]

    def clean_email(self,email):
        email=super().clean_email(email).strip().lower()
        if not email.endswith('@example.invalid') and not settings.REAL_LOGIN_OPEN and email not in settings.REAL_LOGIN_RECIPIENTS:
            if settings.REAL_LOGIN_RECIPIENTS:
                raise ValidationError('Закрытый тест: введите приглашённый адрес или тестовый адрес вида tester@example.invalid.')
            raise ValidationError('На этом тестовом стенде используйте адрес вида tester@example.invalid. Обычная почта пока не подключена.')
        return email
    def is_open_for_signup(self,request):return settings.IDENTITY_ENABLED
    def send_mail(self,template_prefix,email,context):
        from allauth.core import context as request_context
        from django.contrib.sites.shortcuts import get_current_site
        email=self.clean_email(email)
        request=request_context.request
        if request is not None:
            previous=request.session.get('identity_mail_id')
            if previous:IdentityMail.objects.filter(pk=previous,sent_at__isnull=True).update(encrypted_payload='',expires_at=timezone.now(),error_code='SUPERSEDED')
        msg=self.render_mail(template_prefix,email,{'request':request,'email':email,'current_site':get_current_site(request),**context})
        row=IdentityMail.objects.create(recipient=email,expires_at=timezone.now()+timedelta(seconds=600),
            encrypted_payload=seal({'subject':msg.subject,'body':msg.body,'from_email':settings.DEFAULT_FROM_EMAIL}))
        if request is not None:request.session['identity_mail_id']=str(row.pk)
