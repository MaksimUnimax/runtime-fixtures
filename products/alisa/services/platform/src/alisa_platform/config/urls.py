from django.conf import settings
from django.urls import path
from alisa_platform.foundation import views
from alisa_platform.leads import views as leads
from alisa_platform.accounts import views as accounts

urlpatterns = [path("health/live", views.live), path("health/ready", views.ready)]
urlpatterns += [path('api/v1/leads', leads.submit), path('api/v1/leads/confirm', leads.confirm), path('api/v1/funnel/events', leads.client_event)]
urlpatterns += [path('api/v1/auth/flows',accounts.flow_create),path('api/v1/auth/flows/consume',accounts.flow_consume),
                path('api/v1/auth/sessions',accounts.session_create),path('api/v1/account/me',accounts.me),
                path('api/v1/account/profile',accounts.update_profile),path('api/v1/auth/logout',accounts.logout)]
if settings.FOUNDATION_PROBE_ENABLED:
    urlpatterns += [path("internal/foundation/probes", views.probes),
                    path("internal/foundation/probes/<uuid:probe_id>", views.probe)]
