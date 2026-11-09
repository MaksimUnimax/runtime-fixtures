from django.conf import settings
from django.db import connection, DatabaseError
from django.http import JsonResponse
from django.urls import path,include

def response(http_status, **data):
    result = JsonResponse({"component": "identity", "environment": settings.ALISA_ENV, "release": settings.RELEASE, **data}, status=http_status)
    result["Cache-Control"] = "no-store"
    return result

def live(request):
    return response(200, status="LIVE")

def ready(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM django_migrations WHERE app = 'accounts' AND name = '0001_initial'")
            if not cursor.fetchone():
                return response(503, code="SCHEMA_NOT_READY")
            cursor.execute("SELECT id FROM accounts_person LIMIT 1")
        if getattr(settings,'IDENTITY_ENABLED',False):
            with connection.cursor() as cursor:
                cursor.execute('SELECT 1 FROM identity_protocol_cache LIMIT 1')
                cursor.execute('SELECT 1 FROM accounts_identitymail LIMIT 1')
            return response(200,status='READY',authentication='OIDC_CODE_PKCE')
        return response(200, status="READY", authentication="NOT_IMPLEMENTED")
    except DatabaseError:
        return response(503, code="DATABASE_UNAVAILABLE")

urlpatterns = [path("health/live", live), path("health/ready", ready)]
if getattr(settings,'IDENTITY_ENABLED',False):
    from octoport_identity.protocol.views import mail_status,mail_ui,code_reauthentication
    from octoport_identity.protocol.mfa import ActivateOnceTOTPView,continue_staff
    from octoport_identity.protocol.customer import VerifiedLoginCodeView
    urlpatterns += [path('accounts/2fa/totp/activate/',ActivateOnceTOTPView.as_view(),name='mfa_activate_totp'),
                    path('accounts/login/code/confirm/',VerifiedLoginCodeView.as_view(),name='account_confirm_login_code'),
                    path('identity/staff/continue',continue_staff,name='identity_staff_continue'),
                    path('accounts/reauthenticate/',code_reauthentication),
                    path('accounts/',include('allauth.urls')),path('',include('allauth.idp.urls')),
                    path('identity/mail-status',mail_status),path('identity/mail-ui.js',mail_ui)]
