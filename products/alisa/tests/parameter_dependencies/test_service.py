from copy import deepcopy
from datetime import date
import json,uuid
from unittest.mock import patch
from django.test import TestCase
from alisa_platform.owner_data import parameter_dependency_service as service
from alisa_platform.owner_data import parameter_dependencies as d, parameter_service as values
from alisa_platform.owner_data.models import CurrentParameter,OwnerCommand
from alisa_platform.owner_data.service import Rejected
from alisa_platform.stores.models import Store
from alisa_platform.accounts.models import Tenant
from current_parameters.test_parameters import Fixture,AREA,PERIOD

PROFILE='unit_economics.ozon.v1'
TODAY=date(2026,11,14)
REPORT={'from':'2026-11-13','to':'2026-11-13'}


class AuthenticatedDependencies(Fixture,TestCase):
 def setUp(self):self.create()
 def consumer(self,cid='daily',sku=None,store=None):
  store=store or self.store;scope=deepcopy(AREA)if sku is None else{'kind':'sku','sku':sku}
  return {'id':cid,'store_id':str(store.pk),'scope':scope,
          'sku_reference':None if sku is None else values.sku_reference(self.session,store,sku)}
 def delivery(self,value='100',revision=0,area=None):
  q=self.command(value=value,revision=revision,area=area);q.update(parameter='delivery_mean',unit='RUB/ordered_unit');return values.execute(self.token,q)
 def resolve(self,consumers=None,**kwargs):
  return service.resolve_current(self.token,PROFILE,consumers or[self.consumer()],TODAY,report_period=REPORT,**kwargs)
 def filled(self):self.save('0.08');self.delivery('100')
 def state(self):
  return {'rows':list(CurrentParameter.objects.order_by('id').values()),'commands':list(OwnerCommand.objects.order_by('id').values())}
 def test_current_values_real_db_without_mutation(self):
  self.filled();before=self.state();r=self.resolve();self.assertTrue(r.ready);self.assertEqual(r.formula_inputs('daily'),{'loss_rate':'0.08','delivery_mean':'100'});self.assertEqual(self.state(),before)
 def test_no_value_read_does_not_create_current_rows_or_commands(self):
  r=self.resolve();self.assertFalse(r.ready);self.assertEqual(len(r.producers),2);self.assertEqual(CurrentParameter.objects.count(),0);self.assertEqual(OwnerCommand.objects.count(),0)
 def test_saved_zero_never_causes_producer(self):
  self.save('0');self.delivery('0');self.assertTrue(self.resolve().ready)
 def test_many_sku_missing_values_share_actual_store_scope(self):
  r=self.resolve([self.consumer('s'+str(i),str(i))for i in range(1,78)]);self.assertEqual(len(r.producers),2);self.assertTrue(all(p['scope']==AREA for p in r.producers));self.assertEqual(CurrentParameter.objects.count(),0)
 def test_sku_exception_does_not_copy_common_to_new_rows(self):
  self.filled();self.save('0.03',0,{'kind':'sku','sku':'123'});r=self.resolve([self.consumer(sku='123')]);self.assertEqual(r.formula_inputs('daily'),{'loss_rate':'0.03','delivery_mean':'100'});self.assertEqual(CurrentParameter.objects.count(),3)
 def test_general_change_requires_rebind_for_inheritance(self):
  self.filled();r=self.resolve([self.consumer(sku='123')]);self.save('0.15',1);f=service.publication_check(self.token,r);self.assertFalse(f['current']);self.assertTrue(f['rebind_from_current']);self.assertFalse(f['recollect_marketplace_data'])
 def test_general_change_not_affect_explicit_sku_value(self):
  self.filled();self.save('0.03',0,{'kind':'sku','sku':'123'});r=self.resolve([self.consumer(sku='123')]);self.save('0.15',1);self.assertTrue(service.publication_check(self.token,r)['current'])
 def test_late_new_exception_detected(self):
  self.filled();r=self.resolve([self.consumer(sku='123')]);self.save('0.08',0,{'kind':'sku','sku':'123'});self.assertFalse(service.publication_check(self.token,r)['current'])
 def test_missing_common_uses_tombstone_common_revision_not_sku(self):
  self.save('0.03',0,{'kind':'sku','sku':'123'});q=self.command('use_general',revision=1,area={'kind':'sku','sku':'123'});values.execute(self.token,q)
  r=self.resolve([self.consumer(sku='123')]);self.assertTrue(all(p['expected_revision']==0 for p in r.producers))
 def test_fill_completion_then_bind_current_without_repeat_plan(self):
  self.delivery();first=self.resolve();self.assertEqual(len(first.producers),1)
  command=self.command('fill_missing',revision=first.producers[0]['expected_revision']);self.calculated(action='fill_missing',command=command)
  second=self.resolve();self.assertTrue(second.ready);self.assertTrue(service.publication_check(self.token,second)['current']);self.assertEqual(CurrentParameter.objects.count(),2)
 def test_manual_edit_during_pending_fill_is_preserved(self):
  self.delivery();before=self.resolve();planned=before.producers[0];self.save('0.12')
  result=self.calculated(action='fill_missing',command=self.command('fill_missing',revision=planned['expected_revision']))
  self.assertFalse(result['written']);self.assertEqual(self.read()['current']['value'],'0.12');self.assertEqual(self.resolve().formula_inputs('daily')['loss_rate'],'0.12')
 def test_publication_fence_is_read_only_and_pending_not_ready(self):
  r=self.resolve();before=self.state();f=service.publication_check(self.token,r);self.assertFalse(f['current']);self.assertEqual(f['reason'],'PARAMETER_DEPENDENCIES_PENDING');self.assertEqual(self.state(),before)
 def test_manual_change_invalidates_prior_binding_not_source_data(self):
  self.filled();r=self.resolve();self.save('0.14',1);f=service.publication_check(self.token,r);self.assertFalse(f['current']);self.assertFalse(f['recollect_marketplace_data']);fresh=self.resolve();self.assertEqual(fresh.formula_inputs('daily')['loss_rate'],'0.14')
 def test_former_numbers_not_stored_by_binding_or_checkpoint(self):
  self.save('0.083721');self.delivery('101.612345');r=self.resolve();before=self.state();self.assertNotIn('0.083721',json.dumps(r.checkpoint()));service.publication_check(self.token,r);self.assertEqual(before,self.state())
 def test_revoked_owner_cannot_publish_even_same_revisions(self):
  self.filled();r=self.resolve();self.customer.is_active=False;self.customer.save()
  with self.assertRaises(Rejected):service.publication_check(self.token,r)
 def test_foreign_store_denied_before_any_dependency(self):
  other=Tenant.objects.create();store=Store.objects.create(tenant=other,provider='OZON',name='Other synthetic store')
  with self.assertRaises(Rejected):self.resolve([self.consumer(store=store)])
  self.assertEqual(CurrentParameter.objects.count(),0)
 def test_forged_duplicate_sku_proof_cannot_hide_by_deduplication(self):
  a=self.consumer('a','123');b=self.consumer('b','123');b['sku_reference']='forged'
  with self.assertRaises(Rejected):self.resolve([a,b])
 def test_expired_session_not_used_for_reading(self):
  from django.utils import timezone
  self.session.expires_at=timezone.now();self.session.save()
  with self.assertRaises(Rejected):self.resolve()
 def test_wrong_provider_not_mislabelled(self):
  store=Store.objects.create(tenant=self.tenant,provider='WB',name='Synthetic WB')
  with self.assertRaises(Rejected)as error:self.resolve([self.consumer(store=store)])
  self.assertEqual(error.exception.code,'PARAMETER_PLATFORM')
 def test_second_store_binding_not_deduplicated_with_first(self):
  store=Store.objects.create(tenant=self.tenant,provider='OZON',name='Second synthetic store')
  r=self.resolve([self.consumer('a'),self.consumer('b',store=store)]);self.assertEqual(len(r.producers),4)
 def test_metadata_definition_change_requires_fresh_bind_not_collection(self):
  self.filled();r=self.resolve();rule=deepcopy(d.CATALOG['profiles'][PROFILE]);rule['description']+=' changed'
  with patch.dict(d.CATALOG['profiles'],{PROFILE:rule}):
   f=service.publication_check(self.token,r);self.assertFalse(f['current']);self.assertFalse(f['recollect_marketplace_data'])
 def test_arbitrary_json_is_not_a_publication_authority(self):
  with self.assertRaises(Rejected):service.publication_check(self.token,{'ready':True})
 def test_preserved_half_year_ignores_report_day_and_default_year(self):
  self.calculated();self.delivery();row=CurrentParameter.objects.get(key='loss_rate');row.actual_period={'from':'2026-05-14','to':'2026-11-13'};row.save(update_fields=['actual_period'])
  r=self.resolve();self.assertTrue(r.ready);basis=next(x for x in r.answer_basis()if x['parameter']=='loss_rate');self.assertEqual(basis['actual_period'],row.actual_period)

 def test_rebind_preserves_original_year_across_calendar_day(self):
  initial=self.resolve();rebound=service.rebind_current(self.token,initial)
  nextday=service.resolve_current(self.token,PROFILE,[self.consumer()],date(2026,11,15),report_period=REPORT)
  self.assertEqual(initial.producers,rebound.producers);self.assertNotEqual(initial.producers,nextday.producers)
  self.assertEqual(rebound.checkpoint()['coefficient_period_anchor'],'2026-11-14')
 def test_rebind_uses_new_current_value_not_old_in_memory(self):
  self.filled();before=self.resolve();self.save('0.17',1);after=service.rebind_current(self.token,before)
  self.assertEqual(after.formula_inputs('daily')['loss_rate'],'0.17');self.assertEqual(after.producers,[])
 def test_rebind_refuses_silent_dependency_profile_replacement(self):
  before=self.resolve();changed=deepcopy(d.CATALOG['profiles'][PROFILE]);changed['bindings'].pop()
  with patch.dict(d.CATALOG['profiles'],{PROFILE:changed}):
   with self.assertRaises(Rejected)as error:service.rebind_current(self.token,before)
   self.assertEqual(error.exception.code,'PARAMETER_DEPENDENCY_PROFILE_CHANGED')
