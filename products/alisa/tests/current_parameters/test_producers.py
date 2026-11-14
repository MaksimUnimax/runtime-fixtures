from datetime import date,datetime,timedelta,timezone
from copy import deepcopy
from decimal import Decimal
import json,hashlib
from unittest import TestCase
from django.test import TestCase as DBTestCase
from django.utils import timezone as djtime
from alisa_platform.owner_data import parameter_producers as p,parameter_contract as c,parameter_job as job
from alisa_platform.owner_data.models import CurrentParameter,OwnerCommand
from alisa_platform.owner_data.service import Rejected
from .test_parameters import Fixture,PERIOD,AREA

NOW=datetime(2026,11,14,6,tzinfo=timezone.utc)
ASOF='2026-11-14T00:00:00+00:00'
TARGET={'tenant_id':'tenant','store_id':'store','provider':'OZON','scope':deepcopy(AREA)}

def batch(source,rows,scheme=None,period=None,target=None,tag='0',boundaries=None):
 return {'source':source,'target':deepcopy(target or TARGET),'period':deepcopy(period or(PERIOD['actual']if source!='returns'else{'from':'2025-11-14','to':'2026-11-14'})),
         'scheme':scheme,'axis':p.CATALOG['sources'][source]['axis'],'collected_at':ASOF,'observed_until':ASOF,
         'complete':True,'terminal':True,'rows':deepcopy(rows),'boundaries':deepcopy(boundaries or[]),'receipt_hash':hashlib.sha256((source+str(scheme)+tag).encode()).hexdigest()}

def sources(target=None):
 target=target or TARGET
 orders=[{'scheme':'FBO','posting':'one','sku':'10','day':'2026-05-01','units':2,'state':'cancelled'},
         {'scheme':'FBO','posting':'two','sku':'11','day':'2026-05-02','units':3,'state':'delivered'},
         {'scheme':'FBO','posting':'three','sku':'10','day':'2026-05-03','units':1,'state':'pending'}]
 returns=[{'scheme':'FBO','posting':'one','sku':'10','exemplars':['101'],'type':'Cancellation'},
          {'scheme':'FBO','posting':'two','sku':'11','exemplars':['201'],'type':'ClientReturn'}]
 return {'orders':[batch('orders',orders,'FBO',target=target),batch('orders',[],'FBS',target=target)],'returns':[batch('returns',returns,target=target)]}

