"""Draft, validation, approval and observed publication are distinct effects."""
from copy import deepcopy
from uuid import UUID
from django.db import connection,transaction
from django.utils import timezone
from alisa_platform.staff.policy import OWNER_PERMISSIONS
from alisa_platform.staff.service import principal,audit
from alisa_platform.query_insights.models import DemandCandidate
from alisa_platform.runtime_adapter.authority_rpc import configured_authority
from alisa_platform.runtime_adapter.job_client import RuntimeFailure
from . import control
from .bridge import NativeCatalog
from .models import (CatalogDraft,CatalogValidation,CatalogRelease,CatalogAssignment,
                     CatalogPublication,CatalogDecision)
from .package_rules import (ReleaseFailure,canonical,digest,exact,hash_value,need,package)

PERMISSIONS={'draft.create':'catalog.edit','draft.edit':'catalog.edit','validate':'catalog.edit',
 'approve':'catalog.approve','publish':'catalog.publish','rollback':'catalog.publish','retry':'catalog.publish'}
READ={'catalog.edit','catalog.approve','catalog.publish'}


def identity(value):
 need(type(value)is str)
 try:result=str(UUID(value))
 except (ValueError,TypeError,AttributeError):raise ReleaseFailure('CATALOG_INPUT_INVALID')from None
 need(result==value);return value


def revision(value,zero=False):
 need(type(value)is int and (0 if zero else 1)<=value<=2147483647,'CATALOG_REVISION_INVALID')
 return value


def lock():
 need(connection.in_atomic_block,'CATALOG_TRANSACTION_REQUIRED')
 with connection.cursor()as c:c.execute('SELECT pg_advisory_xact_lock(%s)',[865912337])


def actor(token,action):
 member=principal(token,None);need(member is not None,'CATALOG_FORBIDDEN')
 allowed=OWNER_PERMISSIONS if member.role=='OWNER'else set(member.permissions)
 need(PERMISSIONS[action]in allowed if action in PERMISSIONS else bool(READ&set(allowed)),
      'CATALOG_FORBIDDEN')
 return member


def final(token,action,who):
 need(actor(token,action).pk==who.pk,'CATALOG_FORBIDDEN')


def decision(who,action,obj,facts):
 CatalogDecision.objects.create(actor_id=who.pk if who else None,action=action,
  object_id=str(obj),facts=deepcopy(facts))
 audit(who,'catalog.'+action,None,'SECURITY_REVIEW','APPLIED',after={'count':1})


def draft_projection(row,detail=True):
 validation=row.validations.order_by('-created_at','-id').first()
 result={'id':str(row.pk),'candidate_id':str(row.candidate_id),'revision':row.revision,
  'title':row.package['additions'][0]['purpose'],'author_id':str(row.author_id),'package_sha256':digest(row.package),
  'validation':None if validation is None else {'id':str(validation.pk),
   'draft_revision':validation.draft_revision,'package_sha256':validation.package_sha256,
   'template_hash':validation.template_hash,'engine_sha256':validation.engine_sha256}}
 if detail:
  result['package']=row.package
  if validation:result['validation']['evidence']=validation.evidence
 return result


