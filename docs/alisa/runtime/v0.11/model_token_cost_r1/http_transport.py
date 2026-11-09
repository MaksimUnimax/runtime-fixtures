"""Single fail-closed HTTPS boundary for matrix recipes and the model envelope.
Business endpoints, header bindings, transient auth dependencies and empty-body
rules are catalogue data. No response/endpoint-specific business branches.
"""
from __future__ import annotations
import json,time,urllib.request,urllib.error,http.client
from decimal import Decimal
from email.utils import parsedate_to_datetime
from pathlib import Path
from engine import CallError
from semantics import strict_json,Rejected
from registry import REGISTRY_HASH
from query_program import model_system
from semantic_catalog import EXPRESSION_CATALOG
from table_analytics import HASH as TABLE_HASH,SOURCE_MATRIX as ROW_SOURCES
from scalar_runtime import MATRIX as SCALARS,SOURCES as SCALAR_SOURCES
from matrix_core import MatrixError
import providers

if set(ROW_SOURCES.sources)&set(SCALAR_SOURCES.sources):raise ValueError('ambiguous source operation')
from matrix_sources import SourceMatrix
DATASET_SOURCES=SourceMatrix(strict_json(Path(__file__).with_name('dataset_sources.json').read_text()))
if (set(ROW_SOURCES.sources)|set(SCALAR_SOURCES.sources)) & set(DATASET_SOURCES.sources):raise ValueError('ambiguous dataset operation')
MATRICES={**{k:ROW_SOURCES for k in ROW_SOURCES.sources},**{k:SCALAR_SOURCES for k in SCALAR_SOURCES.sources},**{k:DATASET_SOURCES for k in DATASET_SOURCES.sources}}
ENDPOINTS={k:m.recipe(k)['url'] for k,m in MATRICES.items()}
ENDPOINTS['deepseek_parse']='https://api.deepseek.com/chat/completions'

from shared_http import NoRedirect,read_response