class Producers(TestCase):
 def make(self,data=None,key='loss_rate',target=None,verify=None,period=None):return p.produce(key,target or TARGET,period or deepcopy(PERIOD),data or sources(),verify=verify or(lambda *a:True),as_of=ASOF,now=NOW)
 def test_union_cancellation_and_return_not_double(self):
  r=self.make();self.assertEqual(json.loads(r.envelope_json)['inputs'],{'failed_units':'3','ordered_units':'6'})
 def test_pending_separate(self):self.assertEqual(json.loads(self.make().proof_json)['controls']['pending_units'],'1')
 def test_duplicate_return_exemplars_not_double(self):
  d=sources();d['returns'][0]['rows']+=deepcopy(d['returns'][0]['rows']);r=self.make(d);self.assertEqual(json.loads(r.envelope_json)['inputs']['failed_units'],'3');self.assertEqual(json.loads(r.proof_json)['controls']['duplicate_return_exemplars'],'2')
 def test_identical_duplicate_order_not_double(self):
  d=sources();d['orders'][0]['rows']+=deepcopy(d['orders'][0]['rows'][:1]);r=self.make(d);self.assertEqual(json.loads(r.envelope_json)['inputs']['ordered_units'],'6')
 def test_conflicting_order_duplicate_blocks(self):
  d=sources();x=deepcopy(d['orders'][0]['rows'][0]);x['units']=3;d['orders'][0]['rows'].append(x)
  with self.assertRaises(c.ParameterError):self.make(d)
 def test_return_over_quantity_not_capped(self):
  d=sources();d['returns'][0]['rows'][0]['exemplars']=['101','102','103']
  with self.assertRaises(c.ParameterError):self.make(d)
 def test_unmatched_return_requires_boundary(self):
  d=sources();d['returns'][0]['rows'][0]['posting']='outside'
  with self.assertRaises(c.ParameterError)as e:self.make(d)
  self.assertEqual(e.exception.code,'PARAMETER_RETURN_BOUNDARY_REQUIRED')
 def test_proven_outside_cohort_ignored(self):
  d=sources();d['returns'][0]['rows'].append({'scheme':'FBO','posting':'outside','sku':'99','exemplars':['900'],'type':'Cancellation'});d['returns'][0]['boundaries']=[{'scheme':'FBO','posting':'outside','sku':'99','day':'2025-10-01'}]
  self.assertEqual(json.loads(self.make(d).envelope_json)['inputs']['failed_units'],'3')
 def test_boundary_inside_cohort_cannot_be_excluded(self):
  d=sources();d['returns'][0]['boundaries']=[{'scheme':'FBO','posting':'outside','sku':'99','day':'2026-02-01'}]
  with self.assertRaises(c.ParameterError):self.make(d)
 def test_one_missing_fbs_report_denies_completeness(self):
  d=sources();d['orders'].pop()
  with self.assertRaises(c.ParameterError):self.make(d)
 def test_missing_mid_period_not_short_history(self):
  d=sources();d['orders'][0]['period']['from']='2026-02-01'
  with self.assertRaises(c.ParameterError):self.make(d)
 def test_false_terminal_denied(self):
  d=sources();d['returns'][0]['terminal']=False
  with self.assertRaises(c.ParameterError):self.make(d)
 def test_refused_receipt_denied_despite_complete_flag(self):
  with self.assertRaises(c.ParameterError):self.make(verify=lambda *a:False)
 def test_wrong_store_source_refused(self):
  d=sources();d['orders'][0]['target']['store_id']='foreign'
  with self.assertRaises(c.ParameterError):self.make(d)
 def test_wrong_axis_refused(self):
  d=sources();d['orders'][0]['axis']='created_at'
  with self.assertRaises(c.ParameterError):self.make(d)
 def test_old_return_observation_refused(self):
  d=sources();d['returns'][0]['observed_until']='2026-11-01T00:00:00Z'
  with self.assertRaises(c.ParameterError):self.make(d)
 def test_returns_must_cover_after_cohort_until_asof(self):
  d=sources();d['returns'][0]['period']['to']='2026-11-13'
  with self.assertRaises(c.ParameterError):self.make(d)
 def test_sku_scope_is_not_simple_mean(self):
  target=deepcopy(TARGET);target['scope']={'kind':'sku','sku':'11'};r=self.make(sources(target),target=target)
  self.assertEqual(json.loads(r.envelope_json)['inputs'],{'failed_units':'1','ordered_units':'3'})
 def test_derived_value_not_rounded_for_display(self):
  target=deepcopy(TARGET);target['scope']={'kind':'sku','sku':'11'};r=self.make(sources(target),target=target);v=c.validate_calculation('loss_rate',json.loads(r.envelope_json),target,PERIOD,NOW,r.verify)
  self.assertTrue(v.value.startswith('0.333333333333333333333333'))
 def test_changed_candidate_cannot_use_attestation(self):
  r=self.make();env=json.loads(r.envelope_json);env['inputs']['failed_units']='1';self.assertFalse(r.verify(TARGET,PERIOD,env))
 def test_empty_cohort_not_zero_ratio(self):
  d=sources();d['orders'][0]['rows']=[];d['returns'][0]['rows']=[]
  with self.assertRaises(c.ParameterError):self.make(d)
 def test_unknown_state_not_guessed(self):
  d=sources();d['orders'][0]['rows'][0]['state']='something-new'
  with self.assertRaises(c.ParameterError):self.make(d)
 def test_zero_losses_are_valid(self):
  d=sources();d['orders'][0]['rows'][0]['state']='delivered';d['returns'][0]['rows']=[]
  self.assertEqual(json.loads(self.make(d).envelope_json)['inputs']['failed_units'],'0')
 def test_delivery_signed_adjustments_not_abs(self):
  d=sources();d.pop('returns');d['finance']=[batch('finance',[{'component':'logistics','amount':'-100','currency':'RUB'},{'component':'logistics','amount':'10','currency':'RUB'},{'component':'courier_client_reinvoice','amount':'-30','currency':'RUB'},{'component':'reverse_logistics','amount':'-999','currency':'RUB'}])]
  r=self.make(d,key='delivery_mean');self.assertEqual(json.loads(r.envelope_json)['inputs'],{'ordered_units':'6','forward_delivery':'90','last_delivery':'30'})
 def test_all_three_annual_delivery_components_without_other_costs(self):
  d=sources();d.pop('returns');d['finance']=[batch('finance',[
   {'component':'logistics','amount':'-719098.18','currency':'RUB'},
   {'component':'courier_client_reinvoice','amount':'-62711.15','currency':'RUB'},
   {'component':'delivery_to_handover_place_by_ozon','amount':'-10075','currency':'RUB'},
   {'component':'reverse_logistics','amount':'-43275.42','currency':'RUB'},
   {'component':'drop_off_processing','amount':'-9070','currency':'RUB'}])]
  r=self.make(d,key='delivery_mean');self.assertEqual(json.loads(r.envelope_json)['inputs'],{'ordered_units':'6','forward_delivery':'719098.18','last_delivery':'72786.15'})
 def test_finance_overlap_refused(self):
  d=sources();d.pop('returns');d['finance']=[batch('finance',[]),batch('finance',[],tag='other')]
  with self.assertRaises(c.ParameterError):self.make(d,key='delivery_mean')
 def test_finance_wider_period_not_prorated(self):
  d=sources();d.pop('returns');d['finance']=[batch('finance',[],period={'from':'2025-01-01','to':'2026-11-13'})]
  with self.assertRaises(c.ParameterError):self.make(d,key='delivery_mean')
 def test_sku_delivery_not_invented_from_store_balance(self):
  target=deepcopy(TARGET);target['scope']={'kind':'sku','sku':'11'}
  with self.assertRaises(c.ParameterError):p.source_plan('delivery_mean',target,PERIOD,ASOF)
 def test_planner_no_marketplace_write_or_universal_path(self):
  plan=p.source_plan('loss_rate',TARGET,PERIOD,ASOF);self.assertFalse(plan['universal_fallback']);self.assertFalse(plan['current_value_mutated']);self.assertEqual({s['operation']for s in plan['steps']},{'report_postings_create','returns_list'})
 def test_report_day_not_leaked_into_coefficient_period(self):
  plan=p.source_plan('loss_rate',TARGET,PERIOD,ASOF);self.assertEqual(plan['parameter_period'],PERIOD);self.assertTrue(any('2025-11-13T21:00:00'in s['params'].get('filter',{}).get('processed_at_from','')for s in plan['steps']))
 def test_calendar_leap_year_no_application365cap(self):
  per=c.resolve_period(date(2024,3,1));plan=p.source_plan('loss_rate',TARGET,per,'2024-03-01T04:00:00Z');self.assertTrue(plan['steps']);self.assertEqual((date.fromisoformat(per['actual']['to'])-date.fromisoformat(per['actual']['from'])).days+1,366)
 def test_pending_and_provenance_survive_typed_result(self):
  candidate=self.make();checked=c.validate_calculation('loss_rate',json.loads(candidate.envelope_json),TARGET,PERIOD,NOW,candidate.verify)
  self.assertEqual(json.loads(checked.evidence_json)['provenance']['controls']['pending_units'],'1')
 def test_binary_float_finance_refused(self):
  packet={'http':200,'data':{'cashflows':{'services':[{'name':'logistics','amount':{'value':-0.1,'currency_code':'RUB'}}]}}}
  with self.assertRaises(c.ParameterError):p.normalize('finance',packet)
 def test_same_exemplar_in_another_order_is_another_exposure(self):
  d=sources();d['returns'][0]['rows'][1]['exemplars']=['101'];self.assertEqual(json.loads(self.make(d).envelope_json)['inputs']['failed_units'],'3')

