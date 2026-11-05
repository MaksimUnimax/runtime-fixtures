from allauth.account.forms import SignupForm as LibrarySignupForm
from django import forms
from octoport_identity.accounts.models import IdentityConsent

class SignupForm(LibrarySignupForm):
    privacy = forms.BooleanField(label='Согласен на обработку синтетического контакта для входа.')
    service = forms.BooleanField(label='Принимаю условия закрытого теста Алисы.')
    def save(self,request):
        person=super().save(request)
        for document in ['privacy','service']:
            IdentityConsent.objects.get_or_create(person=person,document=document,version='identity-s02-1')
        return person
