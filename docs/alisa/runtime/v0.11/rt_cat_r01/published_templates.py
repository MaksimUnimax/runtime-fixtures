"""Immutable runtime template packages. No UI, publisher, issuer, HTTP or eval.
A trusted platform callback must authorize the exact manifest and current scope.
User slots select values, not code/URLs/metrics. Multiple retained releases pin jobs.
"""
from __future__ import annotations
import copy
from dataclasses import asdict
from datetime import date
from pathlib import Path
from threading import RLock
from semantics import Scope, Rejected, canonical_json, strict_json, fingerprint
from registry import DEFINITIONS
from query_program import compile_program, make_composed_plan
from runtime_port_contract import validate, CONTRACT
from request_basis import validate_request_basis, POLICY_VERSION

CAPABILITY = 'runtime_template_scalar_v1'
SCHEMA = strict_json(Path(__file__).with_name('catalog_release_v1.schema.json').read_text())
LEVELS = {'SOURCE_TEST','INTEGRATION_FIXTURE','RECORDED_PROVIDER','LIVE_PROVIDER','LIVE_DIALOGS'}

def reject(code='CATALOG_INCOMPATIBLE'):
    raise Rejected(code, code)

def exact(value, keys):
    if type(value) is not dict or set(value) != set(keys): reject()

def bounded_text(value, maximum):
    if not isinstance(value,str) or not 1 <= len(value) <= maximum or any(ord(c)<32 for c in value): reject()

def package_hash(payload):
    return fingerprint(payload)

