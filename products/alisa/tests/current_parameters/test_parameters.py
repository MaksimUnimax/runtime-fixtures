from copy import deepcopy
from datetime import date,datetime,timedelta,timezone as dtz
from decimal import Decimal,localcontext
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import json,uuid,hashlib,secrets
from unittest import TestCase as UnitCase
from unittest.mock import patch
from django.test import TestCase,TransactionTestCase,override_settings
from django.db import connection,connections,IntegrityError,transaction
from django.utils import timezone
from django.conf import settings
from alisa_platform.accounts.models import Customer,Tenant,Membership,AuthFlow,WebSession
from alisa_platform.stores.models import Store
from alisa_platform.accounts.views import digest
from alisa_platform.owner_data.models import CurrentParameter,OwnerCommand,OwnerDataset
from alisa_platform.owner_data import parameter_contract as c,parameter_service as s
from alisa_platform.owner_data.service import Rejected

AREA={'kind':'store','sku':''}
PERIOD={'requested':{'from':'2025-11-14','to':'2026-11-13'},'actual':{'from':'2025-11-14','to':'2026-11-13'},'explicit':False,'short_history':False}

class Contract(UnitCase):
 def test_default_calendar_year(self):self.assertEqual(c.resolve_period(date(2026,11,14)),PERIOD)
 def test_short_default_history(self):
  p=c.resolve_period(date(2026,11,14),available_from=date(2026,8,14),short_history_confirmed=True);self.assertEqual(p['actual']['from'],'2026-08-14');self.assertTrue(p['short_history'])
 def test_no_silent_shortening_explicit_half_year(self):
  with self.assertRaises(c.ParameterError):c.resolve_period(date(2026,11,14),{'months':6},date(2026,8,14),True)
 def test_unconfirmed_history_not_a_short_store(self):
  with self.assertRaises(c.ParameterError):c.resolve_period(date(2026,11,14),available_from=date(2026,8,14))
 def test_half_year_is_calendar(self):self.assertEqual(c.resolve_period(date(2026,11,14),{'months':6})['actual']['from'],'2026-05-14')
 def test_leap_boundary(self):self.assertEqual(c.resolve_period(date(2024,2,29))['actual'],{'from':'2023-02-28','to':'2024-02-28'})
 def test_exact_dates_preserved(self):self.assertEqual(c.resolve_period(date(2026,11,14),{'from':'2026-01-01','to':'2026-06-30'})['actual'],{'from':'2026-01-01','to':'2026-06-30'})
 def test_unfinished_current_day_denied(self):
  with self.assertRaises(c.ParameterError):c.resolve_period(date(2026,11,14),{'from':'2026-11-01','to':'2026-11-14'})
 def test_zero_is_value(self):self.assertEqual(c.validate_value(c.definition('loss_rate'),'0','ratio'),'0')
 def test_float_not_coerced(self):
  with self.assertRaises(c.ParameterError):c.validate_value(c.definition('loss_rate'),0.08,'ratio')
 def test_percent_not_ratio(self):
  with self.assertRaises(c.ParameterError):c.validate_value(c.definition('loss_rate'),'8','ratio')
 def test_nan_rejected(self):
  with self.assertRaises(c.ParameterError):c.number('NaN')
 def test_no_parameter_named_dispatch(self):
  self.assertEqual(c.evaluate({'divide':[{'input':'a'},{'input':'b'}]},{'a':'1','b':'4'}),Decimal('.25'))
 def test_zero_denominator(self):
  with self.assertRaises(c.ParameterError):c.evaluate({'divide':[{'input':'a'},{'input':'b'}]},{'a':'1','b':'0'})
 def test_unregistered_operation(self):
  with self.assertRaises(c.ParameterError):c.evaluate({'python':'danger'}, {})

