import copy,json,time,unittest
from pathlib import Path
from unittest.mock import patch
from qualification_scope import check_scope,validate_policy,QualificationError
from matrix_sources import SourceMatrix
from matrix_core import MatrixError
from scalar_runtime import SOURCES
from engine import CallError
from http_transport import HTTPTransport
import http_transport as transport_module
import providers
NOW=2000000000.
POLICY={'schema':'exact-source-scope/v1','period_from_field':'dateFrom','period_to_field':'dateTo','maximum_age_seconds':3600}
STORE={'id':'fixture','identity':'synthetic-account','access_revision':'a','source_revision':'s','platform':'ozon','currency':'RUB'}
BODY={'dateFrom':'2030-01-02','dateTo':'2030-01-02'}
def proof():
 return {'coverage_qualified':True,'scope':{'store_id':'fixture','identity':'synthetic-account','access_revision':'a','source_revision':'s','source_hash':'a'*64,'period':{'from':'2030-01-02','to':'2030-01-02'},'observed_at':NOW-10,'expires_at':NOW+60,'evidence_ref':'fixture-only'}}
class SourceProofTests(unittest.TestCase):
 def setUp(self):
  self.spec={'options':{'qualification_scope':copy.deepcopy(POLICY)},'proof_requirements':{'coverage_qualified':True}}
  self.proof=proof();self.store=copy.deepcopy(STORE);self.body=copy.deepcopy(BODY)
 def call(self):return check_scope(self.spec,'a'*64,self.proof,self.store,self.body,NOW)
 def bad(self,code):
  with self.assertRaises(QualificationError) as e:self.call()
  self.assertEqual(e.exception.code,code)
 def test_matching(self):self.assertIsNone(self.call())
 def test_legacy_opt_in_only(self):self.spec['options']={};self.proof={};self.assertIsNone(self.call())
 def test_missing_proof(self):self.proof={};self.bad('SOURCE_PROOF_REQUIREMENTS')
 def test_bool_not_integer_proof(self):self.proof['coverage_qualified']=1;self.bad('SOURCE_PROOF_REQUIREMENTS')
 def test_false_proof(self):self.proof['coverage_qualified']=False;self.bad('SOURCE_PROOF_REQUIREMENTS')
 def test_missing_scope(self):del self.proof['scope'];self.bad('SOURCE_PROOF_REQUIRED')
 def test_extra_scope_field(self):self.proof['scope']['extra']='yes';self.bad('SOURCE_PROOF_REQUIRED')
 def test_store(self):self.proof['scope']['store_id']='another';self.bad('SOURCE_PROOF_SCOPE')
 def test_identity(self):self.proof['scope']['identity']='another';self.bad('SOURCE_PROOF_SCOPE')
 def test_access_revision(self):self.store['access_revision']='revoked';self.bad('SOURCE_PROOF_SCOPE')
 def test_source_revision(self):self.store['source_revision']='rotated';self.bad('SOURCE_PROOF_SCOPE')
 def test_source_hash(self):self.proof['scope']['source_hash']='b'*64;self.bad('SOURCE_PROOF_VERSION')
 def test_period(self):self.body['dateTo']='2030-01-03';self.bad('SOURCE_PROOF_PERIOD')
 def test_broad_period_not_inferred(self):self.proof['scope']['period']['from']='2030-01-01';self.bad('SOURCE_PROOF_PERIOD')
 def test_invalid_iso(self):self.proof['scope']['period']['from']='2030-1-02';self.bad('SOURCE_PROOF_PERIOD')
 def test_reverse_period(self):self.proof['scope']['period']['from']='2030-01-03';self.bad('SOURCE_PROOF_PERIOD')
 def test_missing_evidence(self):self.proof['scope']['evidence_ref']='';self.bad('SOURCE_PROOF_REQUIRED')
 def test_expired(self):self.proof['scope']['expires_at']=NOW;self.bad('SOURCE_PROOF_EXPIRED')
 def test_future_observation(self):self.proof['scope']['observed_at']=NOW+1;self.bad('SOURCE_PROOF_EXPIRED')
 def test_excess_ttl(self):self.proof['scope']['expires_at']=NOW+7200;self.bad('SOURCE_PROOF_EXPIRED')
 def test_nan_clock(self):
  with self.assertRaises(QualificationError):check_scope(self.spec,'a'*64,self.proof,self.store,self.body,float('nan'))
 def test_bool_time(self):self.proof['scope']['expires_at']=True;self.bad('SOURCE_PROOF_TIME')
 def test_policy_invalid_key(self):self.spec['options']['qualification_scope']['extra']=True;self.bad('SOURCE_PROOF_POLICY')
 def test_policy_field_not_identifier(self):self.spec['options']['qualification_scope']['period_to_field']='a.b';self.bad('SOURCE_PROOF_POLICY')
 def test_policy_fields_same(self):self.spec['options']['qualification_scope']['period_to_field']='dateFrom';self.bad('SOURCE_PROOF_POLICY')
 def test_policy_bool_ttl(self):self.spec['options']['qualification_scope']['maximum_age_seconds']=True;self.bad('SOURCE_PROOF_POLICY')
 def test_matrix_accepts_optional_scope(self):
  definition=SOURCES.definition;definition['sources']['ozon_expense']['options']['qualification_scope']=POLICY
  self.assertIn('qualification_scope',SourceMatrix(definition).recipe('ozon_expense')['options'])
 def test_matrix_rejects_bad_scope_schema(self):
  definition=SOURCES.definition;definition['sources']['ozon_expense']['options']['qualification_scope']={}
  with self.assertRaises(MatrixError):SourceMatrix(definition)
 def transport(self):
  definition=SOURCES.definition;definition['sources']['ozon_expense']['options']['qualification_scope']=POLICY
  matrix=SourceMatrix(definition)
  request=providers.Request('ozon_expense','ozon:synthetic-account:ozon_expense','fixture',BODY,2,100)
  transport=HTTPTransport('/nonexistent',{'fixture':'unused'}, {},enabled=True)
  return transport,matrix,request
 def test_prepare_fails_before_grant_or_credentials(self):
  t,m,r=self.transport()
  with patch.object(t,'_qualification',return_value=m),patch.object(t,'_credential',side_effect=AssertionError('secret read')):
   with self.assertRaises(CallError) as e:t.prepare(r,STORE)
  self.assertEqual(e.exception.code,'SOURCE_PROOF_REQUIRED')
 def test_execute_fails_before_credentials_or_http(self):
  t,m,r=self.transport()
  with patch.object(t,'_qualification',return_value=m),patch.object(t,'_credential',side_effect=AssertionError('secret read')),patch('urllib.request.build_opener',side_effect=AssertionError('HTTP attempted')):
   with self.assertRaises(CallError) as e:t.execute(r,STORE)
  self.assertEqual(e.exception.code,'SOURCE_PROOF_REQUIRED')
if __name__=='__main__':unittest.main()