def listing(who):
 from django.conf import settings
 from alisa_platform.accounts.models import Membership
 labels={}
 if who.role=='OWNER'or'users.read'in who.permissions:
  labels={str(row.tenant_id):row.customer.display_name for row in
   Membership.objects.select_related('customer').filter(tenant_id__in=settings.CATALOG_PILOT_TENANTS,role='OWNER_CLIENT')}
 return {'drafts':[draft_projection(row,False)for row in CatalogDraft.objects.order_by('-updated_at','id')[:20]],
  'releases':[{'package_sha256':row.pk,'release_id':row.manifest['release_id'],'title':row.package['additions'][0]['purpose'],
   'created_at':row.created_at.isoformat()}for row in CatalogRelease.objects.order_by('-created_at','package_sha256')[:20]],
  'assignments':[{'tenant_id':str(row.pk),'revision':row.revision,'applied_revision':row.applied_revision,
   'desired_package_sha256':row.release_id or'','observed_package_sha256':row.observed_package_sha256,
   'observed_template_hash':row.observed_template_hash,'state':row.state}
   for row in CatalogAssignment.objects.order_by('tenant_id')[:20]],
  'pending':[{'request_id':str(row.pk),'tenant_id':str(row.tenant_id),'revision':row.revision,
   'package_sha256':row.package_sha256,'outcome':row.outcome}
   for row in CatalogPublication.objects.exclude(outcome__state='APPLIED').order_by('-created_at')[:20]],
  'pilot_tenants':[{'id':key,'label':labels.get(key)or'Тестовый клиент '+key[:8]}for key in settings.CATALOG_PILOT_TENANTS],
  'decisions':[{'action':r.action,'object_id':r.object_id,'actor_id':str(r.actor_id)if r.actor_id else None,
   'facts':r.facts,'created_at':r.created_at.isoformat()}for r in CatalogDecision.objects.order_by('-created_at')[:20]]}


def approved(row):
 need(digest(row.package)==row.pk and row.manifest['approved_hash']==row.pk and
      row.manifest['content_sha256']==row.pk,'CATALOG_APPROVAL_HASH_MISMATCH')
 return row


@transaction.atomic
def fast(action,filters,token):
 control.enabled();who=actor(token,action);lock()
 if action=='list':exact(filters,set());result=listing(who)
 elif action=='draft.read':
  exact(filters,{'draft_id'});result=draft_projection(CatalogDraft.objects.get(pk=identity(filters['draft_id'])))
 elif action=='release.read':
  exact(filters,{'package_sha256'});hash_value(filters['package_sha256'])
  row=approved(CatalogRelease.objects.get(pk=filters['package_sha256']))
  result={'package_sha256':row.pk,'package':row.package,'manifest':row.manifest}
 elif action=='draft.create':
  exact(filters,{'candidate_id','package'});candidate_id=identity(filters['candidate_id']);value=package(filters['package'])
  candidate=DemandCandidate.objects.select_for_update().filter(pk=candidate_id).first()
  need(candidate is not None and candidate.state!='MERGED','CATALOG_CANDIDATE_UNAVAILABLE')
  row=CatalogDraft.objects.create(candidate=candidate,author_id=who.pk,package=value)
  decision(who,'DRAFT_CREATED',row.pk,{'revision':1,'package_sha256':digest(value)})
  result=draft_projection(row)
 elif action=='draft.edit':
  exact(filters,{'draft_id','expected_revision','package'});identity(filters['draft_id']);revision(filters['expected_revision'])
  row=CatalogDraft.objects.select_for_update().get(pk=filters['draft_id'])
  need(row.revision==filters['expected_revision'],'CATALOG_REVISION_CONFLICT')
  row.package=package(filters['package']);row.revision+=1;row.save(update_fields=['package','revision','updated_at'])
  decision(who,'DRAFT_EDITED',row.pk,{'revision':row.revision,'package_sha256':digest(row.package)})
  result=draft_projection(row)
 elif action=='approve':
  exact(filters,{'draft_id','expected_revision','validation_id','package_sha256','reviewed'})
  identity(filters['draft_id']);identity(filters['validation_id']);revision(filters['expected_revision'])
  hash_value(filters['package_sha256']);need(filters['reviewed']is True,'CATALOG_REVIEW_REQUIRED')
  row=CatalogDraft.objects.select_for_update().get(pk=filters['draft_id'])
  need(row.revision==filters['expected_revision'],'CATALOG_REVISION_CONFLICT')
  valid=CatalogValidation.objects.get(pk=filters['validation_id'],draft=row)
  mark=digest(package(row.package))
  need(valid.draft_revision==row.revision and valid.package_sha256==mark==filters['package_sha256'],
       'CATALOG_APPROVAL_HASH_MISMATCH')
  existing=CatalogRelease.objects.filter(pk=mark).first()
  if existing:result={'package_sha256':mark,'manifest':approved(existing).manifest}
  else:
   evidence=valid.evidence
   manifest={'schema_version':'catalog_release_v1','release_id':'cat-'+mark[:32],
    'engine_contract_version':'runtime_port_v1','required_engine_capabilities':['catalog_release_v1'],
    'semantic_version':valid.template_hash,'source_version':valid.engine_sha256,
    'speech_version':evidence['speech_sha256'],'content_sha256':mark,'artifact_ref':str(valid.pk),
    'proofs':[evidence['proof']],'author_id':str(row.author_id),'approver_id':str(who.pk),
    'approved_hash':mark,'qualified_scopes':['INTEGRATION_FIXTURE/base/'+row.package['base_template_hash']],
    'created_at':timezone.now().isoformat()}
   release=CatalogRelease.objects.create(package_sha256=mark,validation=valid,author_id=row.author_id,
    approver_id=who.pk,package=deepcopy(row.package),manifest=manifest)
   decision(who,'APPROVED',mark,{'draft_id':str(row.pk),'draft_revision':row.revision,'validation_id':str(valid.pk)})
   result={'package_sha256':mark,'manifest':release.manifest}
 else:raise ReleaseFailure('CATALOG_ACTION_INVALID')
 final(token,action,who);return result