class Fixture:
 def create(self):
  self.tenant=Tenant.objects.create();self.customer=Customer.objects.create(email='parameter-test@example.invalid')
  Membership.objects.create(customer=self.customer,tenant=self.tenant,role='OWNER_CLIENT')
  self.token=secrets.token_urlsafe(32);flow=AuthFlow.objects.create(secret_hash=digest(self.token+'flow'),encrypted_payload='',expires_at=timezone.now()+timedelta(days=1))
  self.session=WebSession.objects.create(token_hash=digest(self.token),customer=self.customer,tenant=self.tenant,flow=flow,encrypted_payload='',security_revision=1,expires_at=timezone.now()+timedelta(days=1))
  self.store=Store.objects.create(tenant=self.tenant,provider='OZON',name='Synthetic store',verified_identity='parameter-test-id')
 def command(self,action='set_manual',value='0.08',revision=0,area=None):
  area=deepcopy(area or AREA)
  cmd={'action':action,'store_id':str(self.store.pk),'parameter':'loss_rate','scope':area,'sku_reference':None}
  if area['kind']=='sku':cmd['sku_reference']=s.sku_reference(self.session,self.store,area['sku'])
  if action!='read':cmd.update(command_id=str(uuid.uuid4()),expected_revision=revision,confirmed=True,not_after=int(timezone.now().timestamp())+120)
  if action=='set_manual':cmd.update(value=value,unit='ratio')
  return cmd
 def read(self,area=None):return s.execute(self.token,self.command('read',area=area))
 def save(self,value='0.08',revision=0,area=None):return s.execute(self.token,self.command(value=value,revision=revision,area=area))
 def envelope(self,area=None):
  dt=(timezone.now()-timedelta(days=3)).replace(microsecond=0).isoformat()
  return {'producer_template':'parameter.loss_rate.v1','inputs':{'failed_units':'993','ordered_units':'7761'},
    'coverage':{'complete':True,'actual_period':deepcopy(PERIOD['actual']),'short_history':False,'scope':deepcopy(area or AREA)},
    'source_collected_at':{'ordered_physical_units':dt,'unique_failed_units':dt},'observed_until':timezone.now().replace(microsecond=0).isoformat()}
 def calculated(self,revision=0,area=None,action='replace_calculated',envelope=None,command=None,verify=None):
  return s.commit_calculated(self.token,command or self.command(action,revision=revision,area=area),envelope or self.envelope(area),deepcopy(PERIOD),verify_sources=verify or(lambda t,p,e:True))

