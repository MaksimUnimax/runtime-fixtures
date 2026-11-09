"""Source-contract vs exact-period authorization; synthetic metadata only."""
import copy,unittest
from datetime import datetime,timezone
from unittest.mock import patch
from qualification_scope import validate_policy,check_scope,QualificationError
from scalar_runtime import MATRIX,SOURCES
from registry import REGISTRY_HASH
from http_transport import HTTPTransport
from providers import Request
from engine import CallError
NOW=datetime(2026,11,5,6,tzinfo=timezone.utc).timestamp()
STORE={'id':'fixture','identity':'synthetic-cabinet','access_revision':'a1','source_revision':'s1','platform':'ozon','currency':'RUB'}
BODY={'dateFrom':'2026-11-04','dateTo':'2026-11-04'}
POLICY={'schema':'source-contract-scope/v1','period_from_field':'dateFrom','period_to_field':'dateTo','max_period_days':62,'business_timezone':'Europe/Moscow','completed_periods_only':True}

def receipt(source_hash='a'*64):
 return {'campaign_scope':'all_campaigns','response_contract_verified':True,'currency':'RUB','contract_scopes':[{'store_id':STORE['id'],'identity':STORE['identity'],'access_revision':'a1','source_revision':'s1','source_hash':source_hash,'observed_at':NOW-100,'evidence_ref':'synthetic-no-live-credentials'}]}

class ContractScopeTests(unittest.TestCase):
 def setUp(self):
  self.spec={'proof_requirements':{'campaign_scope':'all_campaigns','response_contract_verified':True,'currency':'RUB'},'options':{'qualification_scope':copy.deepcopy(POLICY)}}
  self.proof=receipt();self.body=copy.deepcopy(BODY);self.store=copy.deepcopy(STORE)
 def call(self):return check_scope(self.spec,'a'*64,self.proof,self.store,self.body,NOW)
 def bad(self,code):
  with self.assertRaises(QualificationError) as e:self.call()
  self.assertEqual(e.exception.code,code)
 def test_valid_contract(self):self.assertIsNone(self.call())
 def test_other_completed_period_uses_same_contract(self):self.body={'dateFrom':'2026-10-01','dateTo':'2026-10-31'};self.assertIsNone(self.call())
 def test_store_changed(self):self.store['id']='other';self.bad('SOURCE_PROOF_SCOPE')
 def test_identity_changed(self):self.store['identity']='other';self.bad('SOURCE_PROOF_SCOPE')
 def test_access_changed(self):self.store['access_revision']='a2';self.bad('SOURCE_PROOF_SCOPE')
 def test_source_revision_changed(self):self.store['source_revision']='s2';self.bad('SOURCE_PROOF_SCOPE')
 def test_recipe_changed(self):self.proof['contract_scopes'][0]['source_hash']='b'*64;self.bad('SOURCE_PROOF_VERSION')
 def test_missing_contract(self):self.proof.pop('contract_scopes');self.bad('SOURCE_PROOF_REQUIRED')
 def test_empty_contracts(self):self.proof['contract_scopes']=[];self.bad('SOURCE_PROOF_REQUIRED')
 def test_duplicate_scope(self):self.proof['contract_scopes']*=2;self.bad('SOURCE_PROOF_SCOPE')
 def test_unknown_scope_field(self):self.proof['contract_scopes'][0]['execute']=True;self.bad('SOURCE_PROOF_REQUIRED')
 def test_missing_evidence(self):self.proof['contract_scopes'][0]['evidence_ref']='';self.bad('SOURCE_PROOF_REQUIRED')
 def test_future_evidence(self):self.proof['contract_scopes'][0]['observed_at']=NOW+1;self.bad('SOURCE_PROOF_TIME')
 def test_boolean_evidence_timestamp(self):self.proof['contract_scopes'][0]['observed_at']=True;self.bad('SOURCE_PROOF_TIME')
 def test_nan_evidence(self):self.proof['contract_scopes'][0]['observed_at']=float('nan');self.bad('SOURCE_PROOF_TIME')
 def test_missing_requirement(self):self.proof.pop('response_contract_verified');self.bad('SOURCE_PROOF_REQUIREMENTS')
 def test_boolean_not_number(self):self.proof['response_contract_verified']=1;self.bad('SOURCE_PROOF_REQUIREMENTS')
 def test_selected_not_all(self):self.proof['campaign_scope']='selected';self.bad('SOURCE_PROOF_REQUIREMENTS')
 def test_currency_mismatch_proof(self):self.proof['currency']='USD';self.bad('SOURCE_PROOF_REQUIREMENTS')
 def test_missing_period(self):self.body.pop('dateFrom');self.bad('SOURCE_PROOF_PERIOD')
 def test_noncanonical_date(self):self.body['dateFrom']='2026-1-04';self.bad('SOURCE_PROOF_PERIOD')
 def test_invalid_date(self):self.body['dateFrom']='2026-02-30';self.bad('SOURCE_PROOF_PERIOD')
 def test_inverted_period(self):self.body['dateFrom']='2026-11-05';self.bad('SOURCE_PROOF_PERIOD')
 def test_oversize_period(self):self.body['dateFrom']='2026-01-01';self.bad('SOURCE_PROOF_PERIOD')
 def test_current_day_not_final(self):self.body={'dateFrom':'2026-11-05','dateTo':'2026-11-05'};self.bad('SOURCE_PERIOD_NOT_COMPLETED')
 def test_future_day(self):self.body={'dateFrom':'2026-11-06','dateTo':'2026-11-06'};self.bad('SOURCE_PERIOD_NOT_COMPLETED')
 def test_other_scopes_do_not_widen(self):
  other=copy.deepcopy(self.proof['contract_scopes'][0]);other['store_id']='other';other['identity']='another'
  self.proof['contract_scopes'].append(other);self.assertIsNone(self.call())
 def test_scope_policy_unknown_keys(self):
  p={**POLICY,'bypass':True}
  with self.assertRaises(QualificationError):validate_policy(p)
 def test_policy_unknown_timezone(self):
  with self.assertRaises(QualificationError):validate_policy({**POLICY,'business_timezone':'Not/AZone'})
 def test_policy_boolean_limit(self):
  with self.assertRaises(QualificationError):validate_policy({**POLICY,'max_period_days':True})
 def test_policy_shared_field(self):
  with self.assertRaises(QualificationError):validate_policy({**POLICY,'period_to_field':'dateFrom'})
 def test_legacy_recipe_unaffected(self):self.spec['options']={};self.proof={};self.assertIsNone(self.call())

