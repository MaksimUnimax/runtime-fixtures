from copy import deepcopy
from datetime import date,timedelta
from unittest.mock import patch
import json,uuid
from django.test import TestCase,override_settings
from django.utils import timezone
from alisa_platform.owner_data import economics_current as svc,economics_cohort as eco,service as owner,parameter_service as parameters
from alisa_platform.owner_data.models import CurrentParameter,OwnerCommand,OwnerDataset
from alisa_platform.entitlements.models import AccessLedger,AccessGrant,AccessAdjustment
from alisa_platform.stores.models import CredentialRevision,VaultSecret
from current_parameters.test_parameters import Fixture
from .fixtures import bundle,qualify,order,tariff,PERIOD

@override_settings(ALISA_ENV='synthetic')
class Current(Fixture,TestCase):
 def setUp(self):
  self.create();now=timezone.now();AccessLedger.objects.create(tenant=self.tenant)
  self.grant=AccessGrant.objects.create(tenant=self.tenant,source='GIFT',source_id=uuid.uuid4(),days=7,starts_at=now-timedelta(hours=1),ends_at=now+timedelta(days=6),actor_id=uuid.uuid4(),reason='SYNTHETIC_ONLY')
  for kind in ('SELLER','PERFORMANCE'):
   secret=VaultSecret.objects.create(tenant=self.tenant,store=self.store,kind=kind,revision=1,key_version='fixture',ciphertext='SYNTHETIC-NOT-DECRYPTED')
   CredentialRevision.objects.create(tenant=self.tenant,store=self.store,kind=kind,revision=1,secret=secret,status='ACTIVE',check_code='CONNECTED')
  self.facts={'product_map':{},'entries':[self.entry('unit_cost','250','all-products',None)]};self.approve()
  self.save('0.2');q=self.command(value='100');q.update(parameter='delivery_mean',unit='RUB/ordered_unit');parameters.execute(self.token,q)
 def entry(self,field,value,entity,period):
  return {'id':str(uuid.uuid4()),'field':field,'entity':entity,'currency':'RUB','period':period,'state':'VALUE'if value is not None else'NOT_PROVIDED','value':value}
 def approve(self):
  prev=OwnerDataset.objects.filter(store=self.store).first()
  return owner.execute(self.token,{'action':'approve','store_id':str(self.store.pk),'command_id':str(uuid.uuid4()),'expected_revision':prev.revision if prev else 0,'confirmed':True,'facts':self.facts,'not_after':int(timezone.now().timestamp())+120})
 def qualified(self,rows=None,quotes=None):
  target={'tenant_id':str(self.tenant.pk),'store_id':str(self.store.pk),'provider':'OZON','currency':'RUB'}
  return qualify(bundle(rows=rows,quotes=quotes,target=target),target)
 def prepare(self,qualified=None):return svc.prepare(self.token,qualified or self.qualified(),today=date(2026,11,15))
 def counts(self):return(CurrentParameter.objects.count(),OwnerCommand.objects.count(),list(OwnerDataset.objects.values('revision','content_hash')))
 def test_current_cogs_and_coefficients_are_read_without_writes(self):
  before=self.counts();out=self.prepare();self.assertTrue(out.ready);self.assertEqual(out.result['scenarios']['with_loss']['totals']['cogs'],'400');self.assertEqual(before,self.counts())
 def test_sku_cost_overrides_general(self):
  self.facts['product_map']['101']='sku:101';self.facts['entries'].append(self.entry('unit_cost','300','sku:101',None));self.approve()
  self.assertEqual(self.prepare().result['scenarios']['with_loss']['totals']['cogs'],'480')
 def test_unknown_sku_exception_does_not_fall_back_to_general(self):
  self.facts['product_map']['101']='sku:101';self.facts['entries'].append(self.entry('unit_cost',None,'sku:101',None));self.approve()
  out=self.prepare();self.assertFalse(out.ready);self.assertEqual(out.missing_owner[0]['sku'],'101')
 def test_explicit_zero_cogs_is_not_missing(self):
  self.facts['entries'][0]['value']='0';self.approve();out=self.prepare();self.assertTrue(out.ready);self.assertEqual(out.result['scenarios']['with_loss']['totals']['cogs'],'0')
 def test_unit_cost_effective_segments_use_order_day(self):
  self.facts['entries'][0]['period']={'from':'2026-11-01','to':'2026-11-12'};self.facts['entries'].append(self.entry('unit_cost','500','all-products',PERIOD));self.approve()
  self.assertEqual(self.prepare().result['scenarios']['with_loss']['totals']['cogs'],'800')
 def test_current_value_without_expiry_date_is_supported(self):self.assertTrue(self.prepare().ready)
 def test_unprovided_tax_is_not_assumed_zero(self):
  out=self.prepare();self.assertTrue(out.ready);self.assertIsNone(out.result['scenarios']['with_loss']['after_declared_owner_inputs'])
 def test_monthly_tax_is_not_divided_by_days(self):
  self.facts['entries'].append(self.entry('tax_amount','3000','store:'+str(self.store.pk),{'from':'2026-11-01','to':'2026-11-30'}));self.approve()
  self.assertEqual(self.prepare().result['owner_period']['tax_amount'],{'state':'NOT_PROVIDED','value':None})
 def test_declared_exact_tax_and_own_cost_applied_once(self):
  for name,value in [('tax_amount','100'),('own_cost_amount','50')]:self.facts['entries'].append(self.entry(name,value,'store:'+str(self.store.pk),PERIOD))
  self.approve();out=self.prepare()
  for r in out.result['scenarios'].values():self.assertEqual(eco.number(r['totals']['remainder_before_owner_inputs'])-eco.number(r['after_declared_owner_inputs']),eco.number('150'))
 def test_cost_change_before_publication_requires_recompute_not_api(self):
  out=self.prepare();self.facts['entries'][0]['value']='300';self.approve();f=svc.publication_check(self.token,out);self.assertFalse(f['current']);self.assertFalse(f['recollect_marketplace']);self.assertEqual(self.prepare(out.qualified).result['scenarios']['with_loss']['totals']['cogs'],'480')
 def test_coefficient_change_before_publication_requires_recompute(self):
  out=self.prepare();self.save('0.3',1);self.assertFalse(svc.publication_check(self.token,out)['current']);self.assertEqual(self.prepare(out.qualified).result['scenarios']['with_loss']['totals']['cogs'],'350')
 def test_missing_coefficient_plans_fill_only_without_writing(self):
  CurrentParameter.objects.filter(key='loss_rate').delete();before=self.counts();out=self.prepare();self.assertFalse(out.ready);self.assertEqual([r['parameter']for r in out.parameter_binding.producers],['loss_rate']);self.assertEqual(before,self.counts())
 def test_missing_cogs_cannot_use_store_reference_250(self):
  self.facts['entries'][0]['state']='NOT_PROVIDED';self.facts['entries'][0]['value']=None;self.approve();self.assertFalse(self.prepare().ready)
 def test_disabled_owner_session_cannot_publish(self):
  out=self.prepare();self.session.revoked_at=timezone.now();self.session.save()
  with self.assertRaises(owner.Rejected):svc.publication_check(self.token,out)
 def test_current_entitlement_required(self):
  AccessAdjustment.objects.create(id=uuid.uuid4(),grant=self.grant,cutoff=timezone.now(),actor_id=uuid.uuid4(),reason='SYNTHETIC_REVOKE')
  with self.assertRaises(owner.Rejected):self.prepare()
 def test_disconnected_performance_credentials_not_silently_optional(self):
  CredentialRevision.objects.filter(kind='PERFORMANCE').update(check_code='NOT_CONNECTED')
  with self.assertRaises(owner.Rejected):self.prepare()
 def test_corrupted_owner_facts_rejected(self):
  OwnerDataset.objects.filter(store=self.store).update(content_hash='0'*64)
  with self.assertRaises(owner.Rejected):self.prepare()
 def test_another_token_cannot_publish_captured_readset(self):
  out=self.prepare()
  with self.assertRaises(owner.Rejected):svc.publication_check('x'*43,out)
 def test_wrong_tenant_in_source_not_accepted(self):
  t={'tenant_id':str(uuid.uuid4()),'store_id':str(self.store.pk),'provider':'OZON','currency':'RUB'};q=qualify(bundle(target=t),t)
  with self.assertRaises(owner.Rejected):self.prepare(q)
 def test_checkpoint_has_no_values_or_session(self):
  self.facts['entries'][0]['value']='273.4567';self.approve();out=self.prepare();s=json.dumps(out.checkpoint());self.assertNotIn('273.4567',s);self.assertNotIn(self.token,s);self.assertNotIn('ciphertext',s)
  with self.assertRaises(TypeError):json.dumps(out)
 def test_unchanged_publication_fence_is_read_only(self):
  out=self.prepare();before=self.counts();self.assertTrue(svc.publication_check(self.token,out)['current']);self.assertEqual(before,self.counts())
 def test_zero_orders_preserve_period_costs_without_need_of_sku_cost(self):
  out=self.prepare(self.qualified(rows=[],quotes=[]));self.assertTrue(out.ready);self.assertEqual(out.result['scenarios']['with_loss']['totals']['remainder_before_owner_inputs'],'-130')

 def test_answer_explains_current_coefficients_without_checkpoint_values(self):
  out=self.prepare();basis={r['parameter']:r for r in out.result['parameters_used']}
  self.assertEqual(basis['loss_rate']['value'],'0.2');self.assertEqual(basis['loss_rate']['origin'],'manual');self.assertIsNone(basis['loss_rate']['calculated_at'])
  self.assertEqual(out.result['unit_cost_basis'][0]['value'],'250')
  saved=json.dumps(out.checkpoint());self.assertNotIn('parameters_used',saved);self.assertNotIn('unit_cost_basis',saved)
 def test_calculated_coefficient_date_preserved_in_explanation(self):
  self.calculated(revision=1);out=self.prepare();row=next(r for r in out.result['parameters_used']if r['parameter']=='loss_rate')
  self.assertEqual(row['origin'],'calculated');self.assertIsNotNone(row['calculated_at']);self.assertIsNotNone(row['collected_at'])