class ProducerToStore(Fixture,DBTestCase):
 def setUp(self):self.create()
 def run_finish(self,command=None,data=None,preview=False,verify=None):
  target={'tenant_id':str(self.tenant.pk),'store_id':str(self.store.pk),'provider':'OZON','scope':deepcopy(AREA)}
  return job.finish_sources(self.token,command or self.command('replace_calculated'),deepcopy(PERIOD),data or sources(target),verify_source=verify or(lambda *a:True),as_of=ASOF,preview=preview)
 def test_sources_to_one_current_row_no_model(self):
  r=self.run_finish();self.assertTrue(r['written']);self.assertEqual(r['current']['value'],'0.5');self.assertEqual(CurrentParameter.objects.count(),1);self.assertEqual(r['current']['evidence']['provenance']['controls']['pending_units'],'1')
 def test_manual_override_is_not_lost_on_stale_collection(self):
  command=self.command('replace_calculated');self.save('0.12')
  with self.assertRaises(Rejected):self.run_finish(command)
  self.assertEqual(CurrentParameter.objects.get().value,'0.12')
 def test_preview_does_not_save(self):
  r=self.run_finish(preview=True);self.assertTrue(r['preview']);self.assertFalse(r['written']);self.assertEqual(CurrentParameter.objects.count(),0)
 def test_bad_receipt_keeps_only_current_value(self):
  self.save('0.08')
  with self.assertRaises(Rejected):self.run_finish(self.command('replace_calculated',revision=1),verify=lambda *a:False)
  self.assertEqual(CurrentParameter.objects.get().value,'0.08');self.assertEqual(OwnerCommand.objects.count(),1)
 def test_fill_present_skips_reducer_and_verifier(self):
  self.save('0')
  def forbidden(*args):raise AssertionError('must not recollect')
  r=self.run_finish(self.command('fill_missing'),verify=forbidden);self.assertFalse(r['written']);self.assertFalse(r['sources_reduced'])