class TransportContractTests(unittest.TestCase):
 def setUp(self):
  self.op='ozon_ads_daily';self.store=copy.deepcopy(STORE)
  self.proofs={op:{'status':'READ_ONLY_CANARY','registry_hash':REGISTRY_HASH,'scalar_hash':MATRIX.hash,'evidence_ref':'synthetic-only'} for op in SOURCES.sources}
  self.proofs[self.op].update(receipt(SOURCES.fingerprint(self.op)))
  self.transport=HTTPTransport('/no-live-secret-files',{'fixture':'fake'},self.proofs,enabled=True)
  self.req=Request(self.op,'ozon:synthetic:ozon_expense','fixture',copy.deepcopy(BODY),2,100)
 def test_valid_preparation_requires_no_credential(self):
  with patch.object(self.transport,'_credential',side_effect=AssertionError('NO_READ')),patch('time.time',return_value=NOW):
   req=self.transport.prepare(self.req,self.store);self.assertEqual(req.operation,'ozon_ads_token');self.assertEqual(req.body,{})
 def test_scope_rejected_before_secret_or_grant(self):
  self.transport.qualifications[self.op]['contract_scopes'][0]['access_revision']='wrong'
  with patch.object(self.transport,'_credential',side_effect=AssertionError('NO_READ')),patch('time.time',return_value=NOW):
   with self.assertRaises(CallError) as e:self.transport.prepare(self.req,self.store)
   self.assertEqual(e.exception.code,'SOURCE_PROOF_SCOPE')
   with self.assertRaises(CallError) as e:self.transport.execute(self.req,self.store)
   self.assertEqual(e.exception.code,'SOURCE_PROOF_SCOPE')
 def test_proof_missing_before_secret(self):
  self.transport.qualifications[self.op].pop('contract_scopes')
  with patch.object(self.transport,'_credential',side_effect=AssertionError('NO_READ')),patch('time.time',return_value=NOW):
   with self.assertRaises(CallError) as e:self.transport.execute(self.req,self.store)
   self.assertEqual(e.exception.code,'SOURCE_PROOF_REQUIRED')
 def test_refresh_revocation_not_old_snapshot(self):
  current=copy.deepcopy(self.proofs);self.transport.qualification_provider=lambda:current
  with patch('time.time',return_value=NOW):self.assertIsNotNone(self.transport.prepare(self.req,self.store))
  current[self.op]['status']='REVOKED'
  with self.assertRaises(CallError) as e:self.transport.prepare(self.req,self.store)
  self.assertEqual(e.exception.code,'DECODER_NOT_LIVE_QUALIFIED')
 def test_provider_down_fail_closed(self):
  def broken():raise RuntimeError('private internals must not escape')
  self.transport.qualification_provider=broken
  with self.assertRaises(CallError) as e:self.transport.prepare(self.req,self.store)
  self.assertEqual(e.exception.code,'SOURCE_PROOF_UNAVAILABLE')
 def test_provider_wrong_shape_fail_closed(self):
  self.transport.qualification_provider=lambda:[]
  with self.assertRaises(CallError) as e:self.transport.prepare(self.req,self.store)
  self.assertEqual(e.exception.code,'SOURCE_PROOF_UNAVAILABLE')
 def test_time_policy_not_reason_to_read_key(self):
  req=Request(self.op,self.req.source,'fixture',{'dateFrom':'2026-11-05','dateTo':'2026-11-05'},2,100)
  with patch.object(self.transport,'_credential',side_effect=AssertionError('NO_READ')),patch('time.time',return_value=NOW):
   with self.assertRaises(CallError) as e:self.transport.prepare(req,self.store)
   self.assertEqual(e.exception.code,'SOURCE_PERIOD_NOT_COMPLETED')

if __name__=='__main__':unittest.main(verbosity=2)
