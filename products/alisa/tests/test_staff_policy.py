import importlib.util
from pathlib import Path
import unittest
import copy

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('staff_policy',ROOT/'services/platform/src/alisa_platform/staff/policy.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)

class StaffPolicyTests(unittest.TestCase):
    def setUp(self):
        self.now=1000000
        self.member={'product_id':'alisa_market','issuer':'https://id-stage.octoport.ru','client_id':'alisa_admin_stage','active':True,'revision':1,'role':'ADMIN','permissions':['users.read']}
        self.session={'product_id':'alisa_market','revision':1,'revoked':False,'expires_at':self.now+600,'created_at':self.now-60,'mfa_at':self.now-60,'mfa_type':'totp'}
    def allowed(self,permission='users.read'):
        return p.session_allowed(self.member,self.session,issuer='https://id-stage.octoport.ru',client='alisa_admin_stage',now=self.now,permission=permission)
    def test_reader_cannot_block_customer_or_assign_staff(self):
        self.assertTrue(self.allowed());self.assertFalse(self.allowed('users.block'));self.assertFalse(self.allowed('staff.manage'))
    def test_identity_login_without_verified_factor_grants_nothing(self):
        for invalid in [None,'email','password','',{},False]:
            self.session['mfa_type']=invalid;self.assertFalse(self.allowed())
    def test_foreign_product_and_client_do_not_inherit_scope(self):
        for target,key,value in [(self.member,'product_id','other_product'),(self.session,'product_id','other_product'),(self.member,'client_id','alisa_market_stage'),(self.member,'issuer','https://id.octoport.ru')]:
            original=target[key];target[key]=value;self.assertFalse(self.allowed());target[key]=original
    def test_revocation_invalidates_both_previously_valid_sessions(self):
        other=copy.deepcopy(self.session);self.assertTrue(self.allowed());self.member['revision']=2
        self.assertFalse(self.allowed());self.session=other;self.assertFalse(self.allowed())
    def test_disabled_member_and_revoked_session_fail_closed(self):
        self.member['active']=False;self.assertFalse(self.allowed());self.member['active']=True;self.session['revoked']=True;self.assertFalse(self.allowed())
    def test_expiry_and_step_up_are_checked_at_current_time(self):
        self.session['expires_at']=self.now;self.assertFalse(self.allowed());self.session['expires_at']=self.now+600
        for value in [self.now-301,self.now+30,float('nan'),float('inf'),True,'recent']:
            self.session['mfa_at']=value;self.assertFalse(self.allowed())
    def test_recovery_factor_accepted_only_with_same_current_scope(self):
        self.session['mfa_type']='recovery_codes';self.assertTrue(self.allowed());self.member['client_id']='foreign';self.assertFalse(self.allowed())
    def test_owner_has_no_unregistered_or_future_command(self):
        self.member['role']='OWNER';self.assertTrue(self.allowed('staff.manage'))
        for invalid in ['catalog.publish','payments.refund','global.person.block','OWNER',None]:self.assertFalse(self.allowed(invalid))
    def test_admin_cannot_submit_owner_permission_or_opaque_values(self):
        for values in [['staff.manage'],['users.read','users.read'],[{}],[True],None,'users.read']:
            with self.assertRaises(ValueError):p.permissions(values)
    def test_audit_rejects_contact_tokens_raw_query_and_unbounded_reason(self):
        for field in ['email','token','session_token','question','referrer','utm_source']:
            with self.assertRaises(ValueError):p.audit_projection({field:'private-value'})
        for invalid in ['person@example.invalid','https://example.invalid/?code=secret','free-form password',None]:
            with self.assertRaises(ValueError):p.reason(invalid)
        self.assertEqual(p.audit_projection({'active':False,'revision':2}),{'active':False,'revision':2})
    def test_revision_and_identifier_do_not_accept_boolean_or_overflow(self):
        for value in [True,0,-1,1.0,'1',2147483648]:
            with self.assertRaises(ValueError):p.positive_revision(value)
        for value in ['email@example.invalid','owner',None]:
            with self.assertRaises(ValueError):p.identifier(value)
    def test_invalid_role_or_corrupted_permission_snapshot_fails_closed(self):
        self.member['role']='USER';self.assertFalse(self.allowed());self.member['role']='ADMIN';self.member['permissions']=[{}];self.assertFalse(self.allowed())

    def test_session_lifetime_cannot_be_extended_indefinitely(self):
        self.session['expires_at']=self.now+4000;self.assertFalse(self.allowed())
        self.session['expires_at']=self.now+600;self.session['created_at']=self.now-4000;self.assertFalse(self.allowed())
        self.session['created_at']=self.now+30;self.assertFalse(self.allowed())
    def test_block_permission_does_not_allow_unblock(self):
        self.member['permissions']=['users.block'];self.assertTrue(self.allowed('users.block'));self.assertFalse(self.allowed('users.unblock'))
