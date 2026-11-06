from allauth.account.forms import SignupForm as LibrarySignupForm
from allauth.account.forms import LoginForm as LibraryLoginForm,RequestLoginCodeForm as LibraryRequestLoginCodeForm
from allauth.account.adapter import get_adapter
from django import forms
from django.conf import settings
from octoport_identity.accounts.models import IdentityConsent

class LoginForm(LibraryLoginForm):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs)
        self.fields['login'].widget.attrs['placeholder']=('you@example.com' if settings.REAL_LOGIN_OPEN or settings.REAL_LOGIN_RECIPIENTS else 'tester@example.invalid')
        self.fields['login'].label='Логин (электронная почта)'
        # Preserve the separately validated staff email-code + native MFA path.
        from .customer import authorization_query
        from .staff import valid_admin_query
        query=authorization_query(self.request.POST.get('next') or self.request.GET.get('next')) if self.request is not None else None
        if query is not None and valid_admin_query(query):
            self.fields.pop('password',None)

    def _login_with_password(self,request,redirect_url,credentials):
        from .customer import pin_password
        # Called only after native clean() has authenticated these credentials.
        pin_password(self._login,redirect_url)
        return super()._login_with_password(request,redirect_url,credentials)

    def clean_login(self):return get_adapter().clean_email(super().clean_login())

class RequestLoginCodeForm(LibraryRequestLoginCodeForm):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs)
        self.fields['email'].widget.attrs['placeholder']=('you@example.com' if settings.REAL_LOGIN_OPEN or settings.REAL_LOGIN_RECIPIENTS else 'tester@example.invalid')

    def clean_email(self):
        self.cleaned_data['email']=get_adapter().clean_email(self.cleaned_data['email'])
        return super().clean_email()

class SignupForm(LibrarySignupForm):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs)
        self.fields['email'].widget.attrs['placeholder']=('you@example.com' if settings.REAL_LOGIN_OPEN or settings.REAL_LOGIN_RECIPIENTS else 'tester@example.invalid')
        if settings.REAL_LOGIN_OPEN or settings.REAL_LOGIN_RECIPIENTS:
            self.fields['privacy'].label='Согласен на обработку адреса электронной почты для регистрации и входа.'
        if settings.REAL_LOGIN_OPEN:
            self.fields['service'].label='Принимаю условия использования Алисы Маркет.'

    privacy = forms.BooleanField(label='Согласен на обработку синтетического контакта для входа.')
    service = forms.BooleanField(label='Принимаю условия закрытого теста Алисы.')
    def save(self,request):
        person=super().save(request)
        request._alisa_password_signup=str(person.pk)
        for document in ['privacy','service']:
            IdentityConsent.objects.get_or_create(person=person,document=document,version=('identity-s02-open-1' if settings.REAL_LOGIN_OPEN else 'identity-s02-mail-1' if person.email.lower() in settings.REAL_LOGIN_RECIPIENTS else 'identity-s02-1'))
        return person
