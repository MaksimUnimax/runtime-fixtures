import json
import logging
import signal
import time
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction, connections, DatabaseError, OperationalError, InterfaceError
from django.utils import timezone
from alisa_platform.foundation.models import FoundationProbe, FoundationJob

logger = logging.getLogger("alisa.foundation")

def tick():
    # Lock job+probe and commit the effect together; crash rolls both back.
    with transaction.atomic():
        job = FoundationJob.objects.select_for_update(skip_locked=True).filter(done=False).select_related("probe").first()
        if job:
            row = job.probe
            if row.expires_at > timezone.now() and row.state == "ACCEPTED":
                row.state = "PROCESSED"
                row.effect_count = 1
                row.processed_release = settings.RELEASE
                row.processed_at = timezone.now()
                row.save(update_fields=["state", "effect_count", "processed_release", "processed_at"])
            job.done = True
            job.save(update_fields=["done"])
            logger.info(json.dumps({"event": "probe_processed", "probe_id": str(row.id), "correlation_id": str(row.correlation_id)}))
    FoundationProbe.objects.filter(expires_at__lte=timezone.now()).delete()

class Command(BaseCommand):
    help = "Process only synthetic platform foundation probes; no marketplace execution."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true")

    def handle(self, *args, **options):
        if not settings.FOUNDATION_PROBE_ENABLED:
            raise CommandError("Foundation worker is disabled")
        stopped = False
        def stop(*_):
            nonlocal stopped
            stopped = True
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        retry_delay = 0.5
        unavailable = False
        while not stopped:
            delay = 0.25
            try:
                tick()
                if unavailable:
                    logger.info(json.dumps({"event": "worker_database_recovered"}))
                unavailable = False
                retry_delay = 0.5
            except (OperationalError, InterfaceError):
                if options["once"]:
                    raise CommandError("Foundation database unavailable") from None
                if not unavailable:
                    logger.warning(json.dumps({"event": "worker_database_unavailable"}))
                unavailable = True
                delay = retry_delay
                retry_delay = min(5, retry_delay * 2)
            except DatabaseError:
                raise CommandError("Foundation processing failed") from None
            finally:
                connections.close_all()
            if options["once"]:
                return
            time.sleep(delay)
