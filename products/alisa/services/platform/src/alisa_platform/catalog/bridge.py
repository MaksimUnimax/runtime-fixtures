"""Control exchange on the existing pinned Unix peer, with no business ticket."""
from alisa_platform.runtime_adapter.client import configured_client
from alisa_platform.runtime_adapter.job_client import RuntimeFailure
from .package_rules import digest,exact,hash_value,need


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

 def info(self):
  def validate(value):
   exact(value,{'capability','engine_sha256','base_template_hash'})
   need(value['capability']=='catalog_release_v1')
   hash_value(value['engine_sha256']);hash_value(value['base_template_hash']);return value
  return self.api._exchange('catalog_info',{},validate)

 def validate(self,payload):
  def validate(value):
   need(type(value)is dict and type(value.get('valid'))is bool)
   if not value['valid']:
    exact(value,{'valid','code'});need(type(value['code'])is str and
     value['code'].startswith('CATALOG_')and len(value['code'])<=64);return value
   exact(value,{'valid','package_sha256','template_hash','engine_sha256','base_template_hash','evidence'})
   need(value['package_sha256']==digest(payload)and value['engine_sha256']==payload['engine_sha256']and
        value['base_template_hash']==payload['base_template_hash'])
   hash_value(value['template_hash'])
   evidence=value['evidence'];exact(evidence,{'package_sha256','engine_sha256','base_template_hash',
    'inherited','new_provider_calls','new_numeric_or_source_qualification'})
   need(evidence['package_sha256']==value['package_sha256']and evidence['engine_sha256']==value['engine_sha256']and
        evidence['base_template_hash']==value['base_template_hash']and evidence['new_provider_calls']is False and
        evidence['new_numeric_or_source_qualification']is False)
   need(type(evidence['inherited'])is list and len(evidence['inherited'])==len(payload['additions']))
   for row in evidence['inherited']:
    exact(row,{'template_id','base_template_ids','binding_sha256','qualification','level'})
    need(row['qualification']=='INHERITED_IDENTICAL_BINDINGS'and row['level']=='BASE_QUALIFICATION_ONLY')
   return value
  return self.api._exchange('catalog_validate',{'package':payload},validate)

 def apply(self,request_id,payload,ticket):
  return self.api._exchange('catalog_apply',{'request_id':request_id,'package':payload,'ticket':ticket},readback_shape)

 def readback(self,ticket):
  return self.api._exchange('catalog_readback',{'ticket':ticket},readback_shape)
