"""Focused exact-source Station bridging tests; no live server/database/network."""
import hashlib
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import service
import station_oauth
import station_authority
import station_client
import lab_oauth

TOKEN='as6_SYNTHETIC_NOT_REAL_ACCESS_TOKEN'
VALID={'owner':'owner-uuid-test','native_tenant':'demo-a','platform_tenant':'tenant-uuid-test'}


class FakeDelivery:
    def __init__(self):
        self.state={'binding':{'tenant':'demo-a','application':'fixture-app'},
                    'owner':'owner-uuid-test','settings':{'enabled':True}}
        self.calls=[]
    def ingress(self,body,oauth_identity=None):
        self.calls.append((body,oauth_identity))
        return {'reply':'fixture'}
    def configure(self,body):raise AssertionError('Existing Station settings changed')


class OAuthStationBridge(unittest.TestCase):
    def setUp(self):
        self.delivery=FakeDelivery()
        self.registry=object.__new__(service.Registry)
        self.registry.lock=threading.RLock()
        self.registry.users={'owner-uuid-test':self.delivery}
        self.registry.policy=SimpleNamespace(state={'settings':self.delivery.state['settings']})
        self.registry.pair_fail={}

    def message(self,modern=True):
        v={'op':'before','tenant':'demo-a','application':'fixture-app',
           'token_hash':hashlib.sha256(TOKEN.encode()).hexdigest(),
           'command':'установи коэффициент потерь 12 процентов',
           'conversation':'fixture-conversation','rid':'fixture-rid','message_id':0}
        if modern:v['oauth_token']=TOKEN
        return v

    def test_existing_legacy_route_is_exact_one_positional_argument(self):
        with patch.object(station_oauth,'owner',side_effect=AssertionError('legacy must not call platform')):
            self.assertEqual(self.registry.ingress(self.message(False)),{'reply':'fixture'})
        value,verified=self.delivery.calls[0]
        self.assertEqual(verified,None)
        self.assertNotIn('oauth_token',value)

    def test_real_new_token_uses_existing_station_identity_and_scrubs_token(self):
        with patch.object(station_oauth,'owner',return_value=VALID):
            self.assertEqual(self.registry.ingress({'op':'oauth_identity','access_token':TOKEN}),{'native_tenant':'demo-a'})
            self.assertEqual(self.registry.ingress(self.message(True)),{'reply':'fixture'})
        forwarded,identity=self.delivery.calls[0]
        self.assertEqual(identity,VALID)
        self.assertNotIn('oauth_token',forwarded)
        self.assertEqual(forwarded['token_hash'],hashlib.sha256(TOKEN.encode()).hexdigest())

    def test_wrong_hash_rejected_before_mutating_station_state(self):
        changed=self.message(True);changed['token_hash']='a'*64
        with patch.object(station_oauth,'owner',return_value=VALID),self.assertRaises(service.Fault):
            self.registry.ingress(changed)
        self.assertEqual(self.delivery.calls,[])

    def test_cross_owner_binding_does_not_map_to_existing_device(self):
        with patch.object(station_oauth,'owner',return_value={**VALID,'owner':'other-owner'}),self.assertRaises(service.Fault):
            self.registry.ingress({'op':'oauth_identity','access_token':TOKEN})

    def test_owner_validation_occurs_before_registry_lock(self):
        held=[False]
        class Guard:
            def __enter__(self):held[0]=True
            def __exit__(self,*args):held[0]=False
        self.registry.lock=Guard()
        def valid(token):
            self.assertFalse(held[0],'Platform reverse callback under Station lock')
            return VALID
        with patch.object(station_oauth,'owner',side_effect=valid):
            self.assertEqual(self.registry.ingress(self.message(True)),{'reply':'fixture'})

    def test_delivery_does_not_accept_identity_for_other_owner(self):
        instance=object.__new__(service.Delivery)
        instance.lock=threading.RLock()
        instance.state=dict(self.delivery.state)
        instance.auth=lambda *args:False
        with self.assertRaises(service.Fault) as result:
            instance.ingress(self.message(False),oauth_identity={**VALID,'owner':'other-owner'})
        self.assertEqual(result.exception.code,'voice_revoked')

    def test_lab_modern_mapping_is_still_station_bound(self):
        with patch.object(station_client,'call',return_value={'native_tenant':'demo-a'}) as call:
            self.assertEqual(lab_oauth.account(TOKEN),'demo-a')
        call.assert_called_once()
        self.assertEqual(call.call_args.kwargs['timeout'],2.8)

    def test_lab_missing_or_rejected_identity_fails_closed(self):
        self.assertIsNone(lab_oauth.account('legacy-token'))
        with patch.object(station_client,'call',return_value={'error':'voice_revoked'}):
            self.assertIsNone(lab_oauth.account(TOKEN))
        with patch.object(station_client,'call',side_effect=TimeoutError()):
            self.assertIsNone(lab_oauth.account(TOKEN))

    def test_station_owner_verifier_returns_no_tenant_on_upstream_reject(self):
        with patch.object(station_oauth,'platform',return_value={'rejected':True}),self.assertRaises(station_oauth.InvalidOAuth):
            station_oauth.owner(TOKEN)

    def test_modern_immutable_voice_receipt_checks_current_platform_token(self):
        from types import SimpleNamespace
        data={'owner':'owner-uuid-test','binding':{'tenant':'demo-a','application':'fixture-app'},
              'selected':{'id':'speaker'},'trigger':'fixed','voice_binding_revision':1}
        delivery=SimpleNamespace(state=data,clock=lambda:1000,
              auth=lambda *args: (_ for _ in ()).throw(AssertionError('legacy database must NOT be used')))
        turn={'at':999,'voice_auth':{'token_hash':'a'*64,'binding':station_authority.binding_id(delivery),'scheme':'modern'}}
        with patch.object(station_oauth,'current',return_value=True) as current:
            self.assertTrue(station_authority.usable(delivery,turn))
        current.assert_called_once_with('owner-uuid-test','demo-a','a'*64)
        with patch.object(station_oauth,'current',return_value=False):
            self.assertFalse(station_authority.usable(delivery,turn))

    def test_legacy_immutable_receipt_keeps_old_auth_path(self):
        data={'owner':'owner-uuid-test','binding':{'tenant':'demo-a','application':'fixture-app'},
              'selected':{'id':'speaker'},'trigger':'fixed','voice_binding_revision':1}
        delivery=SimpleNamespace(state=data,clock=lambda:1000,auth=lambda *args:True)
        turn={'at':999,'voice_auth':{'token_hash':'a'*64,'binding':station_authority.binding_id(delivery)}}
        with patch.object(station_oauth,'current',side_effect=AssertionError('must not check modern')):
            self.assertTrue(station_authority.usable(delivery,turn))

    def test_modern_currentness_fails_closed_on_missing_or_bad_reply(self):
        with patch.object(station_oauth,'platform',return_value={'current':True}):
            self.assertTrue(station_oauth.current('owner-uuid-test','demo-a','a'*64))
        for value in ({'current':False},{'error':'unavailable'},None):
            with patch.object(station_oauth,'platform',return_value=value):
                self.assertFalse(station_oauth.current('owner-uuid-test','demo-a','a'*64))
        with patch.object(station_oauth,'platform',side_effect=TimeoutError()):
            self.assertFalse(station_oauth.current('owner-uuid-test','demo-a','a'*64))

    def test_real_platform_envelope_still_checks_identity_and_current_access(self):
        envelope={'environment':'stage','release':'test-disposable'}
        with patch.object(station_oauth,'platform',return_value={**envelope,'identity':VALID}):
            self.assertEqual(station_oauth.owner(TOKEN),VALID)
        with patch.object(station_oauth,'platform',return_value={**envelope,'current':True}):
            self.assertTrue(station_oauth.current('owner-uuid-test','demo-a','a'*64))
        with patch.object(station_oauth,'platform',return_value={**envelope,'current':False}):
            self.assertFalse(station_oauth.current('owner-uuid-test','demo-a','a'*64))
        with patch.object(station_oauth,'platform',return_value={**envelope,'current':True,'unexpected':1}):
            self.assertFalse(station_oauth.current('owner-uuid-test','demo-a','a'*64))

    def test_station_owner_verifier_matches_exact_provenance(self):
        with patch.object(station_oauth,'platform',return_value={'identity':VALID}):
            self.assertEqual(station_oauth.owner(TOKEN),VALID)


if __name__=='__main__':unittest.main()
