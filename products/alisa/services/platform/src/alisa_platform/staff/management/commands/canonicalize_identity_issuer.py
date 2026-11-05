"""Closed exact authority rename, preserving each account and pairwise subject."""
import hashlib,json,re,uuid
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.utils import timezone
from alisa_platform.accounts.models import IdentityLink, AuthFlow, WebSession
from alisa_platform.staff.models import StaffMember, StaffSession, StaffAuthFlow, StaffAuditEvent
from alisa_platform.staff.policy import PRODUCT
from alisa_platform.staff.service import owner_lock, audit

OLD='https://id-stage.octoport.ru'
NEW='https://id.octoport.ru'

def binding_fingerprint(issuer, shifted=False):
    links=list(IdentityLink.objects.filter(issuer=issuer,client_id=settings.OIDC_CLIENT_ID).order_by('id').values('id','customer_id','client_id','subject'))
    members=list(StaffMember.objects.filter(product_id=PRODUCT,issuer=issuer,client_id=settings.STAFF_CLIENT_ID).order_by('id').values(
        'id','product_id','client_id','subject','name','role','permissions','active','revision'))
    if shifted:
        for member in members:member['revision']-=1
    return hashlib.sha256(json.dumps({'links':links,'staff':members},sort_keys=True,default=str,separators=(',',':')).encode()).hexdigest()

class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', required=True)
        parser.add_argument('--expected-state', required=True)
        parser.add_argument('--expected-links', type=int, required=True)
        parser.add_argument('--expected-staff', type=int, required=True)
        parser.add_argument('--expected-owner-id', required=True)
        parser.add_argument('--expected-owner-revision', type=int, required=True)
    @transaction.atomic
    def handle(self, *args, **options):
        if not (settings.ALISA_ENV=='stage' and settings.CANONICAL_AUTH_ENABLED
                and settings.ACCOUNTS_ENABLED and settings.STAFF_ENABLED
                and settings.IDENTITY_ISSUER==NEW and settings.STAFF_CLIENT_ID=='alisa_admin_stage' and settings.OIDC_CLIENT_ID=='alisa_market_stage'):
            raise CommandError('Fixed canonical authority configuration required')
        try:owner_id=uuid.UUID(options['expected_owner_id'])
        except (ValueError,TypeError):raise CommandError('Exact owner identifier required') from None
        if not re.fullmatch(r'[0-9a-f]{64}',options['expected_state']) or options['expected_links']<1 or options['expected_staff']<1 or options['expected_owner_revision']<1:
            raise CommandError('Nonempty exact existing authority required')
        owner_lock()
        with connection.cursor() as cursor:
            cursor.execute('LOCK TABLE accounts_identitylink, accounts_authflow, accounts_websession, staff_staffmember, staff_staffauthflow, staff_staffsession IN SHARE ROW EXCLUSIVE MODE')
        prior=StaffAuditEvent.objects.filter(product_id=PRODUCT,action='staff.issuer_migrated')
        if prior.exists():
            owners=list(StaffMember.objects.filter(product_id=PRODUCT,role='OWNER',active=True))
            target=StaffMember.objects.filter(product_id=PRODUCT,issuer=NEW,client_id=settings.STAFF_CLIENT_ID)
            if (not IdentityLink.objects.filter(issuer=OLD,client_id=settings.OIDC_CLIENT_ID).exists()
                    and not StaffMember.objects.filter(product_id=PRODUCT,issuer=OLD,client_id=settings.STAFF_CLIENT_ID).exists()
                    and IdentityLink.objects.filter(issuer=NEW,client_id=settings.OIDC_CLIENT_ID).count()==options['expected_links']
                    and target.count()==options['expected_staff'] and prior.count()==options['expected_staff']
                    and len(owners)==1 and owners[0].pk==owner_id and owners[0].issuer==NEW
                    and owners[0].revision==options['expected_owner_revision']+1
                    and binding_fingerprint(NEW,shifted=True)==options['expected_state']
                    and set(prior.values_list('target_id',flat=True))==set(target.values_list('id',flat=True))):
                self.stdout.write('CANONICAL_IDENTITY_ISSUER_ALREADY_APPLIED')
                return
            raise CommandError('Partial or changed canonical authority; inspect saved result')
        links=list(IdentityLink.objects.select_for_update().filter(issuer=OLD,client_id=settings.OIDC_CLIENT_ID).order_by('id'))
        members=list(StaffMember.objects.select_for_update().filter(product_id=PRODUCT,issuer=OLD,client_id=settings.STAFF_CLIENT_ID).order_by('id'))
        owners=list(StaffMember.objects.filter(product_id=PRODUCT,role='OWNER',active=True))
        if (len(links)!=options['expected_links'] or len(members)!=options['expected_staff']
                or len(owners)!=1 or owners[0].pk!=owner_id
                or owners[0].issuer!=OLD or owners[0].client_id!=settings.STAFF_CLIENT_ID
                or owners[0].revision!=options['expected_owner_revision']):
            raise CommandError('Authority counts or owner revision changed')
        if binding_fingerprint(OLD)!=options['expected_state']:
            raise CommandError('Expected binding composition changed')
        # Any pre-existing target binding is ambiguous; never merge or reuse by email.
        if (IdentityLink.objects.filter(issuer=NEW,client_id=settings.OIDC_CLIENT_ID).exists()
                or StaffMember.objects.filter(product_id=PRODUCT,issuer=NEW,client_id=settings.STAFF_CLIENT_ID).exists()):
            raise CommandError('Target authority already has bindings')
        now=timezone.now()
        IdentityLink.objects.filter(pk__in=[r.pk for r in links]).update(issuer=NEW)
        for member in members:
            before={'staff_id':str(member.pk),'revision':member.revision}
            member.issuer=NEW;member.revision+=1
            member.save(update_fields=['issuer','revision'])
            audit(None,'staff.issuer_migrated',member.pk,'SECURITY_REVIEW','APPLIED',before,
                  {'staff_id':str(member.pk),'revision':member.revision})
        # This product database has one web authority. Old callbacks/flows must not resume.
        AuthFlow.objects.all().update(expires_at=now,encrypted_payload='')
        WebSession.objects.all().update(revoked_at=now,encrypted_payload='')
        StaffAuthFlow.objects.filter(product_id=PRODUCT).update(expires_at=now,encrypted_payload='')
        StaffSession.objects.filter(member_id__in=[m.pk for m in members]).update(revoked_at=now,encrypted_payload='')
        self.stdout.write('CANONICAL_IDENTITY_ISSUER_APPLIED')
