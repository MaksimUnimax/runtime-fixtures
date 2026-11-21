from django.urls import path
from .views import owner_data
urlpatterns=[path('inputs',owner_data,name='owner-data-inputs')]

from . import runtime_rpc
urlpatterns += [path("internal/runtime/owner/check",runtime_rpc.check)]
