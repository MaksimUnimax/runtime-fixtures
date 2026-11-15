"""Full registered template through Query, private RPC and the real Worker.

Only provider/model replies and account data are synthetic. Access, signatures,
catalogue compilation, source receipts, owner resolution and fences are real.
"""
from copy import deepcopy
from datetime import datetime, timedelta, timezone as utc
from calendar import monthrange
from decimal import Decimal
from unittest import TestCase as UnitCase
from unittest.mock import patch
import json, uuid

from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from alisa_platform.queries import service as queries
from alisa_platform.queries.models import Query
from alisa_platform.runtime_adapter.authority import SessionPrincipal
from alisa_platform.stores.models import CredentialRevision, VaultSecret
from alisa_platform.owner_data import service as owner, parameter_service as parameters
from alisa_platform.owner_data.models import OwnerDataset, CurrentParameter
from current_parameters.collection_fixture import Environment
from economics_ledger.test_order_worker import capabilities
from economics_ledger.test_order_sources import posting, page
from economics_ledger.test_other_sources import entry, record
from economics_ledger.test_tariffs import price
from economics_ledger.test_realization import source as document_source, row as document_row
from test_parameter_worker import Transport as ParameterTransport
from test_template_only import selection
from test_finance_stock import oz_finance, money
from engine import Worker
from semantics import strict_json, canonical_json, Scope, Store
from protected_reads import ProtectedPayload
import parameter_report_runtime as report
import economics_report_runtime as full

TID=full.TEMPLATE
DAY='2026-11-13'
PERIOD={'from':DAY,'to':DAY}
PARAMETER_PERIODS={key:{'from':'2026-10-01','to':'2026-10-31'}for key in ('loss_rate','delivery_mean')}
POST_A='PRIVATE-FULL-POSTING-A'
POST_B='PRIVATE-FULL-POSTING-B'


def quote(pid,commission,acquiring,reverse,processing):
    value=price(pid,str(acquiring));value['commissions'].update(
        sales_percent_fbo=str(commission),sales_percent_fbs=str(commission),
        fbo_return_flow_amount=str(reverse),fbs_return_flow_amount=str(reverse),
        fbs_first_mile_min_amount='0',fbs_first_mile_max_amount=str(processing))
    return value


