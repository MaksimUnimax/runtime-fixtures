"""Count a verified native enrollment challenge once, then resume its own request."""
from allauth.account.internal.flows.login import get_authentication_records
from allauth.mfa.base.internal.flows import post_authentication
from allauth.mfa.models import Authenticator
from allauth.mfa.totp.views import ActivateTOTPView
from django.conf import settings
from django.db import transaction
from django.http import HttpResponseRedirect, JsonResponse
from django.urls import reverse
from .staff import fresh, pending_authorization_target, proof_for_request
import time

class EnrollmentCodeUnavailable(Exception):
    pass

class ActivateOnceTOTPView(ActivateTOTPView):
    def form_valid(self, form):
        request=self.request
        # Only the same live, validated admin request may count enrollment as
        # its MFA. Other native account-security flows keep library policy.
        count_once=(request.method=='POST' and request.path==reverse('mfa_activate_totp')
            and request.user.is_authenticated and form.user.pk==request.user.pk
            and pending_authorization_target(request) is not None
            and any(row.get('method')=='code' and fresh(row.get('at'),time.time(),300)
                    for row in get_authentication_records(request,request.user)))
        if not count_once:
            return super().form_valid(form)
        try:
            with transaction.atomic():
                response=super().form_valid(form)
                authenticator=Authenticator.objects.get(user=request.user,type=Authenticator.Type.TOTP)
                authenticator.user=request.user
                # Native enrollment validates the value but does not mark it
                # consumed. Use the native verifier before native auth records.
                if not authenticator.wrap().validate_code(form.cleaned_data['code']):
                    raise EnrollmentCodeUnavailable()
                post_authentication(request,authenticator,reauthenticated=True)
                return response
        except EnrollmentCodeUnavailable:
            form.add_error('code','Этот код уже использован или истёк. Повторите подключение с новым кодом из приложения.')
            return self.form_invalid(form)

def staff_login_url():
    from urllib.parse import urlsplit
    callback=urlsplit(settings.IDENTITY_STAFF_CALLBACK)
    return callback.scheme+'://'+callback.netloc+'/login'

def continue_staff(request):
    if request.method!='POST':
        return JsonResponse({'code':'METHOD_NOT_ALLOWED'},status=405)
    if not settings.IDENTITY_ENABLED or not settings.IDENTITY_STAFF_ENABLED:
        return JsonResponse({'code':'NOT_FOUND'},status=404)
    target=pending_authorization_target(request)
    # POST and CSRF do not grant authority: a valid native proof is still
    # consumed only when allauth issues the original one-use OAuth code.
    if target and proof_for_request(request) is not None:
        response=HttpResponseRedirect(target)
    else:
        response=HttpResponseRedirect(staff_login_url())
    response.status_code=303
    response['Cache-Control']='no-store'
    response['Referrer-Policy']='no-referrer'
    return response
