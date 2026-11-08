from django.conf import settings
from django.urls import path
from alisa_platform.foundation import views
from alisa_platform.leads import views as leads
from alisa_platform.accounts import views as accounts
from alisa_platform.staff import views as staff
from alisa_platform.entitlements import views as entitlements
from alisa_platform.stores import views as stores
from alisa_platform.alice_link import views as alice_link

urlpatterns = [path("health/live", views.live), path("health/ready", views.ready)]
urlpatterns += [path('api/v1/leads', leads.submit), path('api/v1/leads/confirm', leads.confirm), path('api/v1/funnel/events', leads.client_event)]
urlpatterns += [path('api/v1/auth/flows',accounts.flow_create),path('api/v1/auth/flows/consume',accounts.flow_consume),
                path('api/v1/auth/sessions',accounts.session_create),path('api/v1/account/me',accounts.me),
                path('api/v1/account/profile',accounts.update_profile),path('api/v1/auth/logout',accounts.logout)]
urlpatterns += [path('api/v1/staff/auth/flows',staff.flow_create),path('api/v1/staff/auth/flows/consume',staff.flow_consume),
                path('api/v1/staff/auth/sessions',staff.session_create),path('api/v1/staff/me',staff.me),
                path('api/v1/staff/logout',staff.logout),path('api/v1/staff/read',staff.read),path('api/v1/staff/command',staff.command)]
urlpatterns += [path('api/v1/staff/access', entitlements.staff), path('api/v1/account/access', entitlements.access)]
urlpatterns += [path('api/v1/account/stores', stores.stores)]
urlpatterns += [path('api/v1/account/alice', alice_link.handle)]
if settings.FOUNDATION_PROBE_ENABLED:
    urlpatterns += [path("internal/foundation/probes", views.probes),
                    path("internal/foundation/probes/<uuid:probe_id>", views.probe)]

from alisa_platform.owner_data import views as owner_data, runtime_rpc as owner_runtime
urlpatterns += [path("api/v1/account/owner-inputs",owner_data.owner_data),path("internal/runtime/owner/check",owner_runtime.check)]

urlpatterns += [path("api/v1/account/owner-products", owner_data.owner_products)]