def validate(filters,token,native_factory=NativeCatalog):
 exact(filters,{'draft_id','expected_revision'});identity(filters['draft_id']);revision(filters['expected_revision'])
 with transaction.atomic():
  control.enabled();who=actor(token,'validate');row=CatalogDraft.objects.get(pk=filters['draft_id'])
  need(row.revision==filters['expected_revision'],'CATALOG_REVISION_CONFLICT')
  value=package(row.package);mark=digest(value);author=who.pk
 native=native_factory();receipt=native.validate(value)
 with transaction.atomic():
  who=actor(token,'validate');need(who.pk==author,'CATALOG_FORBIDDEN');lock()
  row=CatalogDraft.objects.select_for_update().get(pk=filters['draft_id'])
  need(row.revision==filters['expected_revision']and digest(row.package)==mark,'CATALOG_REVISION_CONFLICT')
  if not receipt['valid']:
   decision(who,'VALIDATION_REJECTED',row.pk,{'revision':row.revision,'code':receipt['code']})
   final(token,'validate',who);return receipt
  evidence={'native':receipt['evidence'],'proof':receipt['proof'],
   'runtime_versions':deepcopy(native.api.versions),'speech_sha256':receipt['speech_sha256']}
  valid=CatalogValidation.objects.create(draft=row,draft_revision=row.revision,package_sha256=mark,
   template_hash=receipt['template_hash'],engine_sha256=receipt['engine_sha256'],evidence=evidence)
  decision(who,'VALIDATED',row.pk,{'revision':row.revision,'validation_id':str(valid.pk),'package_sha256':mark})
  final(token,'validate',who);return {'valid':True,'validation_id':str(valid.pk),**draft_projection(row)}