class Transport(ParameterTransport):
    def __init__(self):
        super().__init__();self.pending_once=False
        self.selection=selection([TID],store='native-store',inputs={'period':PERIOD,'parameter_periods':PARAMETER_PERIODS})
        self.orders={'fbo':[posting('fbo',POST_A,101,'1000',2)],'fbs':[posting('fbs',POST_B,102,'2000',1)]}
        self.quotes=[quote(1001,20,10,40,0),quote(1002,30,25,60,5)]
        self.skus={1001:101,1002:102};self.fees={POST_A:[entry('20')]};self.records=[record(amount='20',posting=POST_A)]
        self.storage='120';self.advertising='300';self.mutate=None;self.day=DAY;self.realization={}
    def execute(self,request,store):
        op=request.operation
        special=op in ('ds_ozon_fbo_postings','ds_ozon_fbs_postings','ozon_finance','ozon_ads_daily',
            'read.ozon.finance_accrual_postings','read.ozon.finance_accrual_by_day',
            'read.ozon.product_prices_bulk','read.ozon.seller_product_info_list',
            'read.ozon.finance_realization_posting','read.ozon.finance_realization_v2')
        if not special:return super().execute(request,store)
        self.calls.append(request)
        if self.on_call:self.on_call(request)
        if op.startswith('ds_ozon_'):
            scheme='fbo'if 'fbo'in op else'fbs';answer=page(self.orders[scheme])
        elif op=='read.ozon.finance_accrual_postings':
            answer={'posting_accruals':[{'posting_number':ident,'accruals':deepcopy(self.fees.get(ident,[]))}
                for ident in request.body['params']['posting_numbers']]}
        elif op=='read.ozon.finance_accrual_by_day':
            answer={'accruals':deepcopy(self.records)if request.body['params']['date']==self.day else[],'last_id':''}
        elif op=='read.ozon.product_prices_bulk':answer={'items':deepcopy(self.quotes),'cursor':'','total':len(self.quotes)}
        elif op=='read.ozon.seller_product_info_list':
            answer={'items':[{'id':int(pid),'sku':self.skus[int(pid)],'name':'PRIVATE FULL PRODUCT'}for pid in request.body['params']['product_id']]}
        elif op.startswith('read.ozon.finance_realization_'):
            params=request.body['params'];year=params['year'];month=params['month'];last=monthrange(year,month)[1]
            answer=document_source(self.realization.get((year,month),[]))
            answer['header'].update(number='SYNTHETIC-DOC-'+str(year)+'-'+str(month),
                doc_date=f'{year:04}-{month:02}-{last:02}',start_date=f'{year:04}-{month:02}-01',stop_date=f'{year:04}-{month:02}-{last:02}')
            if op.endswith('finance_realization_v2'):
                for value in answer['rows']:
                    value['rowNumber']=value.pop('row_number');value.pop('order');value.pop('legal_entity_document')
                answer={'result':answer}
            raw=json.dumps(answer).encode()
            return ProtectedPayload({'no_raw_to_model':True},raw,'application/json'),{'status':200,'bytes':len(raw),'elapsed_ms':1}
        elif op=='ozon_finance':
            answer=oz_finance()
            for item in answer['cashflows']['services']:
                if item['name']=='product_placement_in_ozon_warehouses':item['amount']=money('-'+self.storage)
        else:answer={'rows':[{'id':'123','date':self.day,'moneySpent':self.advertising,'title':'PRIVATE FULL CAMPAIGN'}]}
        if self.mutate:self.mutate(request,answer)
        return answer,{'status':200,'bytes':500,'elapsed_ms':1}


