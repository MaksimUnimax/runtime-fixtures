#!/usr/bin/env python3
"""Validate documentation only. No product tests or network calls."""
from __future__ import annotations
import argparse, copy, hashlib, json, re, sys
from pathlib import Path
from datetime import datetime, timezone
import yaml
from jsonschema import Draft202012Validator, FormatChecker
ROOT=Path(__file__).resolve().parents[1]

def load(path):return json.loads((ROOT/path).read_text(encoding='utf-8'))
def schedule_errors(steps,tests):
 errors=[];byid={s['id']:s for s in steps}
 if len(byid)!=len(steps):errors.append('duplicate step')
 if [s['order'] for s in steps]!=list(range(0,len(steps))):errors.append('unordered steps')
 prod={}
 for s in steps:
  for c in s['produces']:
   if c in prod:errors.append('duplicate capability '+c)
   prod[c]=s['order']
 for s in steps:
  for cap in s['consumes']:
   if cap not in prod or prod[cap]>=s['order']:errors.append(s['id']+':unavailable '+cap)
  for dep in s['requires_steps']:
   if dep not in byid or byid[dep]['order']>=s['order']:errors.append(s['id']+':future dependency '+dep)
  if s['order']>0 and s['previous_in_default_order']!=steps[s['order']-1]['id']:errors.append('default order gap')
 for t in tests:
  st=byid.get(t['execution_step'])
  if st is None:errors.append('unassigned '+t['id']);continue
  for cap in t['requires_capabilities']:
   if cap not in prod or prod[cap]>st['order']:errors.append(t['id']+':future test capability '+cap)
 return errors

def refs(obj):
 if isinstance(obj,dict):
  if '$ref' in obj:yield obj['$ref']
  for x in obj.values():yield from refs(x)
 elif isinstance(obj,list):
  for x in obj:yield from refs(x)
def resolve(root,ref):
 if not ref.startswith('#/'):raise ValueError('unsupported external ref')
 for key in ref[2:].split('/'):
  root=root[key.replace('~1','/').replace('~0','~')]
 return root

