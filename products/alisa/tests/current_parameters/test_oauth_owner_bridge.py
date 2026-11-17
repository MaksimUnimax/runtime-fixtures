"""Exact owner OAuth bearer/tenant mapping without creating legacy demo tokens."""
import json
import hashlib
from datetime import timedelta
from django.conf import settings
from django.test import RequestFactory,TestCase,override_settings
from django.utils import timezone
from alisa_platform.accounts.models import Membership
from alisa_platform.alice_link.models import TokenFamily
from alisa_platform.alice_link import views
from alisa_platform.stores.models import RuntimeTenantBinding
from .test_voice_parameters import VoiceFixture,OPTIONS


@override_settings(**OPTIONS)
class OwnerOAuthBridge(VoiceFixture,TestCase):
    def setUp(self):
        self.create_voice()
        self.binding=RuntimeTenantBinding.objects.create(tenant=self.tenant,native_tenant='demo-a')

    def ask(self,token=None,service=True,more=None):
        data={'action':'legacy_station_identity','access_token':self.access if token is None else token}
        if more:data.update(more)
        req=RequestFactory().post('/api/v1/account/alice',data=json.dumps(data),
            content_type='application/json',HTTP_AUTHORIZATION='Bearer '+(
                settings.AUTH_SERVICE_TOKEN if service else 'invalid'))
        result=views.handle(req)
        return result.status_code,json.loads(result.content)

    def current(self,token_hash=None,owner=None,tenant='demo-a',service=True):
        data={'action':'legacy_station_token_current',
              'token_hash':token_hash if token_hash is not None else hashlib.sha256(self.access.encode()).hexdigest(),
              'owner':owner if owner is not None else str(self.customer.pk),
              'native_tenant':tenant}
        request=RequestFactory().post('/api/v1/account/alice',data=json.dumps(data),
            content_type='application/json',HTTP_AUTHORIZATION='Bearer '+(
                settings.AUTH_SERVICE_TOKEN if service else 'invalid'))
        response=views.handle(request)
        return response.status_code,json.loads(response.content)

    def test_modern_access_hash_current_without_raw_token(self):
        self.assertEqual(self.current()[1]['current'],True)
        self.assertIs(self.current(token_hash='f'*64)[1]['current'],False)
        self.assertIs(self.current(owner='11111111-1111-1111-1111-111111111111')[1]['current'],False)
        self.assertIs(self.current(tenant='demo-b')[1]['current'],False)
        self.assertEqual(self.current(service=False)[0],401)

    def test_modern_current_rejects_revoked_and_expired_access(self):
        self.family.revoked_at=timezone.now();self.family.save()
        self.assertIs(self.current()[1]['current'],False)
        self.family.revoked_at=None;self.family.access_expires_at=timezone.now()-timedelta(seconds=1)
        self.family.save();self.assertIs(self.current()[1]['current'],False)

    def test_modern_current_rejects_changed_client_binding_membership(self):
        self.assertIs(self.current()[1]['current'],True)
        self.link.client_id='foreign';self.link.save()
        self.assertIs(self.current()[1]['current'],False)
        self.link.client_id=settings.ALICE_CLIENT_ID;self.link.save()
        Membership.objects.filter(customer=self.customer,tenant=self.tenant).delete()
        self.assertIs(self.current()[1]['current'],False)

    def test_modern_current_cannot_extend_token_or_modify_owner_rows(self):
        before=list(TokenFamily.objects.values())
        self.current();self.current()
        self.assertEqual(before,list(TokenFamily.objects.values()))
        from alisa_platform.owner_data.models import CurrentParameter,OwnerCommand
        self.assertEqual(CurrentParameter.objects.count(),0)
        self.assertEqual(OwnerCommand.objects.count(),0)

    def test_real_existing_bearer_maps_only_the_current_owner_native_tenant(self):
        code,data=self.ask()
        self.assertEqual(code,200)
        self.assertEqual(data['identity'],{'native_tenant':'demo-a','owner':str(self.customer.pk),
            'platform_tenant':str(self.tenant.pk)})

    def test_untrusted_browser_without_private_service_grant_is_denied(self):
        code,value=self.ask(service=False)
        self.assertEqual(code,401)
        self.assertNotIn('identity',value)

    def test_unrecognized_or_missing_or_malformed_tokens_are_denied(self):
        for token in ('', 'as6_wrong', 'not-a-modern-token', 'as6_'+'z'*2100):
            with self.subTest(token_kind=len(token)):
                code,data=self.ask(token)
                self.assertEqual(code,401)
                self.assertNotIn('identity',data)

    def test_refresh_token_is_never_an_access_token(self):
        self.assertEqual(self.ask('refresh-'+self.access)[0],401)

    def test_revoked_access_token_and_changed_link_revision_are_denied(self):
        self.family.revoked_at=timezone.now();self.family.save()
        self.assertEqual(self.ask()[0],401)
        self.family.revoked_at=None;self.family.save()
        self.link.revision+=1;self.link.save()
        self.assertEqual(self.ask()[0],401)

    def test_owner_security_revision_or_membership_revocation_is_denied(self):
        self.customer.security_revision+=1;self.customer.save()
        self.assertEqual(self.ask()[0],401)
        self.customer.security_revision-=1;self.customer.save()
        Membership.objects.filter(customer=self.customer,tenant=self.tenant).delete()
        self.assertEqual(self.ask()[0],401)

    def test_native_tenant_not_supplied_by_caller_and_missing_mapping_denied(self):
        self.assertEqual(self.ask(more={'native_tenant':'demo-b'})[0],422)
        self.binding.delete()
        self.assertEqual(self.ask()[0],403)

    def test_alias_is_derived_from_binding_and_never_crosses_owners(self):
        self.binding.native_tenant='second-seller';self.binding.save()
        self.assertEqual(self.ask()[1]['identity']['native_tenant'],'second-seller')

    def test_oauth_read_validation_does_not_write_owner_data_or_rotate_tokens(self):
        before_families=list(TokenFamily.objects.values())
        from alisa_platform.owner_data.models import CurrentParameter,OwnerCommand
        self.ask();self.ask()
        self.assertEqual(before_families,list(TokenFamily.objects.values()))
        self.assertEqual(CurrentParameter.objects.count(),0)
        self.assertEqual(OwnerCommand.objects.count(),0)

    def test_invalid_client_id_does_not_mint_an_identity(self):
        self.link.client_id='other-client';self.link.save()
        self.assertEqual(self.ask()[0],401)
