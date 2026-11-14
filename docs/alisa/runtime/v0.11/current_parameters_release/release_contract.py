"""Pure release-manifest/rollback guards. No service, network or database IO."""
from copy import deepcopy
from hashlib import sha256
from pathlib import PurePosixPath
import json,posixpath,re

SOURCE='1d572aebf6b05b88ae5c233ae4313284add03e45'
MIGRATION='services/platform/src/alisa_platform/owner_data/migrations/0002_current_parameter_only.py'
PLATFORM_NAMES={
 'catalog/__init__.py','catalog/reader.py','catalog/views.py','config/settings.py','config/urls.py',
 'owner_data/migrations/0002_current_parameter_only.py','owner_data/models.py','owner_data/parameter_catalog.json',
 'owner_data/parameter_collection.py','owner_data/parameter_contract.py','owner_data/parameter_job.py',
 'owner_data/parameter_producers.json','owner_data/parameter_producers.py','owner_data/parameter_readset.py',
 'owner_data/parameter_resolution.py','owner_data/parameter_service.py','owner_data/parameter_views.py','owner_data/products.py',
 'queries/service.py','runtime_adapter/authority_rpc.py','runtime_adapter/job_client.py'}
PLATFORM_FILES={'services/platform/src/alisa_platform/'+n for n in PLATFORM_NAMES}
NATIVE_FILES={'engine.py','model_answer.py','report_archive.py','runtime.py','runtime_port.py','runtime_port_ipc.py',
 'platform_authority_client.py','template_catalog.py','template_catalog.json','template_protocol.py','template_runtime.py',
 'parameter_source_runtime.py','parameter_collection_runtime.py','parameter_support/__init__.py',
 'parameter_support/parameter_catalog.json','parameter_support/parameter_contract.py',
 'parameter_support/parameter_producers.json','parameter_support/parameter_producers.py'}

class ReleaseError(RuntimeError):pass

def need(ok,code):
    if not ok:raise ReleaseError(code)


def safe_path(name):
    return type(name)is str and bool(name)and str(PurePosixPath(name))==name and not name.startswith('/')and '..'not in PurePosixPath(name).parts


def check_snapshot(snapshot):
    need(type(snapshot)is dict and all(type(snapshot.get(k))is int and snapshot[k]>=0 for k in ('active_jobs','active_web_queries','undelivered_voice_answers','unexpired_job_results')),'INVALID_RELEASE_SNAPSHOT')
    need(snapshot['active_jobs']==0,'ACTIVE_RUNTIME_JOBS')
    need(snapshot['active_web_queries']==0,'ACTIVE_WEB_QUERIES')
    need(snapshot['undelivered_voice_answers']==0,'VOICE_ANSWER_NOT_DELIVERED')
    need(snapshot['unexpired_job_results']==0,'PINNED_RESULTS_NOT_EXPIRED')
    need(snapshot['base_matches']is True,'BASE_MOVED')


def check_payload(payload):
    need(payload['schema']=='alisa-parameter-release-payload/v1'and payload['source']==SOURCE,'PAYLOAD_SOURCE')
    need(set(payload['expected_base_platform'])==PLATFORM_FILES,'PLATFORM_SCOPE')
    need(set(payload['expected_base_native'])==NATIVE_FILES,'NATIVE_SCOPE')
    files=payload['files'];links=payload['links']
    need(not(set(files)&set(links)),'PAYLOAD_OVERLAP')
    for name,value in files.items():
        need(safe_path(name)and re.fullmatch(r'[a-f0-9]{64}',value)is not None,'PAYLOAD_PATH_OR_HASH')
        if name.startswith('platform/'):need(name[len('platform/'):]in PLATFORM_FILES,'PLATFORM_SCOPE')
        elif name.startswith('native/'):need(name[len('native/'):]in NATIVE_FILES,'NATIVE_SCOPE')
        else:need(name.startswith('web/ui/web/')or name=='web/infra/launch.py','WEB_SCOPE')
    need({n[9:]for n in files if n.startswith('platform/')}==PLATFORM_FILES,'PLATFORM_FILES_MISSING')
    need({n[7:]for n in files if n.startswith('native/')}==NATIVE_FILES,'NATIVE_FILES_MISSING')
    for name,target in links.items():
        need(safe_path(name)and name.startswith('web/ui/web/')and type(target)is str and not target.startswith('/'),'PAYLOAD_LINK')
        need(posixpath.normpath(str(PurePosixPath(name).parent/target)).startswith('web/ui/web/'),'LINK_ESCAPE')