@transaction.atomic
def prepare_publication(action,filters,token,info):
 exact(filters,{'request_id','tenant_id','expected_revision','package_sha256'})
 request_id=identity(filters['request_id']);tenant=identity(filters['tenant_id']);expected=revision(filters['expected_revision'],True)
 target=filters['package_sha256'];need(type(target)is str)
 if target:hash_value(target)
 need(target or action=='rollback','CATALOG_RELEASE_REQUIRED')
 who=actor(token,action);lock()
 mapping=control.binding(configured_authority(),tenant)
 mark=digest({'action':action,'tenant_id':tenant,'expected_revision':expected,'package_sha256':target})
 previous=CatalogPublication.objects.filter(pk=request_id).first()
 if previous:
  need(previous.fingerprint==mark,'CATALOG_IDEMPOTENCY_CONFLICT');final(token,action,who);return previous
 row,_=CatalogAssignment.objects.select_for_update().get_or_create(tenant_id=tenant)
 need(row.revision==expected,'CATALOG_ASSIGNMENT_CONFLICT')
 need(row.state!='PENDING','CATALOG_PUBLICATION_PENDING')
 need(expected<2147483647,'CATALOG_REVISION_INVALID')
 release=approved(CatalogRelease.objects.get(pk=target))if target else None
 if release:
  valid=release.validation
  need(valid.engine_sha256==info['engine_sha256']and
       release.package['base_template_hash']==info['base_template_hash']and
       valid.evidence['native']['qualification_sha256']==info['qualification_sha256'],
       'CATALOG_ENGINE_MISMATCH')
  template_hash=valid.template_hash
 else:template_hash=info['base_template_hash']
 row.release=release;row.revision+=1;row.state='PENDING';row.save(update_fields=['release','revision','state','updated_at'])
 publication=CatalogPublication.objects.create(id=request_id,actor_id=who.pk,tenant_id=tenant,
  fingerprint=mark,revision=row.revision,expected_revision=expected,package_sha256=target,
  engine_sha256=info['engine_sha256'],template_hash=template_hash,runtime_tenant=mapping['runtime_tenant'],
  binding_sha256=digest(mapping),qualification_sha256=info['qualification_sha256'],outcome={'state':'PENDING'})
 decision(who,'PUBLICATION_REQUESTED',request_id,{'revision':row.revision,'package_sha256':target,'action':action})
 final(token,action,who);return publication


@transaction.atomic
def record_readback(publication_id,readback):
 # A trusted native observation is recorded even if the initiating browser
 # session expires afterwards. It grants no permission to that browser.
 lock();publication=CatalogPublication.objects.select_for_update().get(pk=publication_id)
 row=CatalogAssignment.objects.select_for_update().get(tenant_id=publication.tenant_id)
 if row.revision!=publication.revision:return {'state':'SUPERSEDED','revision':row.revision}
 match=(readback['assignment_revision']==publication.revision and
  readback['package_sha256']==publication.package_sha256 and readback['template_hash']==publication.template_hash and
  readback['engine_sha256']==publication.engine_sha256 and readback['last_request_id']==str(publication.pk))
 state='APPLIED'if match else'CONFLICT'if readback['assignment_revision']>=publication.revision else'PENDING'
 row.observed_package_sha256=readback['package_sha256'];row.observed_template_hash=readback['template_hash']
 row.state=state
 if match:row.applied_revision=publication.revision
 row.save(update_fields=['observed_package_sha256','observed_template_hash','state','applied_revision','updated_at'])
 outcome={'state':state,'revision':publication.revision,'request_id':str(publication.pk),'readback':readback}
 already=publication.outcome.get('state')=='APPLIED';publication.outcome=outcome;publication.save(update_fields=['outcome'])
 if match and not already:decision(None,'READBACK_APPLIED',publication.pk,
  {'revision':publication.revision,'package_sha256':publication.package_sha256,'template_hash':publication.template_hash})
 return outcome


def publish(action,filters,token,native_factory=NativeCatalog):
 with transaction.atomic():control.enabled();actor(token,action)
 native=native_factory()
 if action=='retry':
  exact(filters,{'request_id'});publication=CatalogPublication.objects.get(pk=identity(filters['request_id']))
 else:publication=prepare_publication(action,filters,token,native.info())
 with transaction.atomic():
  actor(token,action);current=CatalogAssignment.objects.get(tenant_id=publication.tenant_id)
  if current.revision!=publication.revision:
   return {'state':'SUPERSEDED','request_id':str(publication.pk),'revision':current.revision}
 # Always read actual state on recovery; an earlier PENDING intent is not proof.
 ticket=control.mint(publication.pk,token)
 value=approved(CatalogRelease.objects.get(pk=publication.package_sha256)).package if publication.package_sha256 else None
 try:
  actual=native.readback(ticket)
  if actual['assignment_revision']<publication.revision:
   native.apply(str(publication.pk),value,ticket)
   actual=native.readback(ticket)
 except RuntimeFailure as error:
  return {'state':'PENDING','request_id':str(publication.pk),'revision':publication.revision,
          'code':error.code,'outcome':error.outcome}
 outcome=record_readback(publication.pk,actual)
 with transaction.atomic():actor(token,action)
 return outcome