class Storage(Fixture,TestCase):
 def setUp(self):self.create()
 def test_manual_one_current_row(self):
  a=self.save();b=self.save('0.09',1);self.assertEqual(CurrentParameter.objects.count(),1);self.assertEqual(b['current']['value'],'0.09');self.assertEqual(b['revision'],2)
 def test_manual_has_no_false_collection_date(self):
  r=self.save()['current'];self.assertIsNone(r['collected_at']);self.assertIsNone(r['calculated_at']);self.assertIsNone(r['actual_period']);self.assertEqual(r['evidence'],{})
 def test_read_does_not_modify_timestamps_or_receipt_count(self):
  a=self.save()['current'];count=OwnerCommand.objects.count()
  for _ in range(5):self.assertEqual(self.read()['current'],a)
  self.assertEqual(OwnerCommand.objects.count(),count)
 def test_zero_never_missing(self):self.save('0');self.assertEqual(self.read()['effective']['value'],'0')
 def test_old_command_has_no_saved_old_value(self):
  self.save('0.083721');self.save('0.129934',1)
  for r in OwnerCommand.objects.all():self.assertNotIn('0.083721',json.dumps(r.result));self.assertNotIn('value',r.result);self.assertNotIn('collected_at',r.result)
 def test_calculated_records_real_source_date_and_current_passport(self):
  env=self.envelope();r=self.calculated(envelope=env)['current'];self.assertEqual(r['origin'],'calculated');self.assertEqual(r['collected_at'],env['source_collected_at']['ordered_physical_units']);self.assertEqual(r['actual_period'],PERIOD['actual']);self.assertTrue(r['calculated_at'])
 def test_manual_replaces_all_old_calculation_fields(self):
  self.calculated();r=self.save('0.05',1)['current'];self.assertEqual(r['value'],'0.05');self.assertIsNone(r['collected_at']);self.assertIsNone(r['requested_period']);self.assertEqual(r['evidence'],{})
 def test_calculated_replace_removes_old_value_and_basis(self):
  self.calculated();env=self.envelope();env['inputs']={'failed_units':'1','ordered_units':'10'};self.calculated(1,envelope=env)
  row=CurrentParameter.objects.get();self.assertEqual(row.value,'0.1');self.assertEqual(row.evidence['inputs'],env['inputs']);self.assertNotIn('993',json.dumps(row.evidence));self.assertEqual(CurrentParameter.objects.count(),1)
 def test_failed_collection_preserves_value_and_date(self):
  self.calculated();before=self.read();env=self.envelope();env['coverage']['complete']=False
  with self.assertRaises(Rejected):self.calculated(1,envelope=env)
  self.assertEqual(self.read(),before)
 def test_unqualified_source_refused(self):
  with self.assertRaises(Rejected):self.calculated(verify=lambda t,p,e:False)
  self.assertEqual(CurrentParameter.objects.count(),0)
 def test_zero_denominator_does_not_clear_current(self):
  self.save();env=self.envelope();env['inputs']['ordered_units']='0'
  with self.assertRaises(Rejected):self.calculated(1,envelope=env)
  self.assertEqual(self.read()['current']['value'],'0.08')
 def test_future_date_denied(self):
  env=self.envelope();env['source_collected_at']['ordered_physical_units']=(timezone.now()+timedelta(days=1)).isoformat()
  with self.assertRaises(Rejected):self.calculated(envelope=env)
 def test_naive_date_denied(self):
  env=self.envelope();env['source_collected_at']['ordered_physical_units']='2026-11-01T12:00:00'
  with self.assertRaises(Rejected):self.calculated(envelope=env)
 def test_oldest_source_date_does_not_pretend_freshness(self):
  env=self.envelope();old=(timezone.now()-timedelta(days=30)).replace(microsecond=0).isoformat();env['source_collected_at']['ordered_physical_units']=old
  self.assertEqual(self.calculated(envelope=env)['current']['collected_at'],old)
 def test_collection_scope_is_not_report_sku(self):
  env=self.envelope();env['coverage']['scope']={'kind':'sku','sku':'123'}
  with self.assertRaises(Rejected):self.calculated(envelope=env)
 def test_new_days_do_not_invalidate_current(self):
  self.calculated();current=self.read()['current']
  with patch('django.utils.timezone.now',return_value=timezone.now()+timedelta(hours=2)):self.assertEqual(self.read()['current'],current)
 def test_fill_missing_never_overwrites_manual(self):
  self.save('0.04');result=self.calculated(action='fill_missing');self.assertFalse(result['written']);self.assertEqual(result['effective']['value'],'0.04')
 def test_explicit_replacement_compares_revision(self):
  self.save()
  with self.assertRaises(Rejected)as e:self.calculated(0)
  self.assertEqual(e.exception.code,'PARAMETER_REVISION_CONFLICT');self.assertEqual(self.read()['current']['value'],'0.08')
 def test_manual_no_performance_key_required(self):self.assertEqual(self.save()['current']['value'],'0.08')
 def test_sku_overrides_general(self):
  self.save();sku={'kind':'sku','sku':'111'};self.save('0.03',0,sku);self.assertEqual(self.read(sku)['effective']['value'],'0.03');self.assertFalse(self.read(sku)['inherited'])
 def test_general_change_keeps_exception(self):
  sku={'kind':'sku','sku':'111'};self.save();self.save('0.03',0,sku);self.save('0.09',1);self.assertEqual(self.read(sku)['effective']['value'],'0.03')
 def test_inherited_value_not_duplicated_in_db(self):
  self.save();r=self.read({'kind':'sku','sku':'111'});self.assertTrue(r['inherited']);self.assertEqual(CurrentParameter.objects.count(),1)
 def test_remove_exception_erases_its_value_and_date(self):
  sku={'kind':'sku','sku':'111'};self.save();self.calculated(area=sku)
  result=s.execute(self.token,self.command('use_general',revision=1,area=sku));self.assertTrue(result['inherited']);self.assertIsNone(result['current']['value']);self.assertIsNone(result['current']['collected_at']);self.assertEqual(result['current']['evidence'],{})
 def test_aba_stale_edit_after_use_general_rejected(self):
  sku={'kind':'sku','sku':'111'};self.save('0.03',0,sku);s.execute(self.token,self.command('use_general',revision=1,area=sku))
  with self.assertRaises(Rejected):self.save('0.05',0,sku)
 def test_unknown_sku_without_signed_reference(self):
  q=self.command(area={'kind':'sku','sku':'999'});q['sku_reference']=None
  with self.assertRaises(Rejected):s.execute(self.token,q)
 def test_sku_proof_of_other_store_denied(self):
  q=self.command(area={'kind':'sku','sku':'999'});self.store.revision+=1;self.store.save()
  with self.assertRaises(Rejected):s.execute(self.token,q)
 def test_wrong_tenant_store_denied(self):
  foreign=Store.objects.create(tenant=Tenant.objects.create(),provider='OZON',name='Other',verified_identity='other');q=self.command();q['store_id']=str(foreign.pk)
  with self.assertRaises(Rejected)as e:s.execute(self.token,q)
  self.assertEqual(e.exception.code,'NOT_FOUND')
 def test_revoked_session_denied(self):
  self.session.revoked_at=timezone.now();self.session.save()
  with self.assertRaises(Rejected):self.save()
 def test_changed_security_revision_denied(self):
  self.customer.security_revision=2;self.customer.save()
  with self.assertRaises(Rejected):self.save()
 def test_disabled_store_denied(self):
  self.store.status='DISABLED';self.store.save()
  with self.assertRaises(Rejected):self.save()
 def test_expired_command_denied(self):
  q=self.command();q['not_after']=int(timezone.now().timestamp())-1
  with self.assertRaises(Rejected):s.execute(self.token,q)
 def test_replay_returns_current_not_old_value(self):
  q=self.command(value='0.08');s.execute(self.token,q);self.save('0.10',1);r=s.execute(self.token,q);self.assertTrue(r['replayed']);self.assertEqual(r['current']['value'],'0.1');self.assertEqual(r['receipt']['revision'],1)
 def test_same_id_different_manual_value_conflict(self):
  q=self.command();s.execute(self.token,q);q['value']='0.09'
  with self.assertRaises(Rejected)as e:s.execute(self.token,q)
  self.assertEqual(e.exception.code,'IDEMPOTENCY_CONFLICT')
 def test_calculated_replay_different_evidence_conflict(self):
  q=self.command('replace_calculated');env=self.envelope();self.calculated(command=q,envelope=env);env['inputs']['failed_units']='1'
  with self.assertRaises(Rejected):self.calculated(command=q,envelope=env)
 def test_no_history_model(self):
  tables=connection.introspection.table_names();self.assertIn('owner_data_currentparameter',tables);self.assertFalse(any('parameterversion'in n or 'parameterhistory'in n for n in tables))
 def test_existing_cost_unchanged(self):
  facts={'product_map':{},'entries':[{'field':'unit_cost','entity':'all-products','value':'250'}]};OwnerDataset.objects.create(store=self.store,tenant=self.tenant,revision=1,status='APPROVED',facts=facts)
  self.save();self.calculated(1);row=OwnerDataset.objects.get();self.assertEqual(row.facts,facts);self.assertEqual(row.revision,1)
 def test_unique_db_constraint(self):
  self.save();row=CurrentParameter.objects.get();row.pk=uuid.uuid4()
  with self.assertRaises(IntegrityError),transaction.atomic():row.save(force_insert=True)
 def test_manual_cannot_keep_collection_passport_at_db_layer(self):
  self.save()
  with self.assertRaises(IntegrityError),transaction.atomic():CurrentParameter.objects.update(collected_at=timezone.now())
 def test_cross_tenant_fk_enforced_by_database(self):
  self.save();foreign=Tenant.objects.create()
  with self.assertRaises(IntegrityError),transaction.atomic():
   CurrentParameter.objects.update(tenant=foreign)
   with connection.cursor()as cursor:cursor.execute('SET CONSTRAINTS current_parameter_tenant_store_fk IMMEDIATE')
 def test_past_collection_removed_from_current_row_after_replacement(self):
  env=self.envelope();first=(timezone.now()-timedelta(days=200)).replace(microsecond=0).isoformat()
  env['source_collected_at']={k:first for k in env['source_collected_at']};self.calculated(envelope=env)
  env2=self.envelope();self.calculated(1,envelope=env2)
  current=self.read()['current'];self.assertNotIn(first,json.dumps(current));self.assertEqual(CurrentParameter.objects.count(),1)
 def test_delivery_formula_is_declarative_and_exact(self):
  q=self.command('replace_calculated');q['parameter']='delivery_mean';dt=(timezone.now()-timedelta(days=1)).replace(microsecond=0).isoformat()
  env={'producer_template':'parameter.delivery_mean.v1','inputs':{'forward_delivery':'719098.18','last_delivery':'72786.15','ordered_units':'7793'},'coverage':{'complete':True,'actual_period':deepcopy(PERIOD['actual']),'short_history':False,'scope':deepcopy(AREA)},'source_collected_at':{k:dt for k in c.definition('delivery_mean')['required_sources']},'observed_until':timezone.now().replace(microsecond=0).isoformat()}
  r=s.commit_calculated(self.token,q,env,deepcopy(PERIOD),verify_sources=lambda *args:True)
  with localcontext()as ctx:
   ctx.prec=50;self.assertEqual(Decimal(r['current']['value']),Decimal('791884.33')/Decimal('7793'))
 def test_external_manual_date_is_not_accepted(self):
  q=self.command();q['collected_at']='2026-11-14T00:00:00Z'
  with self.assertRaises(Rejected):s.execute(self.token,q)
 def test_missing_source_component_not_a_complete_average(self):
  env=self.envelope();del env['source_collected_at']['unique_failed_units']
  with self.assertRaises(Rejected):self.calculated(envelope=env)
 def test_api_requires_existing_service_boundary(self):
  response=self.client.post('/parameters',data=json.dumps({'session_token':self.token,'command':self.command()}),content_type='application/json');self.assertEqual(response.status_code,401);self.assertEqual(CurrentParameter.objects.count(),0)
 def test_expired_receipt_removal_does_not_allow_old_command(self):
  old=self.command();s.execute(self.token,old)
  # Simulate a receipt older than retention with its original admission deadline.
  OwnerCommand.objects.update(created_at=timezone.now()-timedelta(days=2))
  self.save('0.09',1);self.assertEqual(OwnerCommand.objects.count(),1)
  with patch('django.utils.timezone.now',return_value=timezone.now()+timedelta(minutes=10)):
   with self.assertRaises(Rejected)as e:s.execute(self.token,old)
  self.assertEqual(e.exception.code,'OWNER_COMMAND_EXPIRED');self.assertEqual(self.read()['current']['value'],'0.09')
 def test_catalog_lists_units_and_honest_collection_readiness(self):
  r=s.execute(self.token,{'action':'catalog','store_id':str(self.store.pk)})
  self.assertEqual(r['default_period'],{'months':12});self.assertEqual(len(r['definitions']),2)
  self.assertTrue(all(x['collection']=={'available':False,'code':'PARAMETER_SOURCE_NOT_QUALIFIED'}for x in r['definitions']));self.assertEqual(OwnerCommand.objects.count(),0)
 def test_status_after_write_returns_metadata_and_current(self):
  q=self.command();s.execute(self.token,q);check={k:q[k]for k in ['store_id','parameter','scope','sku_reference','command_id']};check['action']='status'
  r=s.execute(self.token,check);self.assertEqual(r['outcome'],'DONE');self.assertFalse(r['superseded']);self.assertNotIn('value',r['receipt'])
 def test_status_unknown_never_repeats_write(self):
  q=self.command('read');q.update(action='status',command_id=str(uuid.uuid4()));r=s.execute(self.token,q)
  self.assertEqual(r['outcome'],'NOT_FOUND');self.assertEqual(CurrentParameter.objects.count(),0);self.assertEqual(OwnerCommand.objects.count(),0)
 def test_status_old_receipt_marks_superseded_no_old_value(self):
  q=self.command(value='0.071927');s.execute(self.token,q);self.save('0.22',1)
  check={k:q[k]for k in ['store_id','parameter','scope','sku_reference','command_id']};check['action']='status';r=s.execute(self.token,check)
  self.assertTrue(r['superseded']);self.assertEqual(r['current']['value'],'0.22');self.assertNotIn('0.071927',json.dumps(r))
 def test_status_other_target_for_same_id_denied(self):
  q=self.command();s.execute(self.token,q);check={k:q[k]for k in ['store_id','parameter','scope','sku_reference','command_id']};check.update(action='status',parameter='delivery_mean')
  with self.assertRaises(Rejected):s.execute(self.token,check)
 def test_prepare_default_year_without_collecting(self):
  q=self.command('read');q.update(action='prepare_calculation',period=None,mode='replace');before=OwnerCommand.objects.count();r=s.execute(self.token,q)
  self.assertFalse(r['period']['explicit']);self.assertTrue(r['prepared']);self.assertFalse(r['dispatched']);self.assertEqual(OwnerCommand.objects.count(),before);self.assertEqual(CurrentParameter.objects.count(),0)
 def test_prepare_half_year_is_explicit_no_write(self):
  self.save();before=self.read()['current'];q=self.command('read');q.update(action='prepare_calculation',period={'months':6},mode='replace');r=s.execute(self.token,q)
  self.assertTrue(r['period']['explicit']);self.assertEqual(self.read()['current'],before)
 def test_prepare_cannot_claim_different_scope(self):
  q=self.command('read');q.update(action='prepare_calculation',period=None,mode='apply_all')
  with self.assertRaises(Rejected):s.execute(self.token,q)
 def test_read_api_returns_dates(self):
  self.calculated();response=self.client.post('/parameters',data=json.dumps({'session_token':self.token,'command':self.command('read')}),content_type='application/json',HTTP_AUTHORIZATION='Bearer '+settings.AUTH_SERVICE_TOKEN)
  self.assertEqual(response.status_code,200);self.assertTrue(response.json()['current']['collected_at'])
 def test_actual_period_outside_requested_is_rejected(self):
  q=self.command('replace_calculated');p=deepcopy(PERIOD);p['actual']['from']='2024-01-01';env=self.envelope();env['coverage']['actual_period']=p['actual']
  with self.assertRaises(Rejected):s.commit_calculated(self.token,q,env,p,verify_sources=lambda *a:True)
 def test_observation_before_period_end_rejected(self):
  env=self.envelope();env['observed_until']='2026-10-01T00:00:00Z'
  with self.assertRaises(Rejected)as e:self.calculated(envelope=env)
  self.assertEqual(e.exception.code,'PARAMETER_OBSERVATION_BEFORE_PERIOD_END')
 def test_explicit_period_cannot_shrink_even_if_flag_true(self):
  p=deepcopy(PERIOD);p['explicit']=True;p['short_history']=True;p['actual']['from']='2026-08-14';env=self.envelope();env['coverage'].update(actual_period=p['actual'],short_history=True)
  with self.assertRaises(Rejected):s.commit_calculated(self.token,self.command('replace_calculated'),env,p,verify_sources=lambda *a:True)
 def test_no_client_calculated_write_route(self):
  q=self.command('replace_calculated');response=self.client.post('/parameters',data=json.dumps({'session_token':self.token,'command':q}),content_type='application/json',HTTP_AUTHORIZATION='Bearer '+settings.AUTH_SERVICE_TOKEN)
  self.assertEqual(response.status_code,422);self.assertEqual(CurrentParameter.objects.count(),0)
 def test_feature_flag_closed_by_default(self):
  with override_settings(OWNER_PARAMETERS_ENABLED=False):
   with self.assertRaises(Rejected)as e:self.save()
  self.assertEqual(e.exception.status,404)
 def test_no_public_history_endpoint(self):self.assertEqual(self.client.get('/parameters/history').status_code,404)