class PublishedTemplates:
    """Packages are immutable; authority is injected, not inferred from JSON.
    authorize(manifest, nonsecret_pins, action, template_id_or_None) -> literal True.
    It owns approval roles, assignment and source/capability checks. A manifest
    claiming PUBLISHED does not grant execution. No callback = fail closed.
    """
    def __init__(self, packages, *, base_bundle_hash, authorize):
        self.base_bundle_hash = base_bundle_hash
        self.authorize = authorize
        self._lock = RLock()
        self._packages = {}
        if type(packages) is not list or len(packages)>32: reject()
        for package in packages: self.add(package)

    def add(self, package):
        """Append a checked immutable release. Never replace the same release ID."""
        try:
            raw=canonical_json(package)
            if len(raw.encode())>524288: reject()
            p=strict_json(raw)
            exact(p,('manifest','payload'))
            manifest,payload=p['manifest'],p['payload']
            validate(manifest,SCHEMA)
            if manifest['engine_contract_version']!=CONTRACT: reject()
            if set(manifest['required_engine_capabilities'])!={CAPABILITY}: reject()
            if manifest['approved_hash']!=manifest['content_sha256'] or manifest['content_sha256']!=package_hash(payload): reject()
            if any(proof['level'] not in LEVELS for proof in manifest['proofs']): reject()
            ids=[proof['proof_id'] for proof in manifest['proofs']]
            if len(set(ids))!=len(ids): reject()
            exact(payload,('schema_version','base_catalog_bundle_sha256','templates'))
            if payload['schema_version']!='runtime_templates_v1' or payload['base_catalog_bundle_sha256']!=self.base_bundle_hash: reject()
            entries=payload['templates']
            if type(entries) is not list or not 1<=len(entries)<=200: reject()
            seen=set()
            for item in entries:
                exact(item,('id','version','state','title','description','canonical_utterance','platforms','expressions','time_axes','proof_ids','limitations','slot_policy'))
                bounded_text(item['id'],128); bounded_text(item['version'],64)
                bounded_text(item['title'],160);bounded_text(item['description'],800);bounded_text(item['canonical_utterance'],1200)
                if item['id'] in seen: reject()
                seen.add(item['id'])
                if item['state'] not in ('DRAFT','PUBLISHED','DISABLED'): reject()
                if type(item['platforms']) is not list or not item['platforms'] or len(item['platforms'])!=len(set(item['platforms'])) or not set(item['platforms'])<={'ozon','wb'}: reject()
                if type(item['proof_ids']) is not list or not item['proof_ids'] or len(set(item['proof_ids']))!=len(item['proof_ids']) or not set(item['proof_ids'])<=set(ids): reject()
                if type(item['limitations']) is not list or len(item['limitations'])>16: reject()
                for text in item['limitations']: bounded_text(text,400)
                # R01 only permits the complete interval and platform/total projection.
                if item['slot_policy']!={'period':'required','grouping':['marketplace','total'],'product_filters':False}: reject()
                program=compile_program(item['expressions'],{'period':{'from':'2026-10-01','to':'2026-10-31'},'comparison':None})
                if program['required']['previous']: reject()
                leaves=program['required']['current']; axes=set()
                for metric in leaves:
                    d=DEFINITIONS[metric]
                    if not set(item['platforms'])<=set(d['platforms']): reject()
                    axis=d.get('temporal','order_period' if d['source']=='orders' else 'advertising_period')
                    if axis=='snapshot': reject() # no silent historical/snapshot substitution
                    axes.add(axis)
                if type(item['time_axes']) is not list or len(item['time_axes'])!=len(set(item['time_axes'])) or set(item['time_axes'])!=axes: reject()
                validate_request_basis({'question':item['canonical_utterance']},{'metrics':leaves})
            release=manifest['release_id']
            with self._lock:
                if release in self._packages:
                    if self._packages[release]!=p: reject()
                    return
                if len(self._packages)>=32:reject('STORAGE_CAPACITY')
                self._packages[release]=copy.deepcopy(p)
        except Rejected: raise
        except (KeyError,TypeError,ValueError,RecursionError,OverflowError): reject()

    def has(self, release):
        with self._lock:return release in self._packages

    def _get(self, release):
        with self._lock:
            if release not in self._packages: reject()
            return copy.deepcopy(self._packages[release])

    def digest_for(self, release):
        p=self._get(release)
        return fingerprint({'base':self.base_bundle_hash,'manifest':p['manifest'],'payload':p['payload']})

    def check(self, pins, action, template_id=None):
        p=self._get(pins['catalog_release_id'])
        if self.authorize is None: reject('AUTH_REQUIRED')
        try: allowed=self.authorize(copy.deepcopy(p['manifest']),copy.deepcopy(pins),action,template_id)
        except Rejected: raise
        except Exception: reject('DEPENDENCY_UNAVAILABLE')
        if allowed is not True:reject('PERMISSION_DENIED')
        return p

    def prepare(self, query, pins, scope, today, action='submit'):
        if type(query) is not dict or set(query)!={'kind','template_id','slots'} or query['kind']!='template':reject('VALIDATION_FAILED')
        p=self.check(pins,action,query['template_id'])
        item=next((x for x in p['payload']['templates'] if x['id']==query['template_id']),None)
        if item is None or item['state']!='PUBLISHED':reject('CAPABILITY_UNAVAILABLE')
        slots=query['slots']
        if type(slots) is not dict or not {'period_from','period_to'}<=set(slots):reject('VALIDATION_FAILED')
        if set(slots)-{'period_from','period_to','grouping'}:reject('CAPABILITY_UNAVAILABLE')
        grouping=slots.get('grouping',['marketplace'])
        if grouping not in (['marketplace'],['total']):reject('CAPABILITY_UNAVAILABLE')
        for field in ('period_from','period_to'):
            if type(slots[field]) is not str:reject('VALIDATION_FAILED')
            try:
                if date.fromisoformat(slots[field]).isoformat()!=slots[field]:reject('VALIDATION_FAILED')
            except ValueError:reject('VALIDATION_FAILED')
        platforms=sorted({s.platform for s in scope.stores})
        if not platforms or not set(platforms)<=set(item['platforms']):reject('CAPABILITY_UNAVAILABLE')
        resolved={'period_from':slots['period_from'],'period_to':slots['period_to'],'grouping':grouping}
        draft={'route':'TEMPLATE','question':item['canonical_utterance'],
               'period':{'from':slots['period_from'],'to':slots['period_to']},'calendar_date':today.isoformat(),
               'comparison':None,'platforms':platforms,'timezone':pins['business_timezone'],
               'group_by':grouping[0],'filters':{},'snapshot':False,'refresh':False,
               'request_basis_policy':POLICY_VERSION,'scope_snapshot':asdict(scope)}
        plan=make_composed_plan(scope,draft,expressions=item['expressions'])
        validate_request_basis(draft,plan)
        provenance={'release_id':p['manifest']['release_id'],'content_sha256':p['manifest']['content_sha256'],
                    'template_id':item['id'],'template_version':item['version'],'template_sha256':fingerprint(item),
                    'slots':resolved,'calendar_date':today.isoformat()}
        draft['template_execution']=copy.deepcopy(provenance)
        plan['template_execution']=copy.deepcopy(provenance)
        return draft,plan

    def descriptors(self, pins, scope):
        p=self.check(pins,'capabilities')
        result=[]
        for item in p['payload']['templates']:
            if item['state']!='PUBLISHED' or not {s.platform for s in scope.stores}<=set(item['platforms']):continue
            try:self.check(pins,'capabilities',item['id'])
            except Rejected as exc:
                if exc.code in ('PERMISSION_DENIED','CAPABILITY_UNAVAILABLE','ACCESS_REQUIRED','CREDENTIAL_REVOKED'):continue
                raise
            result.append({k:copy.deepcopy(item[k]) for k in ('id','version','title','description','time_axes','limitations','slot_policy')})
        return result