class CompositeFixture:
    def setUp(self):
        self.e=Environment();self.e.setup()
        secret=VaultSecret.objects.create(tenant=self.e.tenant,store=self.e.store,kind='PERFORMANCE',revision=1,
            key_version='fixture',ciphertext='SYNTHETIC-NOT-DECRYPTED')
        self.performance=CredentialRevision.objects.create(tenant=self.e.tenant,store=self.e.store,kind='PERFORMANCE',
            revision=1,secret=secret,status='ACTIVE',check_code='CONNECTED')
        self.e.mapping['environment']='synthetic'
        self.e.mapping['tenants'][0]['stores'][0]['credentials'].append({'kind':'PERFORMANCE','id':str(self.performance.pk),'revision':1})
        self.e.bindings.write_text(json.dumps(self.e.mapping))
        store=Store(**self.e.mapping['tenants'][0]['stores'][0]['runtime_store'])
        self.caps=capabilities(Scope('native-tenant','test',(store,)))
        self.e.engine.dataset_capabilities=lambda:self.caps
        self.e.engine.parameter_compound_policy={'enabled':True,'pin':report.PIN}
        self.e.engine.economics_composite_policy={'enabled':True,'pin':full.PIN}
        self.e.transport=Transport();self.e.worker=Worker(self.e.engine,self.e.transport)
        self.qid=str(uuid.uuid4());self.question='Полная экономика заказов Озон за 13 ноября: все расходы и оба сценария'
        self.facts={'product_map':{'102':'sku:102'},'entries':[
            self.entry('unit_cost','200','all-products'),self.entry('unit_cost','500','sku:102')]}
        self.approve()
    def tearDown(self):self.e.close()
    def entry(self,field,value,entity,period=None):
        return {'id':str(uuid.uuid4()),'field':field,'entity':entity,'currency':'RUB','period':deepcopy(period),
                'state':'NOT_PROVIDED'if value is None else'VALUE','value':value}
    def approve(self):
        previous=OwnerDataset.objects.filter(store=self.e.store).first()
        return owner.execute(self.e.token,{'action':'approve','store_id':str(self.e.store.pk),'command_id':str(uuid.uuid4()),
            'expected_revision':previous.revision if previous else 0,'confirmed':True,'facts':self.facts,
            'not_after':int(timezone.now().timestamp())+120})
    def delivery(self,value='50',revision=0,sku=None):
        command=self.e.command(value=value,revision=revision,area={'kind':'sku','sku':sku}if sku else None)
        command.update(parameter='delivery_mean',unit='RUB/ordered_unit');return parameters.execute(self.e.token,command)
    def filled(self):
        self.e.save('0.1');self.delivery();self.e.save('0',area={'kind':'sku','sku':'102'});self.delivery('70',sku='102')
    def start(self):return queries.submit(SessionPrincipal(self.e.token),self.qid,[str(self.e.store.pk)],self.question)
    def tick(self):
        row=self.e.row();self.e.clock.advance(max(1,row['due']-self.e.clock()+1));self.e.worker.step()
    def finish(self):
        for _ in range(350):
            row=self.e.row()
            if row['state']not in ('QUEUED','RUNNING'):return row
            self.tick()
        self.fail('full report did not finish in existing job')
    def ready(self):
        row=self.finish();self.assertEqual(row['state'],'READY',row.get('error'));return row
    def context(self):
        request=[item for item in self.e.transport.calls if item.operation=='model_answer'][-1]
        from model_input_encoding import PREFIX,V1_INSTRUCTION
        text=request.body['messages'][-1]['content'];self.assertTrue(text.startswith(PREFIX));text=text[len(PREFIX):]
        if text.startswith(V1_INSTRUCTION):
            packed=json.loads(text[len(V1_INSTRUCTION):]);schemas=packed['schemas']
            def decode(value):
                if type(value)is dict:return dict(zip(schemas[value['@']],(decode(item)for item in value['v']),strict=True))
                if type(value)is list:return [decode(item)for item in value]
                return value
            data=decode(packed['data'])
        else:data=json.loads(text)
        return data['compound_parameter_context'][0]['economics']
    def provider_ops(self):return [item.operation for item in self.e.transport.calls if item.store_id]
    def pending(self):
        for _ in range(150):
            self.tick();row=self.e.row()
            if row['progress']and '_answer_pending'in strict_json(row['progress']):return
            self.assertIn(row['state'],('RUNNING','QUEUED'),row.get('error'))
        self.fail('no final-answer checkpoint')


