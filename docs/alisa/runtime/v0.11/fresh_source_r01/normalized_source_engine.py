"""Declarative projection, exact source binding and scenario qualification.
No HTTP or persistent context. Provider paths, type names and money fields are
catalogue data. This candidate verifies a bounded evidence bundle; it does not
install a voice endpoint or impersonate the platform's production authority.
"""
from pathlib import Path
from copy import deepcopy
from datetime import datetime,timezone
from decimal import Decimal,localcontext
import hashlib,json,sys,time
ROOT=Path(__file__).parent
CALC=ROOT/'calculation'
sys.path[:0]=[str(CALC),str(CALC/'dependencies')]
from matrix_core import evaluate,validate_expression,decimal_text,source_decimal_text,MatrixError
from cost_source_selector import CostSourceSelector,digest,number,SelectionError
from scenario_selection_adapter import expand_catalogs,expense_envelope
from scenario_bindings import ScenarioBindings

class SourceError(ValueError):pass

def need(ok,code):
 if not ok:raise SourceError(code)

def env(payload):return {'payload':payload,'sha256':digest(payload)}
def d(value):return Decimal(source_decimal_text(value))
def txt(value):return decimal_text(value)
def stamp(value):return int(datetime.fromisoformat(value).timestamp())
def unique(rows,fields):
 out={}
 for row in rows:
  key=tuple(row[f]for f in fields);need(key not in out,'AMBIGUOUS_JOIN_KEY');out[key]=row
 return out

def project_source(policy,source,documents):
 all_rows=[];seen=set()
 for body,proof in documents:
  records=evaluate(source['items'],{'response':body});need(type(records)is list,'SOURCE_ARRAY')
  for row in records:
   if evaluate(source['include'],{'row':row})is not True:continue
   outputs=evaluate(source['project'],{'row':row});need(type(outputs)is list,'SOURCE_PROJECT_ARRAY')
   for output in outputs:
    need(type(output)is dict and all(not k.startswith('_')for k in output),'SOURCE_PROJECT_FIELDS')
    key=tuple(output[k]for k in source['identity']);need(key not in seen,'DUPLICATE_NORMALIZED_ROW');seen.add(key)
    all_rows.append({**output,'_proof':proof});need(len(all_rows)<=policy['max_rows'],'SOURCE_ROW_CAPACITY')
 return all_rows

