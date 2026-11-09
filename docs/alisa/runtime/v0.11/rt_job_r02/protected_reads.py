"""Encrypted, job-bound owner outputs and provenance-backed report resources.
Neither unredacted records, document bytes nor signed URLs enter the LLM context.
"""
from dataclasses import dataclass,field
from pathlib import Path
from urllib.parse import urlsplit
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import base64,hashlib,json,os,re,secrets,stat
from semantics import Rejected,canonical_json,strict_json

@dataclass
class ProtectedPayload:
    safe:dict
    raw:bytes=field(repr=False)
    mime:str='application/octet-stream'

def need(ok,code='READ_RESOURCE_DENIED'):
    if not ok:raise Rejected(code)

def install(repo):
    with repo.connection(True)as c:
        c.execute('''CREATE TABLE IF NOT EXISTS read_payloads(
          ref TEXT PRIMARY KEY,tenant TEXT NOT NULL,jid TEXT NOT NULL,store_id TEXT NOT NULL,
          kind TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,sha TEXT NOT NULL,
          expires REAL NOT NULL,parent_ref TEXT,nonce BLOB NOT NULL,payload BLOB NOT NULL)''')
        c.execute('CREATE INDEX IF NOT EXISTS read_payload_expiry ON read_payloads(expires)')

def key(repo):
    path=Path(repo.path).with_name('read-payload-key.bin')
    try:
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    except FileExistsError:pass
    else:
        try:os.write(fd,secrets.token_bytes(32));os.fsync(fd)
        finally:os.close(fd)
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        s=os.fstat(fd);need(stat.S_ISREG(s.st_mode)and s.st_uid==os.getuid()and s.st_mode&0o077==0,'READ_KEY_PERMISSIONS')
        value=os.read(fd,33);need(len(value)==32,'READ_KEY_INVALID');return value
    finally:os.close(fd)

def aad(row):
    return canonical_json({k:row[k]for k in ['ref','tenant','jid','store_id','kind','mime','size','sha','expires','parent_ref']}).encode()

def store(repo,job,store_id,raw,mime,kind='BINARY',parent_ref=None):
    need(type(raw)is bytes and len(raw)<=12000000,'READ_PAYLOAD_SIZE');need(kind in('BINARY','OWNER_JSON','REMOTE_URL'))
    prefix='rpf_'if kind=='REMOTE_URL'else'raf_';ref=prefix+secrets.token_urlsafe(24)
    row={'ref':ref,'tenant':job['tenant'],'jid':job['id'],'store_id':store_id,'kind':kind,'mime':mime,
         'size':len(raw),'sha':hashlib.sha256(raw).hexdigest(),'expires':repo.clock()+min(repo.ttl,900),'parent_ref':parent_ref}
    if parent_ref is not None:
        with repo.connection()as c:
            parent=c.execute('SELECT expires FROM read_payloads WHERE ref=?AND tenant=?AND store_id=?',(parent_ref,job['tenant'],store_id)).fetchone()
            need(parent is not None and parent['expires']>repo.clock(),'READ_RESOURCE_EXPIRED');row['expires']=min(row['expires'],parent['expires'])
    nonce=secrets.token_bytes(12);cipher=AESGCM(key(repo)).encrypt(nonce,raw,aad(row))
    with repo.connection(True)as c:
        current=repo._owned(c,job['id'],job['owner']);plan=strict_json(current['plan'])
        need(any(s['id']==store_id for s in plan['stores']))
        c.execute('INSERT INTO read_payloads VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',tuple(row[k]for k in ['ref','tenant','jid','store_id','kind','mime','size','sha','expires','parent_ref'])+(nonce,cipher))
    return {'file_ref':ref,'bytes':row['size'],'sha256':row['sha'],'media_type':mime,'expires_at':row['expires'],'owner_authorization_required':True}

