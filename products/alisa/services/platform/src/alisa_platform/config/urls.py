from django.conf import settings
from django.urls import path
from alisa_platform.foundation import views

urlpatterns = [path("health/live", views.live), path("health/ready", views.ready)]
if settings.FOUNDATION_PROBE_ENABLED:
    urlpatterns += [path("internal/foundation/probes", views.probes),
                    path("internal/foundation/probes/<uuid:probe_id>", views.probe)]