def validate():
 checks=[]
 def check(name,ok,detail=None):checks.append({'check':name,'passed':bool(ok),'detail':detail})
 steps=load('data/roadmap.json');tests=load('data/acceptance.json');old=load('sources/ACCEPTANCE_v0.2.json')
 functions=load('data/functions.json');reqs=load('data/requirements.json');base=load('data/baseline_acceptance.json');owners=load('data/owner_requirements.json')
 tid={t['id']:t for t in tests};sid={s['id']:s for s in steps};fid={f['id'] for f in functions}
 check('linear_steps_unique',len(steps)==25 and len(sid)==25 and [s['id'] for s in steps]==[f'AL-S{x:02}' for x in range(0,25)])
 check('test_ids_unique',len(tid)==len(tests))
 check('sequence_and_declared_test_dependencies',not schedule_errors(steps,tests),schedule_errors(steps,tests))
 check('every_step_has_demo_and_acceptance',all(s['build'] and s['demo'] and s['preconditions'] and s['acceptance_result'] and s['test_ids'] for s in steps))
 check('test_links_bidirectional',all(tid[t]['execution_step']==s['id'] for s in steps for t in s['test_ids']) and all(t['id'] in sid[t['execution_step']]['test_ids'] for t in tests))
 fields=['id','feature_id','category','preconditions','steps','expected','required_evidence','status','actual']
 check('all_120_original_test_semantics_unchanged',len(old)==120 and all(all(tid[t['id']].get(k)==t.get(k) for k in fields) for t in old))
 source=(ROOT/'sources/BLUEPRINT_v0.1.md').read_bytes();status=load('data/STATUS.json')
 check('original_blueprint_hash',hashlib.sha256(source).hexdigest()==status['blueprint_sha256'])
 src_a={};src_u={}
 for line in source.decode().splitlines():
  cols=[x.strip() for x in line.split('|')][1:-1]
  if len(cols)==3 and re.fullmatch(r'A\d{2}',cols[0]):src_a[cols[0]]=cols[1:]
  if len(cols)==3 and re.fullmatch(r'U\d{2}',cols[0]):src_u[cols[0]]=cols[1:]
 check('A01_A35_verbatim',len(base)==35 and all(src_a.get(b['id'])==[b['check'],b['expected']] for b in base))
 check('U01_U10_verbatim',all(src_u.get(o['id'])==[o['requirement'],o['implication']] for o in owners if o['id'] in src_u))
 check('baseline_coverage_resolves',all(b['test_ids'] and set(b['test_ids'])<=tid.keys() for b in base))
 check('requirements_preserved_and_mapped',len(reqs)==70 and all(r['features'] and set(r['features'])<=fid and r['execution_steps'] and set(r['execution_steps'])<=sid.keys() for r in reqs))
 check('only_unexecuted_product_statuses',all(s['status']=='NOT_STARTED' and s['assignee'] is None for s in steps) and all(t['status']=='NOT_RUN' and t['actual'] is None for t in tests))
 check('explicit_first_step',status['current_next_step']=='AL-S00' and 'foundation_receipt' in sid['AL-S00']['produces'] and 'web_origin' in sid['AL-S01']['produces'] and 'private_home' in sid['AL-S02']['produces'])
 check('checkout_includes_confirmed_access',{'checkout_ui','payment_confirmed_grant'}<=set(sid['AL-S20']['produces']))
 check('pilot_before_money_but_after_restoration',all(int(d[-2:])<19 for d in sid['AL-S19']['requires_steps']) and 'restore_proof' in sid['AL-S19']['consumes'])
 # Negative tests of the explicit graph checker.
 a=copy.deepcopy(steps);a[2]['consumes'].append('catalog_publish')
 check('selftest_reject_future_product',bool(schedule_errors(a,tests)))
 t=copy.deepcopy(tests);t[0]['requires_capabilities'].append('payment_confirmed_grant')
 check('selftest_reject_future_test',bool(schedule_errors(steps,t)))
 a=copy.deepcopy(steps);a[0]['requires_steps']=['AL-S24']
 check('selftest_reject_cycle_or_reverse',bool(schedule_errors(a,tests)))
 a=copy.deepcopy(steps);a[0]['consumes'].append('nonexistent')
 check('selftest_reject_unknown',bool(schedule_errors(a,tests)))
 schemas={p.name:json.loads(p.read_text()) for p in (ROOT/'schemas').glob('*.json')}
 for name,schema in schemas.items():
  try:Draft202012Validator.check_schema(schema);check('schema:'+name,True)
  except Exception as e:check('schema:'+name,False,str(e))
 fm=load('fixtures/manifest.json');examples=fm['checks'] if isinstance(fm,dict) else fm
 for ex in examples:
  path=ex.get('file') or ex.get('path'); errs=list(Draft202012Validator(schemas[ex['schema']],format_checker=FormatChecker()).iter_errors(load('fixtures/'+path)))
  check('example:'+path,(not errs)==ex['expected_valid'],[e.message for e in errs][:2])
 oa=yaml.safe_load((ROOT/'api/openapi.yaml').read_text());bad=[];ops=[]
 for ref in refs(oa):
  try:resolve(oa,ref)
  except Exception:bad.append(ref)
 check('openapi_local_refs',not bad,bad)
 for path,item in oa['paths'].items():
  for method,o in item.items():
   if method in ['get','put','post','patch','delete','head','options']:
    ops.append((method.upper(),path,o['operationId'],o.get('x-implementation-step')))
 check('api_schedule_matches',set(ops)=={(o['method'],o['path'],o['operation_id'],o['implementation_step']) for o in load('data/api_operations.json')})
 check('api_steps_known',all(o[3] in sid for o in ops))
 check('api_count_preserved',len(ops)==96)
 check('v04_old_local_auth_deprecated', all(oa['paths'][p]['post'].get('deprecated') is True for p in ['/api/v1/auth/challenges','/api/v1/auth/verify']))
 routemap={o[2]:o[3] for o in ops}
 check('early_query_routes_available',all(routemap[x]=='AL-S07' for x in ['submitQuery','listQueries','getQuery','getQuery_result','cancelQuery']))
 check('source_check_available_at_stores',routemap['getCapabilities']=='AL-S05')
 check('billing_reconcile_available_at_first_payment',routemap['reconcileBilling']=='AL-S20')
 broken=[];chat_tokens=[]
 for path in ROOT.glob('*.md'):
  text=path.read_text()
  if re.search('|<FileCite|turn\\d+file\\d+',text):chat_tokens.append(path.name)
  for link in re.findall(r'\]\(([^)]+)\)',text):
   link=link.split('#')[0].strip('<>')
   if link and not re.match(r'^\w+://|^mailto:',link) and not (path.parent/link).exists():broken.append(path.name+':'+link)
 check('local_markdown_links',not broken,broken);check('no_chat_only_citations',not chat_tokens,chat_tokens)

 old3=load('sources/ACCEPTANCE_v0.3.json')
 check('all146_v03_behavior_preserved',len(old3)==146 and all(all(tid[t['id']].get(k)==t.get(k) for k in fields) for t in old3))
 check('v05_186_total_cases',len(tests)==186)
 check('new_identity_is_step2',{'oidc_authority','product_identity_links','oidc_client_compatibility'}<=set(sid['AL-S02']['produces']))
 check('standalone_landing_is_step1',{'standalone_landing','lead_intake','funnel_events'}<=set(sid['AL-S01']['produces']))
 domains=load('infra/domains.json')
 check('six_distinct_domains',len(domains)==6 and len({x['host'] for x in domains})==6 and all(x['host'].endswith('.octoport.ru') for x in domains))
 check('domains_not_false_ready',all(x['status']=='NOT_RECHECKED' and x['observed_dns']=='NXDOMAIN' and bool(x.get('observed_at')) for x in domains))
 check('environment_preflight_explicit',status['current_preflight']=='ENV-00' and status['preflight_status']=='NOT_READY')
 merges=load('data/merge_roadmap.json');mt=load('data/merge_acceptance.json');mids={m['id']:m['order'] for m in merges}
 check('merge_order_deferred',len(merges)==5 and all(m['status']=='DEFERRED' and all(mids.get(d,999)<m['order'] for d in m['depends_on']) for m in merges))
 check('merge_twenty_unrun',len(mt)==20 and all(t['step'] in mids and t['status']=='NOT_RUN' for t in mt))
 check('merge_not_current_dependency',not any(x.startswith('AL-M') for s in steps for x in s['requires_steps']))
 ep=yaml.safe_load((ROOT/'api/entrypoints-v0.5.yaml').read_text())['entries']
 check('entrypoints_assigned',len(ep)==10 and all(x['step'] in sid for x in ep))
 check('domain_guide_exact_hosts',all(x['host'] in (ROOT/'DOMAIN_SETUP.md').read_text() for x in domains))

 old4=load('sources/ACCEPTANCE_v0.4.json')
 check('all168_v04_behavior_preserved',len(old4)==168 and all(all(tid[t['id']].get(k)==t.get(k) for k in fields) for t in old4))
 check('foundation_has_18_real_scenarios',len(sid['AL-S00']['test_ids'])==18 and all(t.startswith('AL-T00-') for t in sid['AL-S00']['test_ids']))
 check('site_requires_foundation',sid['AL-S01']['previous_in_default_order']=='AL-S00' and 'foundation_receipt' in sid['AL-S01']['consumes'] and 'AL-S00' in sid['AL-S01']['requires_steps'])
 check('source_paths_defined',all(s.get('source_paths') and all(p.startswith(('products/alisa/','docs/alisa/','.github/workflows/alisa-')) for p in s['source_paths']) for s in steps))
 check('foundation_not_false_implemented',status.get('foundation_status')=='NOT_STARTED' and status.get('product_implementation_by_this_task') is False)
 check('publication_not_false_claimed',status.get('github_published') is False)
 check('foundation_docs_present',all((ROOT/p).is_file() for p in ['START_HERE.md','FOUNDATION_00.md','SOURCE_LAYOUT.md','BUILD_RELEASE_RUN.md','ARCHITECTURE_VIEWS.md','QUALITY_RISKS.md','ADR_INDEX.md','EXECUTOR_BRIEF.md','GITHUB_PUBLICATION.md','METHOD_AND_SOURCES.md']))
 return {'validation':'DOCUMENTATION_ONLY','verdict':'DOCUMENTATION_VALIDATION_PASS' if all(x['passed'] for x in checks) else 'DOCUMENTATION_VALIDATION_FAIL','as_of_utc':datetime.now(timezone.utc).isoformat(),'product_tests_executed':0,'external_calls_by_validator':0,'counts':{'steps':len(steps),'requirement_groups':len(functions),'legacy_functions':len(functions)-1,'tests':len(tests),'preserved_tests':len(old),'added_tests':len(tests)-len(old),'requirements':len(reqs),'baseline':len(base),'api_operations':len(ops),'schemas':len(schemas),'new_domain_records':len(domains),'deferred_merge_steps':len(merges),'deferred_merge_tests':len(mt)},'checks':checks,'limits':['Checks explicit dependency annotations, not arbitrary natural-language semantics.','No product or server test performed.','OpenAPI is a project contract; 2 local auth routes deprecated, 10 new entrypoints scheduled; library schemas and remaining gaps assigned to their functional steps.','Review is authors own documentary review, not independent product acceptance.']}

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path);a=p.parse_args()
 report=validate()
 if a.output:a.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print(report['verdict']);print(json.dumps(report['counts'],ensure_ascii=False))
 for c in report['checks']:
  if not c['passed']:print('FAIL',c['check'],c.get('detail'))
 return 0 if report['verdict']=='DOCUMENTATION_VALIDATION_PASS' else 1
if __name__=='__main__':sys.exit(main())