def record(engine,tenant,store_id,ref,*,conversation=None,current_job=None,depth=0):
    need(depth<8,'READ_RESOURCE_CHAIN')
    need(type(ref)is str and re.fullmatch(r'(?:rpf|raf)_[A-Za-z0-9_-]{24,80}',ref)is not None)
    with engine.repo.connection()as c:
        row=c.execute('SELECT * FROM read_payloads WHERE ref=? AND tenant=? AND store_id=?',(ref,tenant,store_id)).fetchone();need(row is not None)
        need(row['expires']>engine.repo.clock(),'READ_RESOURCE_EXPIRED')
        job=c.execute('SELECT * FROM jobs WHERE tenant=?AND id=?',(tenant,row['jid'])).fetchone()
        need(job is not None and job['plan']and job['state']in('RUNNING','QUEUED','READY'))
        if job['expires']is not None:need(job['expires']>engine.repo.clock(),'READ_RESOURCE_EXPIRED')
        if conversation is not None:
            # Resolve aliases only through a live reader subscription belonging to
            # this tenant/conversation. A global job ID is not an access grant.
            allowed=c.execute('''WITH RECURSIVE owned(id,alias,depth)AS(
              SELECT j.id,j.alias,0 FROM jobs j JOIN reader_cursors r ON r.jid=j.id
               WHERE r.tenant=?AND r.conversation=?AND r.cancelled=0 AND j.tenant=?
              UNION ALL SELECT j.id,j.alias,o.depth+1 FROM jobs j JOIN owned o ON j.id=o.alias
               WHERE j.tenant=?AND o.depth<7)
              SELECT 1 FROM owned WHERE id=? LIMIT 1''',(tenant,conversation,tenant,tenant,row['jid'])).fetchone()
            need(allowed is not None)
        elif current_job is not None and current_job!=row['jid']:
            common=c.execute('''SELECT 1 FROM reader_cursors a JOIN reader_cursors b
              ON a.tenant=b.tenant AND a.conversation=b.conversation WHERE a.tenant=?
              AND a.jid=? AND b.jid=? AND a.cancelled=0 AND b.cancelled=0 LIMIT 1''',(tenant,row['jid'],current_job)).fetchone()
            need(common is not None)
        else:need(current_job==row['jid'])
        plan=strict_json(job['plan']);need(engine.authorized(plan),'SOURCE_ACCESS')
        need(any(s['id']==store_id for s in plan['stores']),'SOURCE_ACCESS')
        snapshot=dict(row)
    try:raw=AESGCM(key(engine.repo)).decrypt(snapshot['nonce'],snapshot['payload'],aad(snapshot))
    except Exception:raise Rejected('READ_RESOURCE_INTEGRITY')from None
    need(len(raw)==snapshot['size']and hashlib.sha256(raw).hexdigest()==snapshot['sha'],'READ_RESOURCE_INTEGRITY')
    if snapshot['parent_ref']is not None:record(engine,tenant,store_id,snapshot['parent_ref'],current_job=snapshot['jid'],depth=depth+1)
    need(engine.authorized(plan),'SOURCE_ACCESS');return snapshot,raw

def chunk(engine,value):
    fields={'op','tenant','store_id','file_ref','conversation_id','offset','length'}
    need(type(value)is dict and set(value)==fields,'IPC_SCHEMA')
    need(all(type(value[k])is str for k in ['tenant','store_id','file_ref','conversation_id']),'IPC_SCHEMA')
    need(type(value['offset'])is int and value['offset']>=0 and type(value['length'])is int and 1<=value['length']<=4096,'READ_CHUNK_SCHEMA')
    meta,raw=record(engine,value['tenant'],value['store_id'],value['file_ref'],conversation=value['conversation_id'])
    need(meta['kind']!='REMOTE_URL','READ_RESOURCE_MUST_BE_FETCHED');need(value['offset']<=len(raw),'READ_CHUNK_SCHEMA')
    part=raw[value['offset']:value['offset']+value['length']]
    return {'text':'Защищённый документ прочитан.','tts':'Защищённый документ прочитан.','artifact':{
        'file_ref':value['file_ref'],'media_type':meta['mime'],'sha256':meta['sha'],'bytes':len(raw),
        'offset':value['offset'],'next_offset':value['offset']+len(part),'eof':value['offset']+len(part)==len(raw),'base64':base64.b64encode(part).decode()}}

def validate_url(url):
    from read_surface import CATALOG
    need(type(url)is str and len(url)<=8192,'READ_RESOURCE_URL')
    try:p=urlsplit(url);port=p.port
    except ValueError:raise Rejected('READ_RESOURCE_URL')from None
    need(p.scheme=='https'and not p.username and not p.password and not p.fragment and port in(None,443),'READ_RESOURCE_URL')
    host=(p.hostname or'').lower()
    roots=CATALOG['file_provenance'].get('url_domain_roots',[])
    allowed='https://'+p.netloc in CATALOG['file_provenance']['url_origins']or any(host==r or host.endswith('.'+r)for r in roots)
    need(allowed,'READ_RESOURCE_ORIGIN')
    need(not any(c in url for c in '\r\n\x00')and p.path.startswith('/'),'READ_RESOURCE_URL');return url