@override_settings(ALISA_ENV='synthetic',OWNER_ECONOMICS_COMPOSITES_ENABLED=True)
class Composite(CompositeFixture,TransactionTestCase):
    def test_full_registered_template_nine_groups_two_scenarios_and_one_job(self):
        self.filled();before=list(CurrentParameter.objects.order_by('key','sku').values());self.start();row=self.ready()
        result=self.context();loss=result['scenarios']['with_loss'];plain=result['scenarios']['without_loss']
        expected={'original_units':'3','original_turnover':'4000','expected_retained_units':'2.8','revenue':'3800',
            'commission':'960','acquiring':'45','forward_last':'170','reverse':'8','processing':'2.5','storage':'120',
            'advertising':'300','other':'-20','cogs':'860','all_selected_costs':'2445.5','remainder_before_owner_inputs':'1354.5','drr_percent':'7.5'}
        for key,value in expected.items():self.assertEqual(loss['totals'][key],value,key)
        self.assertEqual(plain['totals']['remainder_before_owner_inputs'],'1482.5')
        self.assertEqual(Decimal(loss['per_original_unit']['remainder_before_owner_inputs']),Decimal('451.5'))
        self.assertIsNone(loss['after_declared_owner_inputs']);self.assertEqual(before,list(CurrentParameter.objects.order_by('key','sku').values()))
        self.assertTrue(result['observed_other']['observed_approved_other_complete'])
        self.assertFalse(result['observed_other']['financial_history_final'])
        self.assertEqual(Query.objects.count(),1);self.assertIsNone(row['progress'])
        with self.e.repo.connection()as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*)FROM jobs').fetchone()[0],1)
            self.assertEqual(connection.execute("SELECT COUNT(*)FROM calls WHERE state!='RECEIVED'").fetchone()[0],0)
        ops=self.provider_ops();self.assertEqual(ops.count('ds_ozon_fbo_postings'),1);self.assertEqual(ops.count('ds_ozon_fbs_postings'),1)
        self.assertNotIn('read.ozon.returns_list',ops);self.assertEqual(sum(r.operation=='model_answer'for r in self.e.transport.calls),1)

    def test_closed_month_realization_pair_replaces_tariff_with_qualified_zero(self):
        self.filled();day='2026-10-31';self.e.clock.now=datetime(2026,11,1,6,tzinfo=utc.utc).timestamp()
        self.e.transport.day=day
        self.e.transport.selection=selection([TID],store='native-store',inputs={'period':{'from':day,'to':day},'parameter_periods':PARAMETER_PERIODS})
        for scheme,items in self.e.transport.orders.items():
            for item in items:item['created_at']=item['in_process_at']=day+'T09:00:00Z'
        self.e.transport.fees={POST_A:[entry('20',day=day)]};self.e.transport.records=[record(amount='20',posting=POST_A,day=day)]
        realized=document_row(posting=POST_A,sku=101,q=2,price='1000',ratio='0');realized['order']['created_date']=day
        self.e.transport.realization={(2026,10):[realized]}
        self.start();self.ready();result=self.context()['scenarios']['with_loss']
        self.assertEqual(result['totals']['commission'],'600')
        self.assertEqual(result['totals']['remainder_before_owner_inputs'],'1714.5')
        self.assertEqual(self.provider_ops().count('read.ozon.finance_realization_posting'),1)
        self.assertEqual(self.provider_ops().count('read.ozon.finance_realization_v2'),1)
        basis=next(item['basis']for item in result['source_basis']if item['sku']=='101')
        self.assertEqual(basis['commission_original']['kind'],'REALIZATION_BASE_COMMISSION_SNAPSHOT')
        self.assertFalse(basis['commission_original']['return_netted'])

    def test_no_values_or_private_postings_in_query_plan_or_result_marker(self):
        self.filled();self.start();row=self.ready()
        for value in (Query.objects.get().continuation,strict_json(row['plan']),strict_json(row['result'])):
            text=json.dumps(value)
            for private in (POST_A,POST_B,'PRIVATE FULL CAMPAIGN',self.e.token,'"unit_costs"','"coefficients"'):
                self.assertNotIn(private,text)

    def test_parameter_edit_during_final_model_reuses_all_marketplace_sources(self):
        self.filled();self.start();changed=[]
        def change(request):
            if request.operation=='model_answer'and not changed:changed.append(True);self.e.save('0.2',1)
        self.e.transport.on_call=change;self.ready()
        self.assertEqual(sum(r.operation=='model_answer'for r in self.e.transport.calls),2)
        self.assertEqual(self.provider_ops().count('ds_ozon_fbo_postings'),1)
        self.assertEqual(self.provider_ops().count('read.ozon.finance_accrual_postings'),1)
        self.assertEqual(self.context()['scenarios']['with_loss']['totals']['expected_retained_units'],'2.6')

    def test_owner_cost_edit_during_final_model_rebinds_without_source_repeat(self):
        self.filled();self.start();changed=[]
        def change(request):
            if request.operation=='model_answer'and not changed:
                changed.append(True);self.facts['entries'][0]['value']='300';self.approve()
        self.e.transport.on_call=change;self.ready()
        self.assertEqual(sum(r.operation=='model_answer'for r in self.e.transport.calls),2)
        self.assertEqual(self.provider_ops().count('ozon_finance'),1)
        self.assertEqual(self.context()['scenarios']['with_loss']['totals']['cogs'],'1040')

    def test_missing_coefficient_filled_in_same_job_manual_write_wins(self):
        self.delivery();self.start();changed=[]
        def change(request):
            if request.operation=='read.ozon.returns_list'and not changed:changed.append(True);self.e.save('0.2')
        self.e.transport.on_call=change;self.ready();self.assertTrue(changed)
        self.assertEqual(CurrentParameter.objects.get(key='loss_rate').value,'0.2')
        self.assertEqual(self.context()['scenarios']['with_loss']['totals']['expected_retained_units'],'2.4')
        with self.e.repo.connection()as connection:self.assertEqual(connection.execute('SELECT COUNT(*)FROM jobs').fetchone()[0],1)

    def test_empty_orders_requires_complete_sources_but_no_coefficients_or_tariffs(self):
        self.e.transport.orders={'fbo':[],'fbs':[]};self.e.transport.fees={};self.e.transport.records=[]
        self.start();self.ready();result=self.context()['scenarios']['with_loss']
        self.assertEqual(result['totals']['original_units'],'0');self.assertIsNone(result['per_original_unit']['revenue'])
        self.assertFalse(CurrentParameter.objects.exists());self.assertNotIn('read.ozon.product_prices_bulk',self.provider_ops())
        self.assertNotIn('read.ozon.finance_accrual_postings',self.provider_ops())

    def test_disabled_native_full_template_cannot_run_supported_scalar_half(self):
        self.e.engine.economics_composite_policy={'enabled':False,'pin':full.PIN}
        self.e.transport.selection=selection([TID,'B01.ordered_units'],store='native-store',inputs={'period':PERIOD})
        self.start();self.finish();self.assertEqual(self.provider_ops(),[])

    def test_disabled_platform_full_template_stops_before_provider(self):
        with override_settings(OWNER_ECONOMICS_COMPOSITES_ENABLED=False):self.start();self.finish()
        self.assertEqual(self.provider_ops(),[])

    def test_unapproved_owner_dataset_stops_before_provider(self):
        OwnerDataset.objects.filter(store=self.e.store).update(status='REVOKED')
        self.start();self.finish();self.assertEqual(self.provider_ops(),[])

    def test_missing_dataset_capability_stops_entire_compilation(self):
        self.caps['native-store'].pop('ds_ozon_fbs_postings');self.start();self.finish();self.assertEqual(self.provider_ops(),[])

    def test_unavailable_coefficient_producer_stops_before_any_source(self):
        self.e.engine.parameter_source_policy={'enabled':False,'pin':report.sources.PIN}
        self.start();self.finish();self.assertEqual(self.provider_ops(),[])

    def test_cancelled_query_cannot_resume_or_publish(self):
        self.filled();self.start();self.tick();self.tick()
        Query.objects.update(state='CANCELLED');row=self.finish();self.assertEqual(row['state'],'FAILED')
        self.assertEqual(self.provider_ops(),[])

    def test_unknown_sku_cogs_is_not_inherited_and_never_reaches_model(self):
        self.filled();self.facts['entries'][1].update(state='NOT_PROVIDED',value=None);self.approve()
        self.start();row=self.finish();self.assertEqual(row['state'],'FAILED')
        self.assertNotIn('model_answer',[r.operation for r in self.e.transport.calls])

    def test_restart_before_final_answer_uses_same_source_packets(self):
        self.filled();self.start();self.pending();before=self.provider_ops()
        self.e.worker=Worker(self.e.engine,self.e.transport);self.ready();self.assertEqual(self.provider_ops(),before)

    def test_revoked_order_receipt_after_answer_staging_cannot_reach_model(self):
        self.filled();self.start();self.pending();before=self.provider_ops()
        with self.e.repo.connection(True)as connection:
            changed=connection.execute("UPDATE calls SET http=500 WHERE source LIKE '%:ds_ozon_fbo_postings'").rowcount
            self.assertEqual(changed,1)
        row=self.finish();self.assertEqual(row['state'],'FAILED')
        self.assertEqual(self.provider_ops(),before)
        self.assertNotIn('model_answer',[request.operation for request in self.e.transport.calls])

    def test_native_owner_revoked_after_answer_staging_cannot_reach_model(self):
        self.filled()
        CredentialRevision.objects.filter(pk=self.performance.pk).update(check_code='CONNECTED_NATIVE_OWNER')
        before_values=list(CurrentParameter.objects.order_by('key','sku').values())
        self.start();self.pending();before_calls=self.provider_ops()
        CredentialRevision.objects.filter(pk=self.performance.pk).update(status='REVOKED')
        row=self.finish();self.assertEqual(row['state'],'FAILED')
        self.assertEqual(self.provider_ops(),before_calls)
        self.assertNotIn('model_answer',[request.operation for request in self.e.transport.calls])
        self.assertEqual(before_values,list(CurrentParameter.objects.order_by('key','sku').values()))

    def test_native_owner_marker_on_seller_stops_before_provider(self):
        self.filled()
        CredentialRevision.objects.filter(pk__in=(self.performance.pk,self.e.credential.pk)).update(
            check_code='CONNECTED_NATIVE_OWNER')
        self.start();row=self.finish();self.assertEqual(row['state'],'FAILED')
        self.assertEqual(self.provider_ops(),[])
        self.assertNotIn('model_answer',[request.operation for request in self.e.transport.calls])

    def test_more_than_sixtyfour_sku_days_with_native_owner_are_batched_without_source_repetition(self):
        # A valid, substantial owner dataset must fit the existing private RPC
        # deadline as well as the tiny all-products fixture. Unrelated mappings
        # remain subject to complete structural validation on every fresh read.
        # The existing Performance provenance changes neither the real Query
        # authority path nor the size of the data checked by each owner batch.
        CredentialRevision.objects.filter(pk=self.performance.pk).update(check_code='CONNECTED_NATIVE_OWNER')
        for sku in range(1000,1130):
            self.facts['product_map'][str(sku)]='sku:'+str(sku)
            self.facts['entries'].append(self.entry('unit_cost','250','sku:'+str(sku)))
        self.approve()
        self.e.save('0');self.delivery('0');self.e.transport.orders={'fbo':[posting('fbo','PRIVATE-BATCH-'+str(i),i,'100',1)for i in range(100,165)],'fbs':[]}
        self.e.transport.quotes=[quote(i+1000,20,10,40,0)for i in range(100,165)]
        self.e.transport.skus={i+1000:i for i in range(100,165)};self.e.transport.fees={};self.e.transport.records=[]
        self.start();self.ready();result=self.context();self.assertEqual(result['scenarios']['with_loss']['totals']['original_units'],'65')
        from alisa_platform.owner_data.parameter_report_rpc import KEY
        nodes=Query.objects.get().continuation[KEY];self.assertEqual(len(nodes),9)
        self.assertEqual(sorted(len(n['owner_readset']['readset']['rows'])for n in nodes.values()),[1]+[8]*8)
        self.assertEqual(self.provider_ops().count('ds_ozon_fbo_postings'),1)
        self.performance.refresh_from_db()
        self.assertEqual((self.performance.status,self.performance.check_code),('ACTIVE','CONNECTED_NATIVE_OWNER'))


class CompositeBindings(UnitCase):
    def test_selector_id_cannot_alias_another_invocations_owner_batch(self):
        fragments=[{'id':'fragment-'+str(index),'plan':{'parameter_report':{
            'invocation_id':ident,'input':{'period':PERIOD}}}}for index,ident in enumerate(('i0','i0:owner:1'))]
        with patch.object(report,'_bind',side_effect=lambda worker,row,root,fragment:{
                'reference':fragment['plan']['parameter_report']['invocation_id']}):
            first=full._bind(None,None,None,fragments[0],0)
            extra=full._bind(None,None,None,fragments[0],1)
            explicit=full._bind(None,None,None,fragments[1],0)
            self.assertEqual(len({first,extra,explicit}),3)
            self.assertEqual(extra,full._bind(None,None,None,fragments[0],1))
