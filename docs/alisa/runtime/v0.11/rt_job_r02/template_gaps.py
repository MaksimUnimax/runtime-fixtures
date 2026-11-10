"""Durable encrypted pilot backlog. Not the short-lived report/model-usage log.

Only unsupported-template cases are archived. Cases have no automatic expiry:
keep them until an explicit owner review/closure. No credentials/tickets accepted.
"""
from pathlib import Path
from contextlib import contextmanager
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import os,stat,secrets,sqlite3,hashlib,json
from semantics import Rejected,canonical_json,strict_json

def _key(path):
    keypath=path.with_suffix('.key')
    try:fd=os.open(keypath,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    except FileExistsError:pass
    else:
        try:
            value=secrets.token_bytes(32)
            if os.write(fd,value)!=len(value):raise OSError('incomplete key write')
            os.fsync(fd)
        finally:os.close(fd)
    fd=os.open(keypath,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        s=os.fstat(fd)
        if not stat.S_ISREG(s.st_mode)or s.st_uid!=os.getuid()or s.st_mode&0o077:raise Rejected('TEMPLATE_GAP_KEY_PERMISSIONS')
        value=os.read(fd,33)
        if len(value)!=32:raise Rejected('TEMPLATE_GAP_KEY_INVALID')
        return value
    finally:os.close(fd)

class GapStore:
    def __init__(self,path,*,internal_test=False):
        if type(internal_test)is not bool:raise ValueError('Boolean internal-test provenance required')
        self.internal_test=internal_test
        self.path=Path(path);self.path.parent.mkdir(parents=True,exist_ok=True)
        self.key=_key(self.path)
        # File is private before sqlite creates pages. Refuse symbolic links.
        fd=os.open(self.path,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
        try:
            s=os.fstat(fd)
            if not stat.S_ISREG(s.st_mode)or s.st_uid!=os.getuid()or s.st_mode&0o077:raise Rejected('TEMPLATE_GAP_FILE_PERMISSIONS')
        finally:os.close(fd)
        with self.connection()as c:
            c.execute('PRAGMA journal_mode=WAL')
            c.execute('''CREATE TABLE IF NOT EXISTS cases(
             id TEXT PRIMARY KEY,tenant TEXT NOT NULL,jid TEXT NOT NULL,
             created REAL NOT NULL,reason TEXT NOT NULL,catalog_hash TEXT NOT NULL,
             payload_sha256 TEXT NOT NULL,nonce BLOB NOT NULL,payload BLOB NOT NULL,
             review_state TEXT NOT NULL DEFAULT 'OPEN',review_note TEXT,
             UNIQUE(tenant,jid))''')
            from query_gap_outbox import install
            install(c)
    @contextmanager
    def connection(self,write=False):
        c=sqlite3.connect(str(self.path),timeout=10);c.row_factory=sqlite3.Row
        try:
            c.execute('PRAGMA synchronous=FULL');c.execute('PRAGMA secure_delete=ON')
            if write:c.execute('BEGIN IMMEDIATE')
            yield c;c.commit()
        except BaseException:c.rollback();raise
        finally:c.close()
    @staticmethod
    def aad(row):return canonical_json({k:row[k]for k in ['id','tenant','jid','created','reason','catalog_hash','payload_sha256']}).encode()
    def save(self,tenant,jid,created,reason,catalog_hash,payload):
        raw=canonical_json(payload).encode();ident='tgap_'+hashlib.sha256((tenant+'\0'+jid).encode()).hexdigest()[:32]
        row={'id':ident,'tenant':tenant,'jid':jid,'created':created,'reason':reason,'catalog_hash':catalog_hash,'payload_sha256':hashlib.sha256(raw).hexdigest()}
        nonce=secrets.token_bytes(12);cipher=AESGCM(self.key).encrypt(nonce,raw,self.aad(row))
        with self.connection(True)as c:
            old=c.execute('SELECT *FROM cases WHERE tenant=?AND jid=?',(tenant,jid)).fetchone()
            if old:
                # Replayed terminal step must not create a second case or silently
                # replace evidence. Read/decrypt validates the original bytes.
                self._decode(old);return old['id']
            c.execute('INSERT INTO cases(id,tenant,jid,created,reason,catalog_hash,payload_sha256,nonce,payload) VALUES(?,?,?,?,?,?,?,?,?)',tuple(row[k]for k in ['id','tenant','jid','created','reason','catalog_hash','payload_sha256'])+(nonce,cipher))
            from query_gap_outbox import enqueue
            c.execute('SAVEPOINT safe_gap_event')
            try:enqueue(c,self.key,tenant,jid,created,reason,catalog_hash,payload,internal_test=self.internal_test)
            except (sqlite3.Error,ValueError,TypeError,KeyError,OverflowError):
                c.execute('ROLLBACK TO safe_gap_event')
                c.execute("UPDATE gap_event_health SET dropped=dropped+1,last_error='OUTBOX_STORAGE'WHERE singleton=1")
            finally:c.execute('RELEASE safe_gap_event')
        return ident
    def _decode(self,row):
        try:raw=AESGCM(self.key).decrypt(row['nonce'],row['payload'],self.aad(row))
        except Exception:raise Rejected('TEMPLATE_GAP_INTEGRITY')from None
        if hashlib.sha256(raw).hexdigest()!=row['payload_sha256']:raise Rejected('TEMPLATE_GAP_INTEGRITY')
        return strict_json(raw)
    def get(self,tenant,case_id):
        with self.connection()as c:r=c.execute('SELECT *FROM cases WHERE tenant=?AND id=?',(tenant,case_id)).fetchone()
        if r is None:raise Rejected('TEMPLATE_GAP_NOT_FOUND')
        return self._decode(r)
    def list(self,tenant=None):
        with self.connection()as c:
            rows=c.execute('SELECT id,tenant,jid,created,reason,catalog_hash,review_state,payload_sha256 FROM cases'+(' WHERE tenant=?'if tenant else'')+' ORDER BY created',((tenant,)if tenant else())).fetchall()
        return [dict(r)for r in rows]
