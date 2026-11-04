from django.conf import settings
from django.db import connection, DatabaseError
from django.http import JsonResponse
from django.urls import path

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
        return response(200, status="READY", authentication="NOT_IMPLEMENTED")
    except DatabaseError:
        return response(503, code="DATABASE_UNAVAILABLE")

urlpatterns = [path("health/live", live), path("health/ready", ready)]
