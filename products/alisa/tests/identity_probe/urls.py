from django.http import HttpResponse
from django.urls import include, path

urlpatterns = [path('accounts/', include('allauth.urls')),
               path('', include('allauth.idp.urls')),
               path('probe/complete', lambda request: HttpResponse('Probe complete'))]
