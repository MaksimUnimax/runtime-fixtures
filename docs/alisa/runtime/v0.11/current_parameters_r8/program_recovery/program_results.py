"""Private durable outbox. No model re-execution during result retrieval."""
import hashlib,json,os,tempfile,time
from pathlib import Path

TTL=3600

class Results:
    def __init__(self,root):
        self.root=Path(root);self.root.mkdir(mode=0o700,parents=True,exist_ok=True)
    def path(self,key):
        if len(key)!=64 or any(c not in '0123456789abcdef' for c in key):raise ValueError('job_id')
        return self.root/(key+'.json')
    def read(self,key,fingerprint):
        try:value=json.loads(self.path(key).read_text())
        except FileNotFoundError:return None
        if value['fingerprint']!=fingerprint:raise ValueError('job_binding')
        if value['state']!='started' and time.time()-value['at']>TTL:return {'state':'expired'}
        return value
    def save(self,key,value):
        fd,name=tempfile.mkstemp(dir=self.root,prefix='.pending-')
        try:
            with os.fdopen(fd,'w')as stream:
                json.dump(value,stream,ensure_ascii=False,allow_nan=False)
                stream.flush();os.fsync(stream.fileno())
            os.replace(name,self.path(key));self.sync()
        finally:Path(name).unlink(missing_ok=True)
    def sync(self):
        fd=os.open(self.root,os.O_RDONLY)
        try:os.fsync(fd)
        finally:os.close(fd)
    def start(self,key,fingerprint,workspace=None):
        self.save(key,{'state':'started','fingerprint':fingerprint,'at':time.time(),'workspace':workspace})
    def complete(self,key,fingerprint,content):
        value={'state':'complete','fingerprint':fingerprint,'at':time.time(),'content':content,
               'digest':hashlib.sha256(content.encode()).hexdigest()}
        self.save(key,value);return value
    def ack(self,key,fingerprint,digest):
        value=self.read(key,fingerprint)
        if value is None or value.get('state')!='complete' or value.get('digest')!=digest:raise ValueError('ack')
        # Keep a compact tombstone, so an accidental duplicate never reruns.
        self.save(key,{'state':'acknowledged','fingerprint':fingerprint,'at':time.time(),'digest':digest})
    def sweep(self,keep_started=None):
        for path in self.root.glob('*.json'):
            if time.time()-path.stat().st_mtime>TTL:
                value=json.loads(path.read_text())
                if value.get('state')=='started' and keep_started is not None and keep_started(value.get('workspace')):continue
                path.unlink()
        for path in self.root.glob('.pending-*'):
            if time.time()-path.stat().st_mtime>TTL:path.unlink()
        self.sync()

def binding(value):
    fields={k:value[k]for k in ('job_id','user_id','messages','document','model')}
    return hashlib.sha256(json.dumps(fields,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