class ReportFence(Fixture,DBTestCase):
 def setUp(self):self.create()
 def requests(self,sku=None,key='loss_rate'):
  q=self.command('read',area={'kind':'sku','sku':sku}if sku else AREA);q['parameter']=key
  return [{k:q[k]for k in('store_id','parameter','scope','sku_reference')}]
 def readset(self,requests=None):
  from alisa_platform.owner_data.parameter_readset import read_current
  return read_current(self.token,requests or self.requests())
 def fence(self,readset,requests=None):
  from alisa_platform.owner_data.parameter_readset import publication_fence
  return publication_fence(self.token,requests or self.requests(),readset['pins'],readset['definition_catalog_hash'])
 def test_only_current_revisions_are_persistable(self):
  self.save('0.083125');r=self.readset();self.assertFalse(r['persist_values']);self.assertNotIn('0.083125',json.dumps(r['pins']));self.assertTrue(self.fence(r)['current'])
 def test_manual_change_requires_recalculation_not_source_collection(self):
  self.save();r=self.readset();self.save('0.11',1);f=self.fence(r);self.assertFalse(f['current']);self.assertFalse(f['recollect_marketplace_data']);self.assertTrue(f['recalculate_with_current_parameters'])
 def test_unrelated_parameter_change_does_not_invalidate(self):
  self.save();r=self.readset();q=self.command(value='100');q.update(parameter='delivery_mean',unit='RUB/ordered_unit');from alisa_platform.owner_data import parameter_service as service
  service.execute(self.token,q);self.assertTrue(self.fence(r)['current'])
 def test_general_change_affects_inheriting_sku(self):
  self.save();req=self.requests('123');r=self.readset(req);self.save('0.14',1);self.assertFalse(self.fence(r,req)['current'])
 def test_general_change_does_not_affect_explicit_sku(self):
  self.save();self.save('0.03',0,{'kind':'sku','sku':'123'});req=self.requests('123');r=self.readset(req);self.save('0.14',1);self.assertTrue(self.fence(r,req)['current'])
 def test_new_sku_override_detected_even_same_numeric_value(self):
  self.save();req=self.requests('123');r=self.readset(req);self.save('0.08',0,{'kind':'sku','sku':'123'});self.assertFalse(self.fence(r,req)['current'])
 def test_no_value_filled_during_read(self):
  r=self.readset();self.assertTrue(r['missing']);self.assertEqual(CurrentParameter.objects.count(),0);self.assertFalse(r['source_collection_started'])
 def test_revoked_owner_cannot_publish_even_unchanged_parameter(self):
  self.save();r=self.readset();self.customer.is_active=False;self.customer.save()
  with self.assertRaises(Rejected):self.fence(r)
 def test_technical_catalog_change_is_not_implicit_refresh(self):
  self.save();r=self.readset();r['definition_catalog_hash']='f'*64;f=self.fence(r);self.assertFalse(f['current']);self.assertFalse(f['recollect_marketplace_data'])
 def test_parameter_date_read_never_mutates(self):
  self.save();r=self.readset();count=OwnerCommand.objects.count();self.fence(r);self.fence(r);self.assertEqual(OwnerCommand.objects.count(),count)
 def test_duplicate_dependencies_refused(self):
  req=self.requests()
  with self.assertRaises(Rejected):self.readset(req+req)
