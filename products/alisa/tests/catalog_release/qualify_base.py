"""Produce base-binding evidence only after an actual owned CI regression.

Never run this against an installed tree. This command does not activate a
package, contact a provider or create an organizational runner.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[2]


def need(ok,code):
 if not ok:raise RuntimeError(code)


def qualify(core,output):
 core,output=Path(core).resolve(),Path(output).resolve()
 need(os.environ.get('GITHUB_ACTIONS')=='true','OWNED_GITHUB_CI_REQUIRED')
 relative=core.relative_to(ROOT)
 need(relative.parts[0].startswith('s07-qual-')and core.is_dir(),'OWNED_GENERATED_CORE_REQUIRED')
 need(output.is_relative_to(ROOT/relative.parts[0])and not output.exists(),'OWNED_NEW_REPORT_REQUIRED')
 sys.path.insert(0,str(core))
 from catalog_release.native import SnapshotFactory,code_seal
 before=code_seal(core)
 raw_report=output.with_name(output.stem+'-full.json');log=output.with_suffix('.log')
 need(not raw_report.exists()and not log.exists(),'REVIEW_PREVIOUS_QUALIFICATION')
 env=dict(os.environ);env['PYTHONDONTWRITEBYTECODE']='1';env['ALISA_CATALOG_RELEASE_ENABLED']='0'
 with log.open('xb')as stream:
  result=subprocess.run([sys.executable,'-B',str(core/'run_checks.py'),'--output',str(raw_report)],
   cwd=core,env=env,stdout=stream,stderr=subprocess.STDOUT,timeout=240)
 need(code_seal(core)==before,'CORE_CHANGED_DURING_REGRESSION')
 if result.returncode:
  with log.open('rb')as stream:stream.seek(max(0,log.stat().st_size-7800));print(stream.read().decode(errors='replace'),file=sys.stderr)
  raise RuntimeError('BASE_REGRESSION_FAILED')
 need(raw_report.is_file()and raw_report.stat().st_size<=2*1024**2,'BASE_REPORT_BOUND')
 data=json.loads(raw_report.read_text())
 need(data.get('status')=='PASS'and type(data.get('tests_run'))is int and data['tests_run']>0 and
      all(data.get(k)==0 for k in ['failures','errors','skipped','forbidden_network_attempts','live_provider_calls'])and
      data.get('installed')is False,'BASE_REPORT_NOT_PASS')
 source=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
 need(data.get('source_sha')==source,'BASE_REPORT_SOURCE_MISMATCH')
 factory=SnapshotFactory(core)
 need(factory.engine_sha256==before,'CORE_CHANGED_DURING_REGRESSION')
 folder=core/'catalog_release';receipt=folder/'base_qualification.json';report=folder/'base_qualification_report.json'
 need(not receipt.exists()and not report.exists(),'REVIEW_PREVIOUS_QUALIFICATION')
 report.write_bytes(raw_report.read_bytes())
 value={'schema':'alisa-catalog-base-qualification/v1','engine_sha256':before,
  'base_template_hash':factory.base_hash,'proof_id':'ci-base-'+source[:16],
  'level':'INTEGRATION_FIXTURE','report_sha256':hashlib.sha256(report.read_bytes()).hexdigest(),
  'scope':'BYTE_IDENTICAL_BASE_BINDINGS','tests_run':data['tests_run'],'failures':0,'errors':0,'status':'PASS'}
 receipt.write_text(json.dumps(value,sort_keys=True,indent=2)+'\n')
 need(code_seal(core)==before,'QUALIFICATION_MUST_NOT_CHANGE_ENGINE_ID')
 # The generated current-core fixture verifies every declared input before
 # importing it. Add evidence files to that receipt; do not rewrite frozen code.
 manifest_path=core/'CURRENT_CORE_MANIFEST.json';manifest=json.loads(manifest_path.read_text())
 for path in [receipt,report]:manifest['files'][str(path.relative_to(core))]=hashlib.sha256(path.read_bytes()).hexdigest()
 manifest['catalog_release_qualification']={'engine_sha256':before,'source':source,'level':'INTEGRATION_FIXTURE'}
 manifest_path.write_text(json.dumps(manifest,sort_keys=True,indent=2)+'\n')
 factory.qualification()
 summary={'scope':'S13_BASE_REGRESSION_GENERATED_CORE_NOT_LIVE','status':'PASS','source':source,
  'engine_sha256':before,'base_template_hash':factory.base_hash,'tests_run':data['tests_run'],
  'failures':0,'errors':0,'report_sha256':value['report_sha256'],
  'qualification_sha256':hashlib.sha256(receipt.read_bytes()).hexdigest(),'installed':False,'provider_calls':0}
 output.write_text(json.dumps(summary,sort_keys=True,indent=2)+'\n');return summary


if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--core',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
 a=p.parse_args();print(json.dumps(qualify(a.core,a.output)))
