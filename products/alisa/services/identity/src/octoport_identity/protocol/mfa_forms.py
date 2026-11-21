"""Explain native one-use TOTP rejection without changing authentication policy."""
from django import forms
from django.core.cache import cache
from django.core.exceptions import ValidationError
from allauth.core.internal.cryptokit import normalize_user_code
from allauth.mfa.base.forms import AuthenticateForm, ReauthenticateForm
from allauth.mfa.models import Authenticator
from allauth.mfa.totp.internal.auth import TOTP

class FreshCodeInput(forms.TextInput):
    def format_value(self,value):
        # Do not invite resubmission of a rejected/consumed value.
        return None

class ExplainUsedCode:
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs)
        field=self.fields['code']
        field.widget=FreshCodeInput(attrs={**field.widget.attrs,'inputmode':'numeric',
            'autocomplete':'one-time-code','placeholder':'Текущий код из приложения'})

    def clean_code(self):
        try:
            return super().clean_code()
        except ValidationError as error:
            code=self.cleaned_data.get('code','')
            normalized=normalize_user_code(code)
            if (getattr(error,'code',None)=='incorrect_code'
                    and len(normalized)==6 and normalized.isascii() and normalized.isdigit()):
                # Read only the native consumed-value marker. Never generate an
                # expected code, inspect a factor secret, or clear replay state.
                native=TOTP(Authenticator(user=self.user,type=Authenticator.Type.TOTP))
                if cache.get(native._get_used_cache_key(code))=='y':
                    raise ValidationError(
                        'Этот код уже был использован. Дождитесь, пока код в приложении сменится, и введите новый.',
                        code='code_already_used') from None
            raise

class LoginCodeForm(ExplainUsedCode,AuthenticateForm):
    pass

class ConfirmCodeForm(ExplainUsedCode,ReauthenticateForm):
    pass