class Concurrency(Fixture,TransactionTestCase):
 reset_sequences=False
 def setUp(self):self.create()
 def parallel(self,actions):
  barrier=Barrier(len(actions))
  def run(action):
   connections.close_all();barrier.wait()
   try:return ('OK',action())
   except Rejected as e:return(e.code,None)
   finally:connections.close_all()
  with ThreadPoolExecutor(max_workers=len(actions))as pool:return list(pool.map(run,actions))
 def test_two_initial_manual_writers_only_one_wins(self):
  q1=self.command(value='0.07');q2=self.command(value='0.12');result=self.parallel([lambda:s.execute(self.token,q1),lambda:s.execute(self.token,q2)])
  self.assertEqual(sorted(x[0]for x in result),['OK','PARAMETER_REVISION_CONFLICT']);self.assertEqual(CurrentParameter.objects.count(),1)
 def test_replayed_same_command_one_effect(self):
  q=self.command();r=self.parallel([lambda:s.execute(self.token,q),lambda:s.execute(self.token,q)]);self.assertTrue(all(x[0]=='OK'for x in r));self.assertEqual(CurrentParameter.objects.get().revision,1);self.assertEqual(OwnerCommand.objects.count(),1)
 def test_simultaneous_fill_one_value_no_version_rows(self):
  q1=self.command('fill_missing');q2=self.command('fill_missing');env=self.envelope()
  r=self.parallel([lambda:self.calculated(command=q1,envelope=env),lambda:self.calculated(command=q2,envelope=env)]);self.assertTrue(all(x[0]=='OK'for x in r));self.assertEqual(CurrentParameter.objects.count(),1);self.assertEqual(CurrentParameter.objects.get().revision,1)
 def test_manual_change_beats_stale_completed_calculation(self):
  self.save('0.07');job=self.command('replace_calculated',revision=1);env=self.envelope();self.save('0.13',1)
  with self.assertRaises(Rejected):self.calculated(command=job,envelope=env)
  self.assertEqual(CurrentParameter.objects.get().value,'0.13');self.assertEqual(CurrentParameter.objects.count(),1)