class HTTPTransport:
    model_source = 'model:deepseek-flash'
    max_request_seconds = 90
    def __init__(self,credential_directory,bindings,qualifications,enabled=False,qualification_provider=None,read_surface_policy=None):
        self.directory=Path(credential_directory);self.bindings=dict(bindings)
        self.qualifications=dict(qualifications);self.enabled=enabled;self._tokens={}
        self.qualification_provider=qualification_provider
        self.read_surface_policy=read_surface_policy

    def _credential(self,name):
        if not isinstance(name,str) or not name or Path(name).name!=name or name in ('.','..'):raise CallError('CREDENTIAL_NAME')
        p=self.directory/name
        if p.is_symlink() or not p.is_file():raise CallError('CREDENTIAL_UNAVAILABLE')
        value=p.read_text().strip()
        if not 12<=len(value)<=8192:raise CallError('CREDENTIAL_SIZE')
        return value

    def _scope(self,request,store):
        if store is None or store['id']!=request.store_id or store['id'] not in self.bindings:raise CallError('CREDENTIAL_SCOPE')

    def _cache_key(self,store,profile):
        dependency=SCALARS.auth[profile]['operation']
        return (store['id'],store['identity'],store['access_revision'],store['source_revision'],self.bindings.get(store['id']),profile,SCALAR_SOURCES.fingerprint(dependency))

    def _qualification(self,operation):
        if self.qualification_provider is not None:
            try:current=self.qualification_provider()
            except Exception:raise CallError('SOURCE_PROOF_UNAVAILABLE') from None
            if type(current) is not dict:raise CallError('SOURCE_PROOF_UNAVAILABLE')
            self.qualifications=dict(current)
        if not self.enabled:raise CallError('LIVE_DISABLED')
        if operation not in MATRICES:raise CallError('ENDPOINT_NOT_ALLOWED')
        proof=self.qualifications.get(operation,{})
        if (not isinstance(proof,dict) or proof.get('status') not in ('LIVE_LAB_VERIFIED','READ_ONLY_CANARY') or proof.get('registry_hash')!=REGISTRY_HASH or not proof.get('evidence_ref')):raise CallError('DECODER_NOT_LIVE_QUALIFIED')
        matrix=MATRICES[operation]
        if matrix is ROW_SOURCES and proof.get('table_hash')!=TABLE_HASH:raise CallError('TABLE_DECODER_NOT_QUALIFIED')
        if matrix is SCALAR_SOURCES and proof.get('scalar_hash')!=SCALARS.hash:raise CallError('SCALAR_DECODER_NOT_QUALIFIED')
        if matrix is DATASET_SOURCES:
            if proof.get('dataset_source_hash')!=DATASET_SOURCES.hash:raise CallError('DATASET_SOURCE_NOT_QUALIFIED')
            if any(proof.get(k)!=v for k,v in matrix.recipe(operation)['proof_requirements'].items()):raise CallError('DATASET_TOKEN_POLICY_NOT_QUALIFIED')
        return matrix

    def _scoped_qualification(self,matrix,request,store):
        from qualification_scope import check_scope,QualificationError
        try:
            check_scope(matrix.recipe(request.operation),matrix.fingerprint(request.operation),
                        self.qualifications.get(request.operation,{}),store,request.body,time.time())
        except QualificationError as exc:raise CallError(exc.code) from None

    def _read_request(self,request,store):
        import read_surface as reads
        if not self.enabled or not callable(self.read_surface_policy):raise CallError('READ_SURFACE_DISABLED')
        policy=self.read_surface_policy()
        if policy.get('enabled')is not True or policy.get('pin')!=reads.PIN:raise CallError('READ_SURFACE_DISABLED')
        self._scope(request,store)
        try:prefix,platform,operation=request.operation.split('.',2)
        except ValueError:raise CallError('READ_METHOD_SCHEMA')from None
        if prefix!='read'or platform!=store['platform']or set(request.body)not in ({'params'},{'params','resolved_resource'}):raise CallError('CREDENTIAL_PLATFORM')
        if 'resolved_resource'in request.body and reads.method(platform,operation).get('completion',{}).get('mode')!='opaque-file':raise CallError('CREDENTIAL_PLATFORM')
        return reads.build(platform,operation,request.body['params']),reads.method(platform,operation)

    def _completion_credentials(self,meta,store):
        if meta.get('completion',{}).get('mode')!='wb-service':return None
        credentials=strict_json(self._credential(self.bindings[store['id']]))
        if (not isinstance(credentials.get('wb_service_token'),str)or not credentials['wb_service_token']
            or credentials.get('wb_service_verified_identity')!=store['identity']
            or credentials.get('wb_service_verified_access_revision')!=store['access_revision']):
            raise CallError('WB_SERVICE_CREDENTIAL_REQUIRED')
        return {'Authorization':credentials['wb_service_token']}

    def _read_profile(self,meta):
        dependency=meta.get('transient_auth_operation')
        if dependency is None:return None
        names=[k for k,v in SCALARS.auth.items()if v['operation']==dependency]
        if len(names)!=1:raise CallError('PERFORMANCE_AUTH_NOT_CONFIGURED')
        return names[0]

    def prepare(self,request,store):
        if request.operation.startswith('read.'):
            built,meta=self._read_request(request,store);profile=self._read_profile(meta)
            if meta.get('completion',{}).get('mode')=='opaque-file':return None
            self._completion_credentials(meta,store)
            if profile is None:return None
            settings=SCALARS.auth[profile];cached=self._tokens.get(self._cache_key(store,profile))
            if cached and cached[1]>time.time()+settings['refresh_margin']:return None
            operation=settings['operation'];self._qualification(operation);spec=SCALAR_SOURCES.recipe(operation)
            return providers.Request(operation,store['platform']+':'+store['identity']+':'+spec['quota_operation'],store['id'],{},spec['interval'],spec['daily_limit'])
        profile=SCALARS.profile_for(request.operation)
        if profile is None:return None
        self._scope(request,store)
        # Qualify the requested data source before spending a grant call.
        matrix=self._qualification(request.operation)
        self._scoped_qualification(matrix,request,store)
        if matrix.recipe(request.operation)['platform']!=store['platform']:raise CallError('CREDENTIAL_PLATFORM')
        settings=SCALARS.auth[profile];cached=self._tokens.get(self._cache_key(store,profile))
        if cached and cached[1]>time.time()+settings['refresh_margin']:return None
        operation=settings['operation'];self._qualification(operation);spec=SCALAR_SOURCES.recipe(operation)
        # Secret request data are deliberately absent. They are bound only in execute().
        return providers.Request(operation,store['platform']+':'+store['identity']+':'+spec['quota_operation'],store['id'],{},spec['interval'],spec['daily_limit'])

    def execute_observed(self,request,store,on_dispatch):
        return self.execute(request,store,on_dispatch=on_dispatch)

    def execute(self,request,store,*,on_dispatch=None):
        operation=request.operation
        if not self.enabled:raise CallError('LIVE_DISABLED')
        is_read=operation.startswith('read.')
        if operation not in ENDPOINTS and operation not in ('deepseek_read_plan','model_answer','template_select','template_verify')and not is_read:raise CallError('ENDPOINT_NOT_ALLOWED')
        specification=None
        if is_read:
            built,meta=self._read_request(request,store)
            private_mode=meta.get('completion',{}).get('mode')
            credentials={}if private_mode=='opaque-file'else strict_json(self._credential(self.bindings[store['id']]))
            profile=self._read_profile(meta)
            if profile is not None:
                cached=self._tokens.get(self._cache_key(store,profile))
                if not cached or cached[1]<=time.time():raise CallError('PERFORMANCE_TOKEN_REQUIRED')
                headers={'Authorization':'Bearer '+cached[0]}
            elif private_mode=='opaque-file':
                from protected_reads import validate_url
                if set(request.body)!={'params','resolved_resource'}:raise CallError('READ_FILE_PROVENANCE_REQUIRED')
                built['url']=validate_url(request.body['resolved_resource']);headers={}
            elif private_mode=='wb-service':headers=self._completion_credentials(meta,store)
            else:headers={name:str(credentials[field])for name,field in meta['credential_headers'].items()}
            method=built['method'];url=built['url'];payload=strict_json(built['body'])if built.get('body')is not None else None
        elif operation in ('template_select','template_verify'):
            from template_protocol import payload as template_payload
            try:payload=template_payload(operation,request.body)
            except ValueError:raise CallError('TEMPLATE_MODEL_POLICY')from None
            method='POST';url=ENDPOINTS['deepseek_parse'];headers={'Authorization':'Bearer '+self._credential('deepseek')}
        elif operation=='model_answer':
            payload={'model':'deepseek-flash','messages':request.body['messages']}
            method='POST';url=ENDPOINTS['deepseek_parse'];headers={'Authorization':'Bearer '+self._credential('deepseek')}
        elif operation=='deepseek_read_plan':
            from universal_reads import SYSTEM, COLLECTION_SYSTEM
            system=request.body.get('system')
            if system not in (SYSTEM,COLLECTION_SYSTEM):raise CallError('MODEL_POLICY_CHANGED')
            payload={'model':'deepseek-flash','thinking':{'type':'disabled'},'temperature':0,'max_tokens':3500,'response_format':{'type':'json_object'},'messages':[{'role':'system','content':system},{'role':'user','content':json.dumps(request.body['context'],ensure_ascii=False)}]}
            method='POST';url=ENDPOINTS['deepseek_parse'];headers={'Authorization':'Bearer '+self._credential('deepseek')}
        elif operation=='deepseek_parse':
            payload={'model':'deepseek-flash','thinking':{'type':'disabled'},'temperature':0,'max_tokens':1800,'response_format':{'type':'json_object'},
                     'messages':[{'role':'system','content':model_system(request.body.get('catalog',EXPRESSION_CATALOG))},
                                 {'role':'user','content':json.dumps({'question':request.body['question'],'server_scope':request.body.get('slots',{}),'repair':request.body.get('repair')},ensure_ascii=False)}]}
            method='POST';url=ENDPOINTS[operation];headers={'Authorization':'Bearer '+self._credential('deepseek')}
        else:
            matrix=self._qualification(operation);specification=matrix.recipe(operation)
            self._scope(request,store)
            self._scoped_qualification(matrix,request,store)
            credentials=strict_json(self._credential(self.bindings[store['id']]))
            profile=SCALARS.profile_for(operation);ephemeral={}
            if profile is not None:
                cached=self._tokens.get(self._cache_key(store,profile))
                if not cached or cached[1]<=time.time():raise CallError(SCALARS.auth[profile]['missing_error'])
                ephemeral={'token':cached[0]}
            try:method,url,headers,payload=matrix.http(operation,request.body,store,credentials,ephemeral)
            except MatrixError as exc:raise CallError(exc.code) from None
        if operation in ('deepseek_parse','deepseek_read_plan') and request.body.get('instruction','').strip():
            payload['messages'].insert(1,{'role':'system','content':request.body['instruction']})
        encoded=None if payload is None else json.dumps(payload,ensure_ascii=False,allow_nan=False).encode()
        request_http=urllib.request.Request(url,data=encoded,headers={**headers,'Content-Type':'application/json'},method=method)
        start=time.monotonic()
        try:
            raw,status=read_response(request_http,timeout=self.max_request_seconds if operation=='model_answer' else 25,limit=12000000,**({'on_dispatch':on_dispatch} if on_dispatch is not None else {}))
        except urllib.error.HTTPError as exc:
            retry=exc.headers.get('Retry-After');retry_at=None
            try:
                if retry:retry_at=time.time()+max(0,int(retry))
            except (ValueError,TypeError):
                try:retry_at=parsedate_to_datetime(retry).timestamp()
                except (ValueError,TypeError,OverflowError):pass
            if is_read and meta.get('completion',{}).get('mode')=='opaque-file'and exc.code==403:
                exc.close();raise CallError('HTTP_403_READ_RESOURCE_DENIED',status=403)from None
            status=exc.code;code='HTTP_'+str(status);feedback=None
            if status==403:
                try:
                    from provider_denial import diagnose_denial,MAX_DIAGNOSTIC_BYTES
                    body=exc.read(MAX_DIAGNOSTIC_BYTES+1)
                    diagnosis=diagnose_denial(operation,url,status,body)
                    print(json.dumps(diagnosis,ensure_ascii=False),flush=True)
                    code=diagnosis.get('tier_public_code',diagnosis['public_code'])
                    if diagnosis.get('model_response')is not None:feedback={'model_response':diagnosis['model_response']}
                except Exception:
                    # Failure to inspect the received body never erases its HTTP
                    # status or manufactures a network-unknown/retry decision.
                    pass
            if status in (400,422) and is_read:
                from model_recovery import provider_feedback,catalog_parameter_names
                try:feedback=provider_feedback(exc.read(16385),request.body.get('params',{}),meta,catalog_parameter_names(store['platform']))
                except Exception:feedback={'reason_hints':[],'mentioned_parameters':[]}
            exc.close()
            raise CallError(code,status=status,retry_at=retry_at,feedback=feedback) from None
        except (urllib.error.URLError,TimeoutError,ConnectionError,OSError,http.client.HTTPException):
            raise CallError('NETWORK_OUTCOME_UNKNOWN',unknown=True) from None
        if len(raw)>12000000:raise CallError('RESPONSE_SIZE',status=status)
        completion=meta.get('completion',{})if is_read else{}
        if completion.get('mode')in('ozon-protected','wb-protected','opaque-file'):
            from protected_reads import ProtectedPayload,protected_json,sniff
            raw_format=sniff(raw)
            if raw_format=='application/octet-stream'and raw.lstrip().startswith((b'{',b'[')):
                private=protected_json(raw)
            else:private=ProtectedPayload({'document_received':True,'content_scope':'AUTHORIZED_OWNER_ONLY','content_extracted':False},raw,raw_format)
            return private,{'status':status,'elapsed_ms':int((time.monotonic()-start)*1000),'bytes':len(raw)}
        if is_read and built.get('response_style',built.get('response_mode','json'))=='binary':
            import csv,io,hashlib
            if 'text/csv'in built.get('response_content_types',[]):
                from csv_transport import decode_csv,CSVDecodeError
                try:data=decode_csv(raw,delimiter=built.get('response_csv_delimiter'))
                except CSVDecodeError as error:raise CallError(error.code,status=status)from None
            else:data={'file_bytes':len(raw),'file_sha256':hashlib.sha256(raw).hexdigest(),'content_extracted':False,'note':'Binary response requires a file export; no text contents claimed.'}
        else:
            try:data=[] if specification and status in specification.get('options',{}).get('empty_statuses',[]) and not raw else strict_json(raw,parse_float=Decimal)
            except (ValueError,UnicodeError):raise CallError('RESPONSE_JSON',status=status) from None
        meta={'status':status,'elapsed_ms':round(1000*(time.monotonic()-start)),'bytes':len(raw)}
        token_profiles=[(name,a) for name,a in SCALARS.auth.items() if a['operation']==operation]
        if token_profiles:
            for name,policy in token_profiles:
                try:
                    token=data;ttl=data
                    for component in policy['token_path']:token=token[component]
                    for component in policy['expires_path']:ttl=ttl[component]
                    if not isinstance(token,str) or not 12<=len(token)<=8192 or '\r' in token or '\n' in token or type(ttl)is not int or not policy['min_ttl']<ttl<=policy['max_ttl']:raise ValueError('schema')
                except (KeyError,TypeError,ValueError):raise CallError(policy['schema_error'],status=status) from None
                now=time.time()
                self._tokens={k:v for k,v in self._tokens.items() if v[1]>now}
                if len(self._tokens)>=128:self._tokens.pop(min(self._tokens,key=lambda k:self._tokens[k][1]))
                self._tokens[self._cache_key(store,name)]=(token,now+ttl)
            data={'authorized':True}
            meta['authentication_only']=True
        if is_read:
            import read_surface
            try:data=read_surface.sanitize(read_surface.project_response(store['platform'],request.operation.split('.',2)[2],data))
            except Rejected as error:
                print(json.dumps({'event':'read_response_projection_rejected','operation':request.operation,'http':status,'code':error.code,'root_type':type(data).__name__}),flush=True)
                # HTTPS completed and its body was received. A local projection
                # validation error is definitive, never UNKNOWN or blind retry.
                raise CallError(error.code,status=status)from None
        if operation in ('deepseek_parse','deepseek_read_plan','model_answer','template_select','template_verify'):
            from model_usage import receipt
            meta['model_usage']=receipt(data,payload['model'])
            try:
                choice=data['choices'][0];data={'content':choice['message']['content'],'finish_reason':choice['finish_reason']}
            except (KeyError,TypeError,IndexError):raise CallError('MODEL_ENVELOPE',status=status,model_usage=meta['model_usage']) from None
        if operation=='model_answer' and (type(data['content'])is not str or not data['content'].strip()):
            raise CallError('MODEL_ENVELOPE',status=status,model_usage=meta['model_usage'])
        return data,meta
