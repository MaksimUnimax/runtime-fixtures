"""Real OAuth validation + PostgreSQL, synthetic identities only, no providers."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import patch
import json
import secrets

from django.conf import settings
from django.core import signing
from django.db import connections
from django.test import TestCase,TransactionTestCase,RequestFactory,override_settings
from django.utils import timezone
from alisa_platform.accounts.views import digest
from alisa_platform.alice_link.models import AliceLink,TokenFamily
from alisa_platform.alice_link import views,oauth
from alisa_platform.owner_data import parameter_voice as voice,parameter_service as parameters
from alisa_platform.owner_data.models import CurrentParameter,OwnerCommand
from alisa_platform.owner_data.service import Rejected
from alisa_platform.stores.models import Store
from alisa_platform.queries.models import Query,VoiceStorePreference
from .test_parameters import Fixture

OPTIONS=dict(OWNER_PARAMETER_VOICE_ENABLED=True,ALICE_LINK_ENABLED=True,
             ALICE_CLIENT_ID='coefficient-voice-fixture',ALICE_SKILL_ID='test-skill',
             ALISA_ENV='synthetic',QUERIES_ENABLED=True)

class VoiceFixture(Fixture):
    def create_voice(self):
        self.create();now=timezone.now()
        self.link=AliceLink.objects.create(customer=self.customer,tenant=self.tenant,
            client_id=OPTIONS['ALICE_CLIENT_ID'],security_revision=1,
            authorized_at=now,confirmed_at=now)
        self.access='as6_'+secrets.token_urlsafe(32)
        self.family=TokenFamily.objects.create(link=self.link,revision=1,
            access_hash=digest(self.access),refresh_hash=digest('refresh-'+self.access),
            access_expires_at=now+timedelta(minutes=5),refresh_expires_at=now+timedelta(days=1))

    def cabinet(self,enabled=True,revision=0,token=None):
        data={'action':'parameter_permission','session_token':token or self.token,
              'enabled':enabled,'expected_revision':revision,'confirmed':True}
        request=RequestFactory().post('/private/accounts/alice',data=json.dumps(data),
            content_type='application/json',HTTP_AUTHORIZATION='Bearer '+settings.AUTH_SERVICE_TOKEN)
        response=views.handle(request)
        return response.status_code,json.loads(response.content)

    def payload(self,text='установи коэффициент потерь 12 процентов',mid=0,pending=None,sid='voice-session'):
        value={'version':'1.0','session':{'skill_id':settings.ALICE_SKILL_ID,
            'session_id':sid,'message_id':mid,'user':{'access_token':self.access}},
            'request':{'original_utterance':text},'meta':{}}
        if pending is not None:value['state']={'session':{voice.STATE_KEY:pending}}
        return value

    def propose(self,text='установи коэффициент потерь 12 процентов',mid=0):
        reply=voice.handle(self.access,self.payload(text,mid))
        return reply['session_state'][voice.STATE_KEY]

    def confirm(self,pending,mid=1,**kwargs):
        return voice.handle(self.access,self.payload('подтверждаю',mid,pending,**kwargs))

    def assert_denied(self,call,code=None):
        before=list(CurrentParameter.objects.values())
        with self.assertRaises(Rejected) as error:call()
        if code:self.assertEqual(error.exception.code,code)
        self.assertEqual(list(CurrentParameter.objects.values()),before)


@override_settings(**OPTIONS)
class VoiceParameters(VoiceFixture,TestCase):
    def setUp(self):self.create_voice()

    def test_read_scope_does_not_grant_write(self):
        self.assertEqual(oauth.SCOPE,'reports:read')
        self.assert_denied(lambda:self.propose(),'VOICE_PARAMETER_CONSENT_REQUIRED')
        self.assertEqual(CurrentParameter.objects.count(),0)

    def test_cabinet_grants_without_token_rotation_or_relink(self):
        before=list(TokenFamily.objects.values());pk=self.link.pk
        status,body=self.cabinet();self.assertEqual(status,200)
        self.assertEqual(body['alice']['parameter_writes'],{'enabled':True,'revision':1})
        self.link.refresh_from_db();self.assertEqual(self.link.pk,pk);self.assertEqual(self.link.revision,1)
        self.assertEqual(list(TokenFamily.objects.values()),before)

    def test_voice_token_cannot_grant_itself_cabinet_permission(self):
        self.assertEqual(self.cabinet(token=self.access)[0],401)
        self.link.refresh_from_db();self.assertFalse(voice.permission(self.link)['enabled'])

    def test_grant_stale_revision_is_not_overwritten(self):
        self.assertEqual(self.cabinet()[0],200)
        self.assertEqual(self.cabinet(False,0)[0],409)
        self.link.refresh_from_db();self.assertTrue(voice.permission(self.link)['enabled'])

    def test_revoked_cabinet_session_cannot_grant(self):
        self.session.revoked_at=timezone.now();self.session.save()
        self.assertEqual(self.cabinet()[0],401)

    def test_feature_off_preserves_old_projection_and_voice_behavior(self):
        with override_settings(OWNER_PARAMETER_VOICE_ENABLED=False):
            self.assertIsNone(voice.handle(self.access,self.payload()))
            self.assertNotIn('parameter_writes',views.projection(self.link))
            self.assertEqual(self.cabinet()[0],404)

    def test_unconfirmed_link_is_not_write_permission(self):
        self.link.confirmed_at=None;self.link.save()
        self.assertEqual(self.cabinet()[0],409)

    def test_proposal_does_not_write_or_create_query(self):
        self.cabinet();pending=self.propose()
        self.assertTrue(pending);self.assertEqual(CurrentParameter.objects.count(),0)
        self.assertEqual(OwnerCommand.objects.count(),0);self.assertEqual(Query.objects.count(),0)
        self.assertNotIn(self.access,pending);self.assertNotIn(self.token,pending)

    def test_confirm_uses_same_current_parameter_and_metadata_receipt(self):
        self.cabinet();pending=self.propose();result=self.confirm(pending)
        self.assertIn('сохранён',result['response']['text']);self.assertIsNone(result['session_state'][voice.STATE_KEY])
        row=self.read()['current'];self.assertEqual(row['value'],'0.12');self.assertEqual(row['origin'],'manual')
        self.assertIsNone(row['actual_period']);self.assertEqual(row['evidence'],{})
        receipt=OwnerCommand.objects.get().result
        self.assertNotIn('value',receipt);self.assertEqual(receipt['action'],'set_manual')

    def test_actual_webhook_routes_manual_before_query_submission(self):
        self.cabinet()
        with patch('alisa_platform.queries.voice.handle',side_effect=AssertionError('no report submission')):
            response=views.webhook({'action':'webhook','payload':self.payload(),'authorization':''})
            pending=json.loads(response.content)['skill_response']['session_state'][voice.STATE_KEY]
            response=views.webhook({'action':'webhook','payload':self.payload('подтверждаю',1,pending),'authorization':''})
        self.assertIn('сохранён',json.loads(response.content)['skill_response']['response']['text'])
        self.assertEqual(self.read()['effective']['value'],'0.12');self.assertEqual(Query.objects.count(),0)

    def test_zero_is_saved_not_missing(self):
        self.cabinet();self.confirm(self.propose('установи коэффициент потерь 0 процентов'))
        self.assertEqual(self.read()['effective']['value'],'0')

    def test_decimal_comma_and_generic_currency_parameter(self):
        self.cabinet();self.confirm(self.propose('запиши среднюю доставку 101,25 рублей'))
        row=CurrentParameter.objects.get();self.assertEqual(row.key,'delivery_mean')
        self.assertEqual(row.value,'101.25');self.assertEqual(row.unit,'RUB/ordered_unit')

    def test_duplicate_confirmation_has_one_effect(self):
        self.cabinet();pending=self.propose();self.confirm(pending);self.confirm(pending,mid=2)
        self.assertEqual(CurrentParameter.objects.get().revision,1)
        self.assertEqual(OwnerCommand.objects.count(),1)

    def test_lost_response_after_commit_can_repeat_same_confirmation(self):
        self.cabinet();pending=self.propose();self.confirm(pending)
        reply=self.confirm(pending)
        self.assertIn('сохранён',reply['response']['text']);self.assertEqual(CurrentParameter.objects.get().revision,1)

    def test_replayed_old_confirmation_does_not_restore_old_number(self):
        self.cabinet();pending=self.propose();self.confirm(pending);self.save('0.4',1)
        reply=self.confirm(pending,mid=2)
        self.assertIn('уже была выполнена',reply['response']['text'])
        self.assertEqual(self.read()['effective']['value'],'0.4')

    def test_cabinet_edit_between_propose_and_confirm_wins(self):
        self.cabinet();pending=self.propose();self.save('0.25')
        self.assert_denied(lambda:self.confirm(pending),'PARAMETER_REVISION_CONFLICT')
        self.assertEqual(self.read()['effective']['value'],'0.25')

    def test_cancel_does_not_write(self):
        self.cabinet();pending=self.propose()
        result=voice.handle(self.access,self.payload('отмена',1,pending))
        self.assertIsNone(result['session_state'][voice.STATE_KEY]);self.assertEqual(CurrentParameter.objects.count(),0)

    def test_ambiguous_confirmation_discards_intent(self):
        self.cabinet();pending=self.propose()
        result=voice.handle(self.access,self.payload('пожалуй наверное',1,pending))
        self.assertIsNone(result['session_state'][voice.STATE_KEY]);self.assertEqual(CurrentParameter.objects.count(),0)

    def test_forged_confirmation_rejected(self):
        self.cabinet();pending=self.propose()
        self.assert_denied(lambda:self.confirm(pending+'x'),'PARAMETER_VOICE_CONFIRMATION_EXPIRED')

    def test_expired_intent_is_not_write(self):
        self.cabinet();pending=self.propose()
        with patch('django.core.signing.time.time',return_value=timezone.now().timestamp()+121):
            self.assert_denied(lambda:self.confirm(pending),'PARAMETER_VOICE_CONFIRMATION_EXPIRED')

    def test_other_dialogue_cannot_confirm(self):
        self.cabinet();pending=self.propose()
        self.assert_denied(lambda:self.confirm(pending,sid='other'),'PARAMETER_VOICE_CONFIRMATION_CHANGED')

    def test_same_original_message_cannot_be_confirmation(self):
        self.cabinet();pending=self.propose()
        self.assert_denied(lambda:self.confirm(pending,mid=0),'PARAMETER_VOICE_CONFIRMATION_CHANGED')

    def test_permission_revocation_invalidates_pending(self):
        self.cabinet();pending=self.propose();self.assertEqual(self.cabinet(False,1)[0],200)
        self.assert_denied(lambda:self.confirm(pending),'VOICE_PARAMETER_CONSENT_REQUIRED')

    def test_disable_then_reenable_does_not_revive_pending(self):
        self.cabinet();pending=self.propose();self.cabinet(False,1);self.cabinet(True,2)
        self.assert_denied(lambda:self.confirm(pending),'PARAMETER_VOICE_CONFIRMATION_CHANGED')

    def test_access_token_revocation_prevents_write(self):
        self.cabinet();pending=self.propose();self.family.revoked_at=timezone.now();self.family.save()
        self.assert_denied(lambda:self.confirm(pending),'AUTH_REQUIRED')

    def test_security_revision_change_prevents_write(self):
        self.cabinet();pending=self.propose();self.customer.security_revision+=1;self.customer.save()
        self.assert_denied(lambda:self.confirm(pending),'AUTH_REQUIRED')

    def test_link_rebinding_invalidates_consent(self):
        self.cabinet();pending=self.propose();self.link.revision+=1;self.link.save()
        self.family.revision=self.link.revision;self.family.save()
        self.assert_denied(lambda:self.confirm(pending),'VOICE_PARAMETER_CONSENT_REQUIRED')

    def test_changed_store_blocks_pending(self):
        self.cabinet();pending=self.propose();self.store.revision+=1;self.store.save()
        self.assert_denied(lambda:self.confirm(pending),'PARAMETER_VOICE_CONFIRMATION_CHANGED')

    def test_disabled_store_cannot_receive_write(self):
        self.cabinet();pending=self.propose();self.store.status='DISABLED';self.store.save()
        self.assert_denied(lambda:self.confirm(pending),'OWNER_SOURCE_STORE_DISABLED')

    def test_multi_store_requires_alias_or_existing_preference(self):
        self.cabinet();Store.objects.create(tenant=self.tenant,provider='OZON',name='Second',verified_identity='second')
        self.assert_denied(lambda:self.propose(),'VOICE_STORE_SELECTION_REQUIRED')
        pending=self.propose('установи коэффициент потерь 12 процентов в магазине Synthetic store')
        self.confirm(pending);self.assertEqual(CurrentParameter.objects.get().store_id,self.store.pk)

    def test_existing_store_preference_used_without_rewriting_it(self):
        self.cabinet();Store.objects.create(tenant=self.tenant,provider='OZON',name='Second',verified_identity='second')
        pref=VoiceStorePreference.objects.create(customer=self.customer,tenant=self.tenant,store=self.store)
        before=pref.updated_at;self.confirm(self.propose());pref.refresh_from_db()
        self.assertEqual(pref.updated_at,before);self.assertEqual(CurrentParameter.objects.get().store_id,self.store.pk)

    def test_privacy_does_not_speak_proposed_or_current_number(self):
        self.cabinet();self.save('0.25789');reply=voice.handle(self.access,self.payload('установи коэффициент потерь 12 процентов'))
        self.assertNotIn('12',reply['response']['text']);self.assertNotIn('25',reply['response']['text'])
        self.assertIn('указанное значение',reply['response']['text'])

    def test_without_privacy_confirmation_echoes_only_proposed_value(self):
        self.link.voice_private=False;self.link.save();self.cabinet()
        reply=voice.handle(self.access,self.payload('установи коэффициент потерь 12,5 процентов'))
        self.assertIn('12,5 процентов',reply['response']['text'])

    def test_units_range_and_non_numeric_commands_do_not_write(self):
        self.cabinet()
        for text in ('установи коэффициент потерь 101 процентов','установи коэффициент потерь 12',
                     'установи коэффициент потерь -1 процентов','установи среднюю доставку NaN рублей'):
            with self.subTest(text=text):
                response=voice.dispatch(self.access,self.payload(text))
                self.assertIsNotNone(response);self.assertEqual(CurrentParameter.objects.count(),0)

    def test_other_oauth_client_cannot_use_grant_here(self):
        self.cabinet();pending=self.propose();self.link.client_id='another-client';self.link.save()
        self.assert_denied(lambda:self.confirm(pending),'AUTH_REQUIRED')

    def test_cancel_after_an_earlier_commit_does_not_claim_rollback(self):
        self.cabinet();pending=self.propose();self.confirm(pending)
        result=voice.handle(self.access,self.payload('отмена',2,pending))
        self.assertIn('не откатывает',result['response']['text'])
        self.assertEqual(self.read()['effective']['value'],'0.12')

    def test_normal_report_still_uses_existing_handler(self):
        self.assertIsNone(voice.handle(self.access,self.payload('сколько заказов вчера')))


@override_settings(**OPTIONS)
class VoiceConcurrency(VoiceFixture,TransactionTestCase):
    def setUp(self):self.create_voice();self.cabinet()

    def test_two_simultaneous_confirmations_commit_once(self):
        pending=self.propose();barrier=Barrier(2)
        def send():
            try:
                barrier.wait(timeout=5)
                return self.confirm(pending)['response']['text']
            finally:connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures=[pool.submit(send) for _ in range(2)]
            replies=[f.result(timeout=10) for f in futures]
        self.assertTrue(all('сохранён' in x for x in replies))
        self.assertEqual(CurrentParameter.objects.get().revision,1)
        self.assertEqual(OwnerCommand.objects.count(),1)


@override_settings(**OPTIONS)
class VoiceMigration(VoiceFixture,TransactionTestCase):
    def setUp(self):self.create_voice()

    def test_additive_migration_and_old_writer_keep_current_values(self):
        from django.db import connection
        from django.db.migrations.executor import MigrationExecutor
        self.save('0.21');before=list(CurrentParameter.objects.values())
        executor=MigrationExecutor(connection)
        executor.migrate([('alice_link','0001_initial')])
        try:
            historical=executor.loader.project_state([('alice_link','0001_initial')]).apps
            old_model=historical.get_model('alice_link','AliceLink')
            old=old_model.objects.create(customer_id=self.customer.pk,tenant_id=self.tenant.pk,
                client_id='historical-before-upgrade',security_revision=1)
        finally:
            MigrationExecutor(connection).migrate([('alice_link','0002_parameter_voice_consent')])
        current=AliceLink.objects.get(pk=old.pk)
        self.assertEqual(current.parameter_write_binding_revision,0)
        self.assertIsNone(current.parameter_write_consented_at)
        # The old ORM does not send newly added columns: DB defaults preserve
        # old-writer compatibility without granting any voice-write capability.
        old2=old_model.objects.create(customer_id=self.customer.pk,tenant_id=self.tenant.pk,
            client_id='historical-after-upgrade',security_revision=1)
        self.assertEqual(AliceLink.objects.get(pk=old2.pk).parameter_write_consent_revision,0)
        self.assertEqual(list(CurrentParameter.objects.values()),before)