class DependencyPlanning(UnitCase):
 def view(self,value='0',area=None):
  return {'parameter':'loss_rate','store_id':'synthetic-store','scope':area or deepcopy(AREA),'revision':7,
    'inherited':False,'effective':{'value':value,'unit':'ratio','origin':'calculated','collected_at':'2023-01-01T00:00:00Z','revision':7}if value is not None else None}
 def plan(self,view,**kw):
  from alisa_platform.owner_data.parameter_resolution import plan_parameter
  return plan_parameter('loss_rate',view,date(2026,11,14),**kw)
 def test_old_value_does_not_trigger_refresh(self):self.assertFalse(self.plan(self.view('0.1'))['collect'])
 def test_zero_does_not_trigger_refresh(self):self.assertFalse(self.plan(self.view())['collect'])
 def test_status_never_collects_even_if_missing(self):self.assertFalse(self.plan(self.view(None),action='status')['collect'])
 def test_missing_uses_year_producer(self):
  p=self.plan(self.view(None));self.assertEqual(p['parameter_period'],PERIOD);self.assertEqual(p['write_intent'],'fill_missing')
 def test_report_sku_does_not_narrow_missing_general_scope(self):
  p=self.plan(self.view(None,{'kind':'sku','sku':'123'}));self.assertEqual(p['scope'],AREA);self.assertTrue(p['read_target_revision_before_collection']);self.assertIsNone(p['expected_revision'])
 def test_explicit_sku_recalculation_keeps_scope(self):
  p=self.plan(self.view('0.1',{'kind':'sku','sku':'123'}),action='recalculate');self.assertEqual(p['scope']['kind'],'sku');self.assertEqual(p['expected_revision'],7)
 def test_preview_never_writes(self):self.assertFalse(self.plan(self.view('0.1'),action='preview')['persist'])
 def test_recalculate_uses_requested_half_year(self):
  p=self.plan(self.view('0.1'),action='recalculate',period_request={'months':6});self.assertEqual(p['parameter_period']['actual']['from'],'2026-05-14');self.assertEqual(p['write_intent'],'replace_calculated')
 def test_unknown_action_not_implicit_recalculation(self):
  with self.assertRaises(c.ParameterError):self.plan(self.view(),action='nightly_refresh')


class ParameterDefinitionCompatibility(UnitCase):
 view=DependencyPlanning.view
 plan=DependencyPlanning.plan
 def test_changed_unit_does_not_silently_apply_or_refresh(self):
  view=self.view('0.1');view['effective']['unit']='RUB'
  with self.assertRaises(c.ParameterError)as e:self.plan(view)
  self.assertEqual(e.exception.code,'PARAMETER_UNIT_CHANGED')