class QualifiedSourceNormalizer:
 def __init__(self,policy,manifest,*,now=None,evidence_root=None,scope_guard=None):
  self.policy=deepcopy(policy);self.manifest=deepcopy(manifest);self.now=int(now or time.time());self.hash=digest(policy);self.code_hash=hashlib.sha256(Path(__file__).read_bytes()).hexdigest();self.data={};self.proofs={};self.documents={};self.evidence_root=Path(evidence_root or '/var/lib/alice-lab/probe-reports').resolve();self.scope_guard=scope_guard
  need(policy['schema']=='alice-normalized-source-policy/v1','NORMALIZER_SCHEMA');need(manifest['state']=='ACQUIRED_COMPLETE','SOURCE_BUNDLE_INCOMPLETE')
  for spec in policy['tables'].values():
   for key,roots in [('items',{'response'}),('include',{'row'}),('project',{'row'})]:validate_expression(spec[key],roots)
  for spec in policy['tables'].values():
   role=spec['source']
   if role in self.documents:continue
   source=manifest['sources'].get(role);need(type(source)is dict and source['complete']is True and source['scope_hash']==manifest['scope_hash'],'SOURCE_COVERAGE')
   docs=[]
   for page in source['pages']:
    receipt=next(r for r in manifest['requests']if r['seq']==page['seq']);need(receipt['state']=='RECEIVED' and receipt['http']==200,'SOURCE_RECEIPT')
    issued=stamp(receipt['finished_utc']);need(issued<=self.now<issued+policy['max_age_seconds'],'SOURCE_EVIDENCE_EXPIRED')
    path=Path(page['parsed_body_path']);need(not path.is_symlink() and path.resolve().parent==self.evidence_root,'SOURCE_EVIDENCE_PATH')
    raw=path.read_bytes();need(hashlib.sha256(raw).hexdigest()==page['sha256'],'SOURCE_EVIDENCE_CHANGED')
    proof={'source':role,'body_hash':page['sha256'],'recipe_hash':source['recipe_hash'],'observed_at':issued,'expires_at':issued+policy['max_age_seconds'],'period':source['period']}
    docs.append((json.loads(raw),proof))
   self.documents[role]=docs
  for name,spec in policy['tables'].items():self.data[name]=project_source(policy,spec,self.documents[spec['source']])
  self.source_hash=digest({k:[p for _,p in v]for k,v in self.documents.items()})
  self.expiry=min(p['expires_at']for v in self.documents.values()for _,p in v)

 def prepare_data(self):
  p=self.policy;tables=self.data;period=self.manifest['period'];orders=[deepcopy(r)for name in p['cohort_tables']for r in tables[name]]
  need(0<len(orders)<=200,'COHORT_CAPACITY');unique(orders,['key']);unique(orders,['order','sku'])
  products=unique(tables[p['product_table']],['sku','offer']);tariffs=unique(tables[p['tariff_table']],['product','offer','scheme']);types=unique(tables[p['dictionary_table']],['type_id'])
  for order in orders:
   need(order['currency']==p['currency'] and order['status']in p['allowed_order_statuses'],'COHORT_CURRENCY_OR_STATUS')
   need(period['from']<=order['day']<=period['to'],'COHORT_OUTSIDE_PERIOD');need(not order['parent'] and order['external']is False,'COHORT_PARENT_OR_EXTERNAL')
   q=d(order['units']);x=d(order['excluded']);need(q==q.to_integral_value()and x==x.to_integral_value()and 0<=x<=q and q>0,'COHORT_QUANTITY')
   product=products.get((order['sku'],order['offer']));need(product is not None,'PRODUCT_MAPPING_MISSING');tariff=tariffs.get((product['product'],order['offer'],order['scheme']));need(tariff is not None,'TARIFF_MAPPING_MISSING')
   need(tariff['currency']==order['currency'],'TARIFF_CURRENCY');order['_tariff']=tariff;order['product_entity']='sku:'+order['sku']
  facts=[];keys=set();used_type_names=set()
  for name in p['actual_tables']:
   for original in tables[name]:
    row=deepcopy(original);need(row['currency']==p['currency'],'ACTUAL_CURRENCY')
    need(row['_proof']['period']['from']<=row['date']<=row['_proof']['period']['to'],'ACTUAL_DATE_OUTSIDE_LOOKUP')
    if 'type_id'in row:
     kind=types.get((row['type_id'],));need(kind is not None,'ACCRUAL_TYPE_MISSING');row['type_name']=kind['type_name'];used_type_names.add(row['type_name'])
    need(row['key']not in keys,'DUPLICATE_ACCRUAL_ACROSS_DAYS');keys.add(row['key']);facts.append(row)
  bypost=unique(orders,['posting','sku']);byorder=unique(orders,['order','sku']);known_types={n for rule in p['profiles'].values()for n in rule['actual_types']};matched=[]
  for fact in facts:
   need(fact['reference_kind']in ('order','posting'),'UNKNOWN_REFERENCE_KIND');index=byorder if fact['reference_kind']=='order'else bypost
   order=index.get((fact['reference'],fact['sku']))
   if order is None:continue
   need(fact['type_name']in known_types,'MATCHED_COST_TYPE_NOT_CLASSIFIED');need(d(fact['quantity'])==d(order['units']),'ACTUAL_QUANTITY_AMBIGUOUS');matched.append((order['key'],fact))
  self.orders=orders;self.facts=facts;self.matched=matched
  return {'order_rows':len(orders),'ordered_units':txt(sum(d(r['units'])for r in orders)),'excluded_units':txt(sum(d(r['excluded'])for r in orders)),
   'seller_value':txt(sum(d(r['units'])*d(r['unit_price'])for r in orders)),'remaining_seller_value':txt(sum((d(r['units'])-d(r['excluded']))*d(r['unit_price'])for r in orders)),
   'actual_cost_records_matched':len(matched),'acquiring_rows_matched':sum(r['type_name']=='Acquiring'for _,r in matched),'unused_actual_cost_records':len(facts)-len(matched),'source_hash':self.source_hash}

 def reconcile(self):
  p=self.policy;services=unique(self.data['overhead'],['name']);names={k[0]for k in services};allowed=set(p['overhead_components'].values())|set(p['excluded_store_period_variables'])
  need(names<=allowed,'UNCLASSIFIED_FINANCE_SERVICE');need(set(p['overhead_components'].values())<=names,'OVERHEAD_COMPONENT_MISSING')
  for row in services.values():need(row['currency']==p['currency'],'FINANCE_CURRENCY')
  values={component:services[(name,)]['amount']for component,name in p['overhead_components'].items()}
  ads=self.data['ads_daily'];need(ads,'ADVERTISING_EMPTY_UNCONFIRMED');need(all(self.manifest['period']['from']<=r['date']<=self.manifest['period']['to']for r in ads),'ADVERTISING_PERIOD')
  adsum=sum(d(x['amount'])for x in ads);need(adsum==sum(d(values[k])for k in p['advertising_components']),'ADVERTISING_FINANCE_DISAGREEMENT')
  control_env={'sources':{name:[doc for doc,_ in pages]for name,pages in self.documents.items()},'tables':self.data}
  for check in p['control_currency_checks']:
   validate_expression(check,{'sources','tables'});need(evaluate(check,control_env)is True,'FINANCE_CURRENCY')
  for check in p['control_contracts']:
   for expression in (check['left'],check['right']):validate_expression(expression,{'sources','tables'})
   need(d(evaluate(check['left'],control_env))==d(evaluate(check['right'],control_env)),check['error'])
  financial=d(evaluate(p['financial_result'],control_env))
  self.overhead=values
  return {'advertising_total':txt(adsum),'overhead':values,'financial_day_accrued':txt(financial),'daily_accruals_reconcile':True,'finance_services_classified':len(names),
   'not_added_store_period_variable_costs':{name:services[(name,)]['amount']for name in p['excluded_store_period_variables']if(name,)in services},
   'excluded_variable_reason':'These historical store-day amounts are not added on top of matched/current-tariff costs of the original ordered cohort.'}

 def catalogs(self):
  p=self.policy;c=json.loads((CALC/'scenario_catalog.json').read_text());g=json.loads((CALC/'scenario_report_catalog.json').read_text());o=json.loads((CALC/'owner_input_catalog.json').read_text())
  selector=json.loads((CALC/'cost_selection_catalog.json').read_text());selector['version']='20261105-fresh-source-cost-r1'
  for base,names in p['scenario_source_expansions'].items():
   for name in names:
    need(name not in c['sources'],'COMPONENT_NAME_COLLISION');c['sources'][name]={**deepcopy(c['sources'][base]),'label':p['labels'][name]};g['policies']['cohort_scenario']['components'][name]=deepcopy(g['policies']['cohort_scenario']['components'][base])
   c['sources'].pop(base);g['policies']['cohort_scenario']['components'].pop(base);c['output']['cost_components']=[n for old in c['output']['cost_components']for n in(names if old==base else[old])]
  c['row_schema'].update(deepcopy(p['additional_cohort_schema']))
  selector['components']={}
  for name,r in p['profiles'].items():
   bases=['ACTUAL_MATCHED','API_TARIFF_ESTIMATE'];selector['components'][name]={'priority':bases,'methods':{'ACTUAL_MATCHED':['line_amount'],'API_TARIFF_ESTIMATE':[r['tariff_method']]},'allow_negative_actual':True,'percent_base':{'$path':['row','seller_unit_price']}if r['tariff_method']=='explicit_percent'else'0'}
  selector['scenarios']={sid:{name:p['quantity_expressions'][r['quantity'][mode]]for name,r in p['profiles'].items()}for sid,mode in p['scenarios'].items()}
  c,g=expand_catalogs(c,g,selector)
  return selector,c,g,o

 def envelopes(self,selector_catalog,scenario_runtime):
  p=self.policy;context={'scope_hash':self.manifest['scope_hash'],'store_entity':'store:'+self.manifest['scope_hash'][:24],'currency':'RUB','period':deepcopy(self.manifest['period']),'as_of':stamp(self.manifest['started_utc'])}
  common={'revision':'fresh-source-r1','scope_hash':context['scope_hash'],'store_entity':context['store_entity'],'currency':'RUB','period':context['period'],'issued_at':self.now,'expires_at':self.expiry,'normalization_hash':digest({'source':self.source_hash,'policy':self.hash,'code':self.code_hash})}
  cohort=env({'schema':'alice-qualified-cohort/v1',**common,'coverage':'COMPLETE','rows':[{'line_id':'line:'+r['key'],'product_entity':r['product_entity'],'basis_day':r['day'],'original_units':r['units'],'excluded_units':r['excluded'],'seller_unit_price':r['unit_price'],'scheme':r['scheme']}for r in self.orders]})
  candidates=[];candidate_notes=[];bykey={r['key']:r for r in self.orders}
  for sid,mode in p['scenarios'].items():
   for row in cohort['payload']['rows']:
    original=bykey[row['line_id'].split(':',1)[1]];tariff=original['_tariff']
    for name,rule in p['profiles'].items():
     q=d(evaluate(selector_catalog['scenarios'][sid][name],{'row':row}))
     if q==0:continue
     actual=[fact for key,fact in self.matched if key==original['key']and fact['type_name']in rule['actual_types']]
     need(not actual or all(d(x['quantity'])==q for x in actual),'ACTUAL_SCENARIO_QUANTITY_MISMATCH')
     base={'scenario':sid,'component':name,'line_id':row['line_id'],'currency':'RUB','observed_at':self.now,'expires_at':self.expiry,'zero_proof':False}
     rid='c:'+digest([sid,name,row['line_id']])[:40]
     proof=digest([x['_proof']for x in actual]if actual else {'no_match_in_lookup':self.source_hash,'line':row['line_id'],'component':name})
     rec={**base,'id':rid+':a','basis':'ACTUAL_MATCHED','source_hash':self.source_hash,'receipt_hash':proof,'effective_on':None}
     if actual:
      total=sum(d(x['amount'])for x in actual);rec.update(state='COMPLETE',method='line_amount',values={'amount':txt(total)},covered_units=txt(q),zero_proof=total==0,expense_keys=['actual:'+x['key']for x in actual]);candidates.append(rec)
      candidate_notes.append({'line_id':row['line_id'],'component':name,'scenario':sid,'basis':'ACTUAL_MATCHED','records':len(actual),'amount':txt(total)})
     else:
      rec.update(state='UNAVAILABLE',method=None,values=None,covered_units=None,expense_keys=[]);candidates.append(rec)
      values={key:tariff[field]for key,field in rule['tariff_values'].items()};proof=digest(tariff['_proof']);rec={**base,'id':rid+':t','basis':'API_TARIFF_ESTIMATE','state':'COMPLETE','method':rule['tariff_method'],'values':values,'covered_units':txt(q),'source_hash':tariff['_proof']['recipe_hash'],'receipt_hash':proof,'effective_on':datetime.fromtimestamp(tariff['_proof']['observed_at'],timezone.utc).date().isoformat(),'zero_proof':all(d(v)==0 for v in values.values()),'expense_keys':['estimate:'+name+':'+row['line_id']]};candidates.append(rec)
  evidence=env({'schema':'alice-cost-candidates/v1',**common,'cohort_hash':cohort['sha256'],'records':candidates})
  retained={'schema':'alice-scenario-expenses/v1',**common,'scenarios':{}}
  for sid in p['scenarios']:
   rows=[]
   for name,value in {**self.overhead,'expense_coverage':'0','advertising_finance_overlap':'0'}.items():
    control=name in ('expense_coverage','advertising_finance_overlap');obs={'id':name,'state':'KNOWN','coverage':'COMPLETE','value':value,'currency':'RUB','period':context['period'],'scope_hash':context['scope_hash'],'axis':'reconciliation'if control else'scenario_cost','unit':'currency','source_hash':self.hash,'receipt_hash':self.source_hash,'observed_at':self.now,'expires_at':self.expiry,'zero_proof':d(value)==0,'expense_keys':[]if control or d(value)==0 else['period:'+name+':'+digest(context['period'])[:12]]}
    rows.append({'observation':obs,'basis':'VERIFIED_CONTROL'if control else'ACTUAL_PERIOD_ALLOCATION','allocation':None if control else{'mode':'whole_store_cohort_period','scope_hash':context['scope_hash'],'period':context['period'],'cohort_hash':cohort['sha256']}})
   retained['scenarios'][sid]=rows
  owner_entries=[{'id':'cost:'+r['product_entity'],'field':'unit_cost','entity':r['product_entity'],'currency':'RUB','period':context['period'],'state':'VALUE','value':p['owner_profile']['unit_cost']}for r in {r['product_entity']:r for r in self.orders}.values()]
  need(p['owner_profile']['tax']=='EXCLUDED_BY_OWNER','OWNER_TAX_POLICY');owner_entries.append({'id':'tax-explicit-exclusion','field':'tax_amount','entity':context['store_entity'],'currency':'RUB','period':context['period'],'state':'EXCLUDED_BY_OWNER','value':None})
  owner=env({'schema':'alice-owner-input-snapshot/v1','revision':'owner-approved-r9-example','scope_hash':context['scope_hash'],'catalog_hash':scenario_runtime.owner.hash,'issued_at':self.now,'expires_at':self.expiry,'entries':owner_entries})
  self.context=context;self.candidate_notes=candidate_notes
  return cohort,evidence,env(retained),owner,context

 def calculate(self):
  with localcontext()as context:
   context.prec=200
   return self._calculate()

 def _calculate(self):
  aggregates=self.prepare_data();controls=self.reconcile();selection_policy,c,g,o=self.catalogs();selector=CostSourceSelector(selection_policy);runtime=ScenarioBindings(c,o,g)
  cohort,evidence,retained,owner,context=self.envelopes(selection_policy,runtime)
  approved={'policy':{'hash':selector.hash,'code_hash':selector.code_hash},'cohort':cohort,'candidates':evidence,'retained_expenses':retained}
  def current_scope():
   if self.scope_guard is not None:return self.scope_guard()is True
   return hashlib.sha256(Path('/etc/alice-market/market-runtime.json').read_bytes()).hexdigest()==self.manifest['config_hash'] and int(time.time())<self.expiry
  def verify(kind,value,ctx,action):return current_scope() and ctx==context and action in ('read','execute')and kind in approved and value==approved[kind]
  selected=selector.select(cohort,evidence,context,verify=verify,now=self.now);need(selected['status']=='SELECTED','SOURCE_SELECTION_BLOCKED')
  expenses=expense_envelope(selected,evidence,cohort,context,retained,selector=selector,verify=verify,now=self.now)
  hashes={'policy':runtime.hash,'cohort':cohort['sha256'],'expenses':expenses['sha256']}
  def authorize(kind,metadata,ctx,action):return current_scope()and ctx==context and action in ('resolve','execute','read')and metadata['content_hash']==hashes[kind]
  entities={r['entity']for r in owner['payload']['entries']}
  def owner_authorize(metadata,request,action):return current_scope()and metadata['facts_sha256']==owner['sha256'] and metadata['scope_hash']==context['scope_hash'] and request['entity']in entities and action in ('resolve','execute','read')
  options={'authorize':authorize,'owner_authorize':owner_authorize,'now':self.now};pin=runtime.prepare(cohort,expenses,owner,context,**options);result=runtime.execute(pin,cohort,expenses,owner,context,**options)
  need(result['status']=='CALCULATED','SCENARIO_BLOCKED')
  self.artifacts={'cohort':cohort,'cost_evidence':evidence,'retained_expenses':retained,'selected':selected,'expenses':expenses,'owner':owner,'context':context,'pin':pin,'selection_catalog':selection_policy,'scenario_catalog':c,'gate_catalog':g,'result':result}
  return {'schema':'alice-fresh-scenario-qualification/v1','status':'REAL_SOURCE_CALCULATED_NOT_VOICE_RELEASE','aggregates':aggregates,'controls':controls,'actual_choices':self.candidate_notes,'source_window':{'cohort':self.manifest['period'],'actual_lookup':sorted({self.manifest['sources'][self.policy['tables'][t]['source']]['period']['from']for t in self.policy['actual_tables']}),'tariff_snapshot':datetime.fromtimestamp(self.documents[self.policy['tables'][self.policy['tariff_table']]['source']][0][1]['observed_at'],timezone.utc).date().isoformat()},'result':result,'production_installed':False,'voice_tested':False,'business_http_in_calculation':0}
