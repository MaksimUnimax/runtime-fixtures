import uuid
import json
from urllib.parse import urlsplit,urlencode
from django.contrib.auth import REDIRECT_FIELD_NAME
from django.http import HttpResponseRedirect
from django.shortcuts import render
from django.urls import reverse
from django.utils import timezone
from django.http import JsonResponse
from django.http import HttpResponse
from django.conf import settings
from octoport_identity.accounts.models import IdentityMail

def code_reauthentication(request):
    """Restart both customer factors; retain native account-security reauth."""
    from allauth.account.adapter import get_adapter
    from allauth.account.views import ReauthenticateView
    from .customer import customer_target
    values=request.POST.getlist(REDIRECT_FIELD_NAME) or request.GET.getlist(REDIRECT_FIELD_NAME)
    target=values[0] if len(values)==1 else ''
    if len(values)>1 or len(target)>4096 or '\\' in target or any(ord(c)<32 or ord(c)==127 for c in target):
        return JsonResponse({'code':'INVALID_RETURN_TARGET'},status=400)
    try:u=urlsplit(target)
    except ValueError:return JsonResponse({'code':'INVALID_RETURN_TARGET'},status=400)
    if u.scheme or u.netloc or u.fragment or target and not u.path.startswith('/'):
        return JsonResponse({'code':'INVALID_RETURN_TARGET'},status=400)
    if (customer_target(target) is None and request.user.is_authenticated
            and get_adapter().get_reauthentication_methods(request.user)):
        return ReauthenticateView.as_view()(request)
    if request.method!='GET':return JsonResponse({'code':'METHOD_NOT_ALLOWED'},status=405)
    if not target or u.path!=reverse('idp:oidc:authorization'):
        return JsonResponse({'code':'INVALID_RETURN_TARGET'},status=400)
    login=reverse('account_login')+'?'+urlencode({REDIRECT_FIELD_NAME:target})
    if not request.user.is_authenticated:return HttpResponseRedirect(login)
    response=render(request,'identity/reauthenticate_code.html',{'login_target':login,'customer_reauthentication':customer_target(target) is not None})
    response['Cache-Control']='no-store';return response

def mail_status(request):
    if request.method!='GET':return JsonResponse({'code':'METHOD_NOT_ALLOWED'},status=405)
    try:mail_id=uuid.UUID(request.session.get('identity_mail_id',''))
    except (ValueError,TypeError,AttributeError):return JsonResponse({'state':'UNKNOWN'},status=404)
    row=IdentityMail.objects.filter(pk=mail_id).first()
    state='UNKNOWN' if not row else 'EXPIRED' if row.expires_at<=timezone.now() else 'DELIVERED' if row.sent_at else 'FAILED' if row.error_code in {'DELIVERY_OUTCOME_UNKNOWN','DELIVERY_REJECTED','INVALID_PAYLOAD'} or row.attempts>=5 else 'DELAYED' if row.error_code=='DELIVERY_UNAVAILABLE' else 'QUEUED'
    response=JsonResponse({'state':state});response['Cache-Control']='no-store';return response

def brand_context(request):
    from .staff import PENDING
    name=request.resolver_match.url_name if request.resolver_match else ''
    mfa_page=request.path.startswith('/accounts/2fa/')
    pending=request.session.get(PENDING)
    from .customer import authorization_query
    from .staff import valid_admin_query
    query=authorization_query(request.POST.get('next') or request.GET.get('next'))
    return {'alisa_product_origin':settings.IDENTITY_PRODUCT_ORIGIN,
        'staff_login_context':query is not None and valid_admin_query(query),
        'real_login_enabled':bool(settings.REAL_LOGIN_OPEN or settings.REAL_LOGIN_RECIPIENTS),
        'registration_open':settings.REAL_LOGIN_OPEN,'mfa_page':mfa_page,
        'admin_home_url':settings.IDENTITY_STAFF_CALLBACK.rsplit('/auth/callback',1)[0]+'/admin' if settings.IDENTITY_STAFF_ENABLED else '',
        'mfa_recovery_page':name in {'mfa_view_recovery_codes','mfa_generate_recovery_codes'},
        'mfa_setup_page':name=='mfa_activate_totp',
        'staff_continuation_context':bool(settings.IDENTITY_STAFF_ENABLED and request.user.is_authenticated)}


def mail_ui(request):
    paths=json.dumps([reverse('account_confirm_login_code'),reverse('account_email_verification_sent'),reverse('account_confirm_password_reset_code')])
    script="const codePaths="+paths+";"+"""let attempts=0;async function check(){try{const r=await fetch('/identity/mail-status',{cache:'no-store'});if(r.ok){const d=await r.json();const el=document.getElementById('mail-status');const text={QUEUED:'Готовим письмо с кодом. Проверьте почту.',DELIVERED:'Письмо с кодом отправлено.',DELAYED:'Пока не удалось отправить письмо. Повторим отправку; можно запросить новый код.',EXPIRED:'Срок кода истёк. Запросите новый код.',FAILED:'Доставка не подтверждена. Проверьте почту; если письма нет, запросите новый код.'};el.textContent=text[d.state]||'';if(['DELIVERED','EXPIRED','FAILED'].includes(d.state))return;}}catch{}if(++attempts<60)setTimeout(check,2000);}if(codePaths.includes(location.pathname)&&document.querySelector('input[name=code]'))check();"""
    return HttpResponse(script,content_type='application/javascript')
