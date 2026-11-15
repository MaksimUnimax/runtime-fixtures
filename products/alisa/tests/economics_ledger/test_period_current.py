"""Verified source envelopes with actual owner_data, no live credentials/provider."""
from copy import deepcopy
from datetime import date
import json
from django.test import TestCase,override_settings
from django.utils import timezone
from alisa_platform.owner_data import economics_current as svc,economics_cohort as eco,economics_periods as period,service as owner
from economics_cohort import test_current as support,fixtures as f
from current_parameters.test_parameters import Fixture
from .test_period_costs import fixtures,PROOF,NOW

@override_settings(ALISA_ENV='synthetic')
class PeriodCurrent(Fixture,TestCase):
 entry=support.Current.entry;approve=support.Current.approve;counts=support.Current.counts
 def setUp(self):support.Current.setUp(self)
 def qualified(self):
  target={'tenant_id':str(self.tenant.pk),'store_id':str(self.store.pk),'provider':'OZON','currency':'RUB'}
  packets=fixtures()
  for p in packets:p['scope']=deepcopy(target)
  known=deepcopy(packets)
  value=period.normalize(packets,target,f.PERIOD,verify=lambda p,proof:p in known and proof==PROOF,scope_proof=PROOF,as_of=NOW)
  bundle=f.bundle(target=target);bundle['period_costs']=value.as_source();other={k:eco.c.CANON(v)for k,v in bundle.items()if k!='period_costs'}
  return eco.qualify(bundle,target,f.PERIOD,verify=lambda k,v,t,p:value.verifies(k,v,t,p)if k=='period_costs'else other[k]==eco.c.CANON(v))
 def prepare(self,q=None):return svc.prepare(self.token,q or self.qualified(),today=date(2026,11,15))
 def test_period_sources_with_saved_cogs_coefficients_without_writes(self):
  before=self.counts();out=self.prepare();self.assertTrue(out.ready);self.assertEqual(before,self.counts())
  values=out.result['scenarios']['with_loss']['totals'];self.assertEqual(values['storage'],'30');self.assertEqual(values['advertising'],'100');self.assertEqual(values['cogs'],'400')
 def test_unprovided_tax_not_net_profit_despite_source_success(self):
  out=self.prepare();self.assertIsNone(out.result['scenarios']['with_loss']['after_declared_owner_inputs']);self.assertEqual(out.result['owner_period']['tax_amount']['state'],'NOT_PROVIDED')
 def test_coefficient_change_recompute_using_same_source_not_collect_again(self):
  q=self.qualified();old=self.prepare(q);self.save('0.3',1);self.assertFalse(svc.publication_check(self.token,old)['current']);new=self.prepare(q)
  a=new.result['scenarios']['with_loss']['totals'];self.assertEqual(a['advertising'],'100');self.assertEqual(a['storage'],'30');self.assertEqual(a['cogs'],'350')
 def test_cost_change_recompute_same_period_source(self):
  q=self.qualified();old=self.prepare(q);self.facts['entries'][0]['value']='300';self.approve();self.assertFalse(svc.publication_check(self.token,old)['current'])
  self.assertEqual(self.prepare(q).result['scenarios']['with_loss']['totals']['cogs'],'480')
 def test_explicit_owner_tax_own_cost_once(self):
  for field,value in [('tax_amount','100'),('own_cost_amount','50')]:self.facts['entries'].append(self.entry(field,value,'store:'+str(self.store.pk),f.PERIOD))
  self.approve();result=self.prepare().result
  for value in result['scenarios'].values():self.assertEqual(eco.number(value['totals']['remainder_before_owner_inputs'])-eco.number(value['after_declared_owner_inputs']),eco.number('150'))
 def test_revoked_session_not_authorized_by_source_object(self):
  old=self.prepare();self.session.revoked_at=timezone.now();self.session.save()
  with self.assertRaises(owner.Rejected):svc.publication_check(self.token,old)
 def test_source_foreign_target_not_rebound_by_value(self):
  target={'tenant_id':str(self.tenant.pk),'store_id':'foreign','provider':'OZON','currency':'RUB'}
  q=f.qualify(f.bundle(target=target),target)
  with self.assertRaises(owner.Rejected):self.prepare(q)
 def test_checkpoint_no_current_numbers_or_raw_source(self):
  out=self.prepare();s=json.dumps(out.checkpoint());self.assertNotIn('PRIVATE',s);self.assertNotIn('moneySpent',s);self.assertNotIn(self.token,s)