def bind_resource_request(request,url,*,repository=None,access_revision=None):
    from dataclasses import replace
    validate_url(url)
    if repository is not None:
        need(type(access_revision)is str and bool(access_revision),'SOURCE_ACCESS')
        # Preserve old aggregate denials. This patch never clears or bypasses
        # previously recorded refusals while isolating new per-file outcomes.
        need(not repository.denied(request.source,access_revision),'SOURCE_ACCESS')
    # Signed file access is a resource authorization, not seller API-key access.
    # Scope failure/rate observations to the actual trusted resource URL. Neither
    # re-minting the same reference nor another store bypasses its own rejection.
    source=request.source+':file:'+hashlib.sha256(url.encode()).hexdigest()
    return replace(request,source=source,body={**request.body,'resolved_resource':url})


def resolve_url(engine,job,store_id,ref):
    meta,raw=record(engine,job['tenant'],store_id,ref,current_job=job['id']);need(meta['kind']=='REMOTE_URL')
    return validate_url(raw.decode('utf-8'))

def replace_urls(repo,job,store_id,operation,value):
    from read_surface import CATALOG
    paths=CATALOG.get('file_provenance',{}).get('source_fields',{}).get(operation,[])
    if not paths:return value
    # Only explicitly known URL fields of successful same-store report APIs.
    import copy
    out=copy.deepcopy(value)
    def replace_at(node,parts):
        if not parts:return
        first,*rest=parts
        if first=='*':
            need(type(node)is list,'READ_RESOURCE_SOURCE_SHAPE')
            for child in node:replace_at(child,rest)
        elif type(node)is dict and first in node:
            if rest:replace_at(node[first],rest)
            elif node[first]not in(None,''):
                try:url=validate_url(node[first])
                except Rejected as error:
                    node[first]={'file_ref':None,'retrieval_status':error.code,'source_verified':False}
                else:
                    ref=store(repo,job,store_id,url.encode(),'text/uri-list','REMOTE_URL')
                    node[first]={'file_ref':ref['file_ref'],'expires_at':ref['expires_at'],'source_verified':True}
    for path in paths:replace_at(out,path.split('.'))
    def scrub(value):
        if type(value)is str and ('https://'in value or 'http://'in value):return '[UNREGISTERED_URL_WITHHELD]'
        if type(value)is list:return [scrub(v)for v in value]
        if type(value)is dict:return {k:scrub(v)for k,v in value.items()}
        return value
    return scrub(out)

def finalize(engine,job,store_id,operation,value,params):
    if isinstance(value,ProtectedPayload):
        ref=store(engine.repo,job,store_id,value.raw,value.mime,'OWNER_JSON'if value.mime=='application/json'else'BINARY',params.get('file_ref')if operation=='report_file_get'else None)
        answer=dict(value.safe);answer['protected_file']=ref;answer['full_content_in_planner']=False
        if operation=='report_file_get':
            from report_tables import page
            table=page(value.raw,params)
            if table is not None:
                data=canonical_json(table).encode();answer['table_page']=store(engine.repo,job,store_id,data,'application/json','OWNER_JSON',ref['file_ref'])
                answer['table_summary']={k:table[k]for k in ['offset','rows_count','has_more']}
            else:answer['tabular_extraction']='NOT_TABULAR_OR_UNSUPPORTED_FORMAT'
        return answer
    return replace_urls(engine.repo,job,store_id,operation,value)

def sniff(raw):
    if raw.startswith(b'%PDF-'):return 'application/pdf'
    if raw.startswith(b'\x89PNG\r\n\x1a\n'):return 'image/png'
    if raw.startswith(b'\xff\xd8\xff'):return 'image/jpeg'
    if raw.startswith(b'PK\x03\x04'):return 'application/zip'
    return 'application/octet-stream'

def protected_json(raw):
    value=strict_json(raw);counts={}
    if type(value)is dict:
        for k,v in value.items():
            if type(v)is list and k in('items','orders','messages','events','chats','users','data','result','clients','reports'):counts[k]=len(v)
    elif type(value)is list:counts['items']=len(value)
    return ProtectedPayload({'protected_record':True,'response_container':type(value).__name__,'top_level_array_lengths':counts,'content_scope':'AUTHORIZED_OWNER_ONLY'},raw,'application/json')