def _base_guard(expected,actual):
    for name,digest in expected.items():
        need((name not in actual)if digest is None else actual.get(name)==digest,'SOURCE_FILE_CHANGED:'+name)


def manifests(payload,old_platform,old_native,old_web,old_core):
    check_payload(payload)
    need(payload['locks']==old_platform['locks']==old_web['locks'],'DEPENDENCY_LOCK_CHANGED')
    _base_guard(payload['expected_base_platform'],old_platform['files'])
    _base_guard(payload['expected_base_native'],old_native['files'])
    need(old_core['files']=={n:h for n,h in old_native['files'].items()if n!='CURRENT_CORE_MANIFEST.json'},'CURRENT_CORE_INCOHERENT')
    platform=deepcopy(old_platform);native=deepcopy(old_native);web=deepcopy(old_web);core=deepcopy(old_core)
    platform['files'].update({n[9:]:h for n,h in payload['files'].items()if n.startswith('platform/')})
    platform['migrations'][MIGRATION]=platform['files'][MIGRATION]
    platform['schema_compatibility']['platform_owner_data']=['0001_initial','0002_current_parameter_only']
    platform.update(artifact_id='alisa-parameters-'+SOURCE[:16],source_sha=SOURCE,parameter_source=SOURCE,
                    base_manifest_sha256=payload['bases']['platform']['sha256'],base_release=old_platform['artifact_id'])
    core['files'].update({n[7:]:h for n,h in payload['files'].items()if n.startswith('native/')})
    core.update(parameter_overlay_source=SOURCE)
    core_bytes=(json.dumps(core,indent=2)+'\n').encode()
    native['files']={**core['files'],'CURRENT_CORE_MANIFEST.json':sha256(core_bytes).hexdigest()}
    native.update(artifact_id='alisa-parameters-'+SOURCE[:16],source_commit=SOURCE,parameter_source=SOURCE,
                  base_manifest_sha256=payload['bases']['native']['sha256'],base_release=old_native['artifact_id'],parallel_source_commit=old_native.get('source_commit'))
    web['files']={n[4:]:h for n,h in payload['files'].items()if n.startswith('web/')}
    web['links']={n[4:]:v for n,v in payload['links'].items()if n.startswith('web/')}
    web.update(artifact_id='alisa-cabinet-parameters-'+SOURCE[:16],source_sha=SOURCE,parameter_source=SOURCE,
               base_web_release=old_web['artifact_id'],base_web_manifest_sha256=payload['bases']['web']['sha256'])
    return platform,native,web,core_bytes


def runtime_config(current,pin):
    need(type(pin)is str and re.fullmatch(r'[a-f0-9]{64}',pin)is not None,'INVALID_RELEASE_PIN')
    policy=current.get('parameter_sources')
    need(policy is None or type(policy)is dict and set(policy)=={'enabled'}and policy['enabled']is False,'PARAMETERS_ALREADY_ENABLED')
    result=deepcopy(current);result['parameter_sources']={'enabled':True,'pin':pin}
    return result


def rollback_allowed(observed,before,ours):
    need(set(observed)==set(before)==set(ours),'ROLLBACK_SCOPE')
    for key in observed:need(observed[key]in(before[key],ours[key]),'ROLLBACK_LATER_WRITER:'+key)
    return True
