from django.conf import settings
from django.urls import path
from alisa_platform.foundation import views
from alisa_platform.leads import views as leads

urlpatterns = [path("health/live", views.live), path("health/ready", views.ready)]
urlpatterns += [path('api/v1/leads', leads.submit), path('api/v1/leads/confirm', leads.confirm), path('api/v1/funnel/events', leads.client_event)]
if settings.FOUNDATION_PROBE_ENABLED:
    urlpatterns += [path("internal/foundation/probes", views.probes),
                    path("internal/foundation/probes/<uuid:probe_id>", views.probe)]
