"""Bind the existing R15 source suites to this run's exact S13 native bytes.

Only owned GitHub CI fixtures are supported. No installed release, owner data,
new worker or organizational runner is involved.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[2]
R15='cafb743c94672104d4afa2c471398e5c81d904f5'
SCHEMA='alisa-s13-r15-suite/v1'
BASELINE='docs/alisa/runtime/v0.11/current_parameters_r8/BASELINE_TEMPLATE_HASHES.json'
RUNNER='products/alisa/tests/current_parameters/ci_qualified_suites.py'
WB_ACTIVITY={
    'B14.card_views':('b45389f3e6c8a2e2662842802468802d9e624a8cbb8361a59a7002f0a20b1fa9',
                      '5724d209566add1199765721dd23d0576c46cb0a22dca0f395920ba4f4be3bb5'),
    'B14.cart_additions':('48c6bce7a45c2b5ccd50811aaccee1d5e761f41a2bb6fa85360a9270d177808e',
                          'f3fbcc630eb8064209aa51ccc42f71996940eb9bc4ef0c09a23b85004cd9e12b')}


def need(value,code):
    if not value:raise RuntimeError(code)


def ci():
    need(os.environ.get('GITHUB_ACTIONS')=='true'and
         os.environ.get('GITHUB_RUN_ID','').isdigit()and
         os.environ.get('GITHUB_RUN_ATTEMPT','').isdigit(),'OWNED_GITHUB_CI_REQUIRED')
    return {'source_sha':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
        'context_source_sha':R15,'run_id':os.environ['GITHUB_RUN_ID'],
        'run_attempt':os.environ['GITHUB_RUN_ATTEMPT']}


def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


def seal(core):
    core=Path(core).resolve();sys.path.insert(0,str(core))
    from catalog_release.native import code_seal
    return code_seal(core)


def bounded(path):
    path=Path(path)
    need(path.is_file()and not path.is_symlink()and path.stat().st_size<=32768,'R15_REPORT_BOUND')
    return json.loads(path.read_text())


def prepare(context,core,output):
    provenance=ci();core=Path(core).resolve();output=Path(output).resolve()
    need(str(core).startswith('/dev/shm/alisa-parameter-ci-s13-')and not core.exists(),
         'NEW_OWNED_R15_NATIVE_REQUIRED')
    need(not output.exists(),'NEW_R15_REPORT_REQUIRED')
    context=Path(context).resolve()
    subprocess.run(['git','diff','--exit-code','--quiet'],cwd=context,check=True)
    with tempfile.TemporaryDirectory(prefix='s07-qual-',dir=ROOT)as folder:
        temp=Path(folder)
        historical=load('s13_r15_source',Path(__file__).with_name('context_r15.py')).build(context,temp/'source')
        composed=load('s13_r15_overlay',ROOT/'runtime/catalog_release/build_overlay.py').build(historical,temp/'composed')
        need(not(composed/'.s13-fixture-owner').exists(),'R15_FIXTURE_MARKER_COLLISION')
        core.mkdir(mode=0o700)
        (core/'.s13-fixture-owner').write_text(provenance['run_id']+':'+provenance['run_attempt']+'\n')
        shutil.copytree(composed,core,dirs_exist_ok=True)
    # Keep the canonical runner and tests unchanged. Their explicit golden
    # fixture advances only the two WB metadata contracts already installed by
    # S11; the other 86 expected template hashes remain byte-identical.
    test_context=core/'.s13-test-context'
    shutil.copytree(context,test_context,symlinks=True,ignore=shutil.ignore_patterns('.git','__pycache__'))
    baseline=test_context/BASELINE;golden=json.loads(baseline.read_text())
    need(len(golden)==88 and all(golden.get(key)==pins[0]for key,pins in WB_ACTIVITY.items()),
         'R15_BASELINE_FIXTURE_CONTEXT_MOVED')
    for key,pins in WB_ACTIVITY.items():golden[key]=pins[1]
    baseline.write_text(json.dumps(golden,sort_keys=True,indent=2)+'\n')
    value={'schema':SCHEMA,**provenance,'engine_sha256':seal(core),
        'test_runner_sha256':hashlib.sha256((test_context/RUNNER).read_bytes()).hexdigest(),
        'test_baseline_sha256':hashlib.sha256(baseline.read_bytes()).hexdigest(),
        'fixture_overlay':{key:pins[1]for key,pins in WB_ACTIVITY.items()}}
    output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(value,indent=2)+'\n')
    inventory={str(path.relative_to(core)):hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(core.rglob('*'))if path.is_file()and
        not any(part.startswith('.')or part=='__pycache__'for part in path.relative_to(core).parts)}
    inventory_path=output.with_name(output.name.removesuffix('-prepared.json')+'-inventory.json')
    need(not inventory_path.exists(),'NEW_R15_INVENTORY_REQUIRED')
    inventory_path.write_text(json.dumps({'schema':'alisa-s13-r15-source-inventory/v1',
        **provenance,'engine_sha256':value['engine_sha256'],'files':inventory},sort_keys=True,indent=2)+'\n')
    return value


def attest(core,prepared,report,output):
    provenance=ci();prepared=bounded(prepared);report=bounded(report);output=Path(output)
    need(all(prepared.get(k)==v for k,v in provenance.items())and prepared.get('schema')==SCHEMA,
         'R15_PROVENANCE_CHANGED')
    need(prepared['engine_sha256']==seal(core),'R15_NATIVE_CHANGED_DURING_SUITE')
    test_context=Path(core)/'.s13-test-context'
    need(hashlib.sha256((test_context/RUNNER).read_bytes()).hexdigest()==prepared['test_runner_sha256']and
         hashlib.sha256((test_context/BASELINE).read_bytes()).hexdigest()==prepared['test_baseline_sha256']and
         prepared['fixture_overlay']=={key:pins[1]for key,pins in WB_ACTIVITY.items()},
         'R15_TEST_CONTEXT_CHANGED_DURING_SUITE')
    need(report.get('status')=='PASS'and report.get('execution_complete')is True and
         type(report.get('tests'))is int and report['tests']>0 and
         all(report.get(k)==0 for k in ['failures','errors','skipped','external_connections'])and
         report.get('live_configuration_loaded')is False and
         report['tests']==report.get('selected_ids_count')==report.get('executed_ids_count')and
         report.get('selected_ids_sha256')==report.get('executed_ids_sha256'),
         'R15_SUITE_NOT_COMPLETE_PASS')
    keys=['suite','tests','shard_index','shard_count','inventory_count','inventory_sha256',
          'selected_ids_count','selected_ids_sha256','executed_ids_count','executed_ids_sha256']
    value={**prepared,**{key:report[key]for key in keys},'status':'PASS',
        'failures':0,'errors':0,'skipped':0,'external_connections':0,'installed':False}
    need(not output.exists(),'NEW_R15_REPORT_REQUIRED')
    output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(value,indent=2)+'\n')
    return value


def aggregate(folder,engine):
    provenance=ci();paths=sorted(Path(folder).rglob('*attestation.json'))
    need(len(paths)==7,'R15_ALL_CURRENT_RUN_SUITES_REQUIRED')
    expected={('base',0,1),('collection',0,1),('ledger',0,1),
              *(('compound',index,4)for index in range(4))}
    records=[];seen=set()
    for path in paths:
        row=bounded(path);key=(row.get('suite'),row.get('shard_index'),row.get('shard_count'))
        need(row.get('schema')==SCHEMA and all(row.get(k)==v for k,v in provenance.items())and
             row.get('engine_sha256')==engine and row.get('status')=='PASS'and
             all(row.get(k)==0 for k in ['failures','errors','skipped','external_connections'])and
             row.get('installed')is False and key in expected and key not in seen,
             'R15_CURRENT_RUN_IDENTITY_MISMATCH')
        need(type(row.get('tests'))is int and row['tests']>0 and
             row['tests']==row.get('selected_ids_count')==row.get('executed_ids_count')and
             row.get('selected_ids_sha256')==row.get('executed_ids_sha256'),
             'R15_EXECUTION_COVERAGE_MISMATCH')
        seen.add(key);records.append(row)
    need(seen==expected,'R15_ALL_CURRENT_RUN_SUITES_REQUIRED')
    need(len({(row.get('test_runner_sha256'),row.get('test_baseline_sha256'))for row in records})==1 and
         all(row.get('fixture_overlay')=={key:pins[1]for key,pins in WB_ACTIVITY.items()}for row in records),
         'R15_TEST_CONTEXT_MISMATCH')
    for suite in ['base','collection','ledger','compound']:
        shards=[row for row in records if row['suite']==suite]
        need(len({(row['inventory_count'],row['inventory_sha256'])for row in shards})==1 and
             sum(row['tests']for row in shards)==shards[0]['inventory_count']and
             len({row['selected_ids_sha256']for row in shards})==len(shards),
             'R15_SHARD_COVERAGE_MISMATCH')
    return {'scope':'R15_QUALIFIED_PARAMETER_ECONOMICS_SUITES_CURRENT_RUN_NOT_LIVE',
        'status':'PASS','tests_run':sum(row['tests']for row in records),'skipped':0,
        'forbidden_network_attempts':0,'failures':0,'errors':0,'installed':False,
        'live_provider_calls':0,'source_sha':provenance['source_sha'],
        'engine_sha256':engine,'upstream_suites':records}


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('action',choices=['prepare','attest'])
    p.add_argument('--core',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--context',type=Path);p.add_argument('--prepared',type=Path);p.add_argument('--report',type=Path)
    a=p.parse_args()
    result=prepare(a.context,a.core,a.output)if a.action=='prepare'else attest(a.core,a.prepared,a.report,a.output)
    print(json.dumps({key:result[key]for key in ['schema','source_sha','engine_sha256']}))
