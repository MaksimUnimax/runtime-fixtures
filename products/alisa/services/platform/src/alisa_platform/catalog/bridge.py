"""Control exchange on the existing pinned Unix peer, with no business ticket."""
from alisa_platform.runtime_adapter.client import configured_client
from alisa_platform.runtime_adapter.job_client import RuntimeFailure
from .package_rules import ReleaseFailure,digest,exact,hash_value,need


class ControlOnly:
 def prepare(self,operation):raise RuntimeFailure('PERMISSION_DENIED')
 def current(self,context,operation):return False


def readback_shape(value):
 exact(value,{'assignment_revision','package_sha256','template_hash','engine_sha256','last_request_id'})
 need(type(value['assignment_revision'])is int and 0<=value['assignment_revision']<=2147483647)
 need(value['package_sha256']==''or hash_value(value['package_sha256']))
 hash_value(value['template_hash']);hash_value(value['engine_sha256'])
 from uuid import UUID
 need(value['last_request_id']is None or str(UUID(value['last_request_id']))==value['last_request_id'])
 return value


class NativeCatalog:
 def __init__(self,api=None):
  self.api=api or configured_client(ControlOnly())
  self.api.current_versions()

 def exchange(self,operation,payload,validate):
  def checked(value):
   try:return validate(value)
   except ReleaseFailure:raise RuntimeFailure('DEPENDENCY_UNAVAILABLE')from None
  return self.api._exchange(operation,payload,checked)

 def info(self):
  def validate(value):
   exact(value,{'capability','engine_sha256','base_template_hash','speech_sha256','qualification_sha256','proof'})
   need(value['capability']=='catalog_release_v1')
   for key in ['engine_sha256','base_template_hash','speech_sha256','qualification_sha256']:hash_value(value[key])
   return value
  return self.exchange('catalog_info',{},validate)

 def validate(self,payload):
  def validate(value):
   need(type(value)is dict and type(value.get('valid'))is bool)
   if not value['valid']:
    exact(value,{'valid','code'});need(type(value['code'])is str and
     value['code'].startswith('CATALOG_')and len(value['code'])<=64);return value
   exact(value,{'valid','package_sha256','template_hash','engine_sha256','base_template_hash','speech_sha256','evidence','proof'})
   need(value['package_sha256']==digest(payload)and value['engine_sha256']==payload['engine_sha256']and
        value['base_template_hash']==payload['base_template_hash'])
   hash_value(value['template_hash'])
   hash_value(value['speech_sha256'])
   evidence=value['evidence'];exact(evidence,{'package_sha256','engine_sha256','base_template_hash',
    'inherited','new_provider_calls','new_numeric_or_source_qualification','qualification_sha256'})
   hash_value(evidence['qualification_sha256'])
   need(evidence['qualification_sha256']==payload['qualification_sha256'])
   proof=value['proof'];exact(proof,{'proof_id','level','artifact_sha256','scope'})
   need(proof['level']=='INTEGRATION_FIXTURE'and proof['scope']=='BYTE_IDENTICAL_BASE_BINDINGS')
   hash_value(proof['artifact_sha256'])
   need(evidence['package_sha256']==value['package_sha256']and evidence['engine_sha256']==value['engine_sha256']and
        evidence['base_template_hash']==value['base_template_hash']and evidence['new_provider_calls']is False and
        evidence['new_numeric_or_source_qualification']is False)
   need(type(evidence['inherited'])is list and len(evidence['inherited'])==len(payload['additions']))
   for row in evidence['inherited']:
    exact(row,{'template_id','base_template_ids','binding_sha256','qualification','level'})
    need(row['qualification']=='INHERITED_IDENTICAL_BINDINGS'and row['level']=='BASE_QUALIFICATION_ONLY')
   return value
  return self.exchange('catalog_validate',{'package':payload},validate)

 def templates(self,filters):
  from .package_rules import identifier
  exact(filters,{'query','offset'})
  need(type(filters['query'])is str and len(filters['query'])<=200 and
       type(filters['offset'])is int and 0<=filters['offset']<=1000)
  def validate(value):
   exact(value,{'items','next_offset'})
   need(type(value['items'])is list and len(value['items'])<=20)
   need(value['next_offset']is None or type(value['next_offset'])is int and
        value['next_offset']==filters['offset']+20<=1000)
   for row in value['items']:
    exact(row,{'id','purpose','kind','platforms','input_policy'});identifier(row['id'])
    need(type(row['purpose'])is str and len(row['purpose'])<=12000)
   return value
  return self.exchange('catalog_templates',filters,validate)

 def apply(self,request_id,payload,ticket):
  try:return self.exchange('catalog_apply',{'request_id':request_id,'package':payload,'ticket':ticket},readback_shape)
  except RuntimeFailure as error:
   # The base client classifies only its original mutation operations. A lost
   # control reply must conservatively require readback with this same ID.
   raise RuntimeFailure(error.code,outcome='UNKNOWN')from None

 def readback(self,ticket):
  return self.exchange('catalog_readback',{'ticket':ticket},readback_shape)
