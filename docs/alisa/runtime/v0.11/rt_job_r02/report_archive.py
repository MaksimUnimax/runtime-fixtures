"""Owner-only marketplace documents, discovered from accepted template invocations.

No provider requests, model calls, queue, remote URL fetching or job TTL changes.
An independent private SQLite file keeps encrypted blocks for exactly 48 hours.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import asdict
from datetime import datetime, timezone
from html import escape
from pathlib import Path
from uuid import uuid4, uuid5, NAMESPACE_URL
import base64
import hashlib
import json
import os
import re
import secrets
import shutil
import sqlite3
import stat
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from semantics import Rejected, canonical_json, strict_json
from protected_reads import ProtectedPayload, key, sniff

TTL = 48 * 3600
CHUNK = 65536
MAX_FILE = 64 * 1024 * 1024
DEFAULT_BUDGET = 256 * 1024 * 1024
DISK_RESERVE = 3072 * 1024 * 1024
BINARY_META = '_report_archive_binary'
DOCUMENT_SINK = ContextVar('marketplace_document_sink', default=None)


class ReceivedArchiveError(Rejected):
    """Local archive failure after a definitive successful HTTP response."""
    def __init__(self, size, code='STORAGE_CAPACITY'):
        super().__init__(code)
        self.receipt={'status':200,'bytes':size}


def template_name(template):
    return ' '.join(str(template.get('name') or template.get('title') or template['purpose']).split())[:1000]


def need(value, code='VALIDATION_FAILED'):
    if not value: raise Rejected(code)


def owner(guard):
    pins = (guard or {}).get('pins', {})
    return {k: pins[k] for k in ('tenant_id', 'actor_id') if k in pins}


def _clean(value):
    from decimal import Decimal
    from read_surface import _SECRET
    from urllib.parse import urlsplit
    # Iterative copying avoids recursion growth before the rendering budget check.
    result = [None]; pending = [(value, result, 0)]
    while pending:
        v, container, slot = pending.pop()
        if isinstance(v, dict):
            out = {}; container[slot] = out
            for k, x in v.items():
                if _SECRET.search(k): out[k] = '[REDACTED]'
                else: pending.append((x, out, k))
        elif isinstance(v, list):
            out = [None] * len(v); container[slot] = out
            pending.extend((x, out, i) for i, x in enumerate(v))
        elif isinstance(v, Decimal): container[slot] = str(v)
        elif isinstance(v, str) and v.startswith(('https://', 'http://')):
            try:
                url = urlsplit(v)
                container[slot] = '[Закрытая ссылка не сохраняется]' if url.query or url.username or url.password else v
            except ValueError: container[slot] = '[Ссылка не сохраняется]'
        else: container[slot] = v
    return result[0]


def _html_bounded(value):
    # In particular, sparse rows must not expand into an unbounded N x M table.
    pending = [(value, 0)]; cost = 0
    while pending:
        v, depth = pending.pop(); cost += 1
        if depth > 30 or cost > 20000: return False
        if isinstance(v, dict): pending.extend((x, depth+1) for x in v.values())
        elif isinstance(v, list):
            if v and all(isinstance(x, dict) for x in v):
                columns = set(k for row in v for k in row)
                cost += len(v) * len(columns)
                if cost > 20000: return False
            pending.extend((x, depth+1) for x in v)
    return True


def _html(value, depth=0):
    if depth > 30: return '<pre>' + escape(canonical_json(value)) + '</pre>'
    if isinstance(value, dict):
        return '<dl>' + ''.join('<dt>' + escape(str(k)) + '</dt><dd>' + _html(v, depth+1) + '</dd>' for k,v in value.items()) + '</dl>'
    if isinstance(value, list):
        if value and all(isinstance(v, dict) for v in value):
            columns = list(dict.fromkeys(k for row in value for k in row))
            return '<table><thead><tr>' + ''.join('<th>'+escape(str(k))+'</th>' for k in columns) + '</tr></thead><tbody>' + ''.join('<tr>' + ''.join('<td>'+_html(row.get(k), depth+1)+'</td>' for k in columns) + '</tr>' for row in value) + '</tbody></table>'
        return '<ol>' + ''.join('<li>'+_html(v, depth+1)+'</li>' for v in value) + '</ol>' if value else '<p>[]</p>'
    return '<span>' + escape('null' if value is None else str(value)) + '</span>'


def document(value, title, operation, stamp, inputs):
    clean = _clean(value)
    raw = canonical_json(clean).encode()
    need(len(raw) <= MAX_FILE, 'STORAGE_CAPACITY')
    clean_inputs = _clean(inputs)
    if len(raw) > 1048576 or not _html_bounded(clean) or not _html_bounded(clean_inputs):
        return raw, 'application/json', hashlib.sha256(raw).hexdigest()
    page = ('<!doctype html><html lang="ru"><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" '
            'content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">'
            '<title>'+escape(title)+'</title><style>body{font:16px system-ui;margin:32px;line-height:1.5}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #bbb;padding:8px;vertical-align:top}dt{font-weight:600}dd{margin:0 0 16px}pre{white-space:pre-wrap}span{overflow-wrap:anywhere}</style>'
            '<h1>'+escape(title)+'</h1><p>Получено: '+escape(stamp)+' · '+escape(operation)+'</p>'
            '<h2>Параметры шаблона</h2>'+_html(clean_inputs)+'<h2>Ответ API маркетплейса</h2>'+_html(clean)+'</html>').encode()
    # Large documents keep the complete typed response rather than truncating it.
    if len(page) > MAX_FILE: return raw, 'application/json', hashlib.sha256(raw).hexdigest()
    return page, 'text/html', hashlib.sha256(raw).hexdigest()


def media(raw, hint=None):
    types = {'application/pdf':'pdf', 'text/csv':'csv', 'application/zip':'zip',
             'application/json':'json', 'text/plain':'txt', 'text/html':'html',
             'application/vnd.ms-excel':'xls',
             'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx',
             'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx',
             'image/png':'png', 'image/jpeg':'jpg', 'application/octet-stream':'bin'}
    kind = hint.split(';')[0].strip().lower() if isinstance(hint,str) else sniff(raw)
    if kind not in types: kind = 'application/octet-stream'
    return kind, types[kind]


class Archive:
    def __init__(self, repo, *, budget=DEFAULT_BUDGET):
        need(type(budget) is int and 16*1024*1024 <= budget <= 1024*1024*1024)
        self.repo, self.budget = repo, budget
        self.path = Path(repo.path).with_name('market-report-archive.sqlite3')
        need(not self.path.parent.is_symlink() and not self.path.parent.stat().st_mode & 0o022,
             'DEPENDENCY_UNAVAILABLE')
        try: fd = os.open(self.path, os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW, 0o600)
        except FileExistsError: pass
        else: os.close(fd)
        with self.connection() as c:
            c.execute('PRAGMA auto_vacuum=INCREMENTAL')
            c.execute('''CREATE TABLE IF NOT EXISTS reports(
             id TEXT PRIMARY KEY,tenant TEXT NOT NULL,jid TEXT NOT NULL,invocation TEXT NOT NULL,
             run_id TEXT NOT NULL,template_id TEXT NOT NULL,template_name TEXT NOT NULL,
             template_version INTEGER NOT NULL,catalog_hash TEXT NOT NULL,store TEXT NOT NULL,
             owner TEXT NOT NULL,source TEXT NOT NULL,operation TEXT NOT NULL,filename TEXT NOT NULL,
             mime TEXT NOT NULL,size INTEGER NOT NULL,sha TEXT NOT NULL,content_sha TEXT NOT NULL,
             created REAL NOT NULL,expires REAL NOT NULL,error TEXT,dependencies TEXT NOT NULL,
             UNIQUE(tenant,jid,invocation,operation,content_sha))''')
            if 'dependencies' not in {r[1] for r in c.execute('PRAGMA table_info(reports)')}:
                c.execute("ALTER TABLE reports ADD COLUMN dependencies TEXT NOT NULL DEFAULT '[]'")
            c.execute('''CREATE TABLE IF NOT EXISTS blocks(
             file_id TEXT NOT NULL,part INTEGER NOT NULL,nonce BLOB NOT NULL,payload BLOB NOT NULL,
             PRIMARY KEY(file_id,part))''')
            c.execute('CREATE INDEX IF NOT EXISTS reports_owner ON reports(tenant,created,id)')
            c.execute('CREATE INDEX IF NOT EXISTS reports_expiry ON reports(expires)')

    @contextmanager
    def connection(self):
        s = self.path.lstat()
        need(stat.S_ISREG(s.st_mode) and s.st_uid == os.getuid() and s.st_nlink == 1 and not s.st_mode & 0o077,
             'DEPENDENCY_UNAVAILABLE')
        c = sqlite3.connect(self.path, timeout=2); c.row_factory = sqlite3.Row
        try:
            c.execute('PRAGMA busy_timeout=2000'); c.execute('PRAGMA secure_delete=ON')
            c.execute('PRAGMA journal_size_limit=1048576')
            c.execute('BEGIN IMMEDIATE')
            yield c
            c.commit()
        except BaseException: c.rollback(); raise
        finally: c.close()

    @staticmethod
    def aad(row, part):
        return canonical_json({'metadata':{k:row[k] for k in row.keys() if k != 'error'}, 'part':part}).encode()

    def save(self, job, invocation, template, store, source, operation, raw, mime, content_sha, *, dependencies, authorize=None):
        need(type(raw) is bytes and len(raw) <= MAX_FILE, 'STORAGE_CAPACITY')
        need(type(dependencies) is list and bool(dependencies) and source in dependencies
             and all(type(x) is str and bool(x) for x in dependencies))
        now = self.repo.clock(); ident = str(uuid4()); mime, suffix = media(raw, mime)
        title = template_name(template)
        filename = re.sub(r'[\\/\x00-\x1f\x7f:"<>|?*]', '_', title[:70]) + '-' + ident[:8] + '.' + suffix
        plan = strict_json(job['plan'])
        r = {'id':ident, 'tenant':job['tenant'], 'jid':job['id'], 'invocation':invocation['id'],
             'run_id':str(uuid5(NAMESPACE_URL, canonical_json([job['tenant'],job['id'],invocation['id']]))),
             'template_id':template['id'], 'template_name':title, 'template_version':template['version'],
             'catalog_hash':plan['template_execution']['catalog_hash'], 'store':canonical_json(store),
             'owner':canonical_json(owner(plan.get('runtime_guard'))), 'source':source, 'operation':operation,
             'filename':filename, 'mime':mime, 'size':len(raw), 'sha':hashlib.sha256(raw).hexdigest(),
             'content_sha':content_sha, 'created':now, 'expires':now+TTL, 'error':None, 'dependencies':canonical_json(sorted(set(dependencies)))}
        with self.connection() as c:
            old = c.execute('SELECT id FROM reports WHERE tenant=?AND jid=?AND invocation=?AND operation=?AND content_sha=?',
                (r['tenant'],r['jid'],r['invocation'],operation,content_sha)).fetchone()
            if old:
                if authorize is not None: authorize()
                return old['id']
            used = c.execute('SELECT COALESCE(SUM(size),0) FROM reports').fetchone()[0]
            available = shutil.disk_usage(self.path.parent).free
            need(available >= DISK_RESERVE + 1048576, 'STORAGE_CAPACITY')
            if used+len(raw)>self.budget or available < DISK_RESERVE + 2*len(raw) + 1048576:
                r.update(size=0, sha=hashlib.sha256(b'').hexdigest(), error='STORAGE_CAPACITY')
            if authorize is not None: authorize()
            c.execute('INSERT INTO reports('+','.join(r)+') VALUES('+','.join('?' for _ in r)+')',tuple(r.values()))
            if not r['error']:
                cipher = AESGCM(key(self.repo))
                for part, offset in enumerate(range(0,len(raw),CHUNK)):
                    nonce = secrets.token_bytes(12)
                    c.execute('INSERT INTO blocks VALUES(?,?,?,?)', (ident,part,nonce,
                        cipher.encrypt(nonce,raw[offset:offset+CHUNK],self.aad(r,part))))
            if authorize is not None: authorize()
        return ident

    def permitted(self, row, scope, current_owner):
        stores = {s.id:asdict(s) for s in scope.stores}
        saved = strict_json(row['store']); saved_owner = strict_json(row['owner'])
        dependencies = strict_json(row['dependencies'])
        return (type(dependencies) is list and bool(dependencies) and row['source'] in dependencies
                and row['tenant']==scope.tenant and stores.get(saved['id'])==saved
                and (not saved_owner or saved_owner==current_owner)
                and all(type(source) is str and not self.repo.denied(source,saved['access_revision']) for source in dependencies))

    @staticmethod
    def metadata(row):
        return {'id':row['id'], 'run_id':row['run_id'],
                'template':{'id':row['template_id'], 'name':row['template_name'],
                            'version':row['template_version'], 'catalog_hash':row['catalog_hash']},
                'filename':row['filename'], 'media_type':row['mime'], 'bytes':row['size'],
                'sha256':row['sha'], 'created_at':row['created'], 'expires_at':row['expires'],
                'operation':row['operation'], 'error':row['error']}

    def list(self, scope, current_owner, cursor=None):
        now = self.repo.clock()
        with self.connection() as c:
            args = [scope.tenant,now]; where = ''
            if cursor is not None:
                old = c.execute('SELECT created,id FROM reports WHERE id=?AND tenant=?',(cursor,scope.tenant)).fetchone()
                need(old is not None,'NOT_FOUND'); where = 'AND(created,id)<(?,?)'; args.extend(old)
            rows = c.execute('SELECT * FROM reports WHERE tenant=?AND expires>? '+where+' ORDER BY created DESC,id DESC LIMIT 51',args).fetchall()
            return {'items':[self.metadata(r) for r in rows[:50] if self.permitted(r,scope,current_owner)],
                    'next_cursor':rows[49]['id'] if len(rows)>50 else None}

    def read(self, scope, current_owner, ident, offset):
        need(type(offset) is int and offset>=0 and offset%CHUNK==0)
        with self.connection() as c:
            row = c.execute('SELECT * FROM reports WHERE id=?AND tenant=?',(ident,scope.tenant)).fetchone()
            need(row is not None and self.permitted(row,scope,current_owner),'NOT_FOUND')
            need(row['expires']>self.repo.clock(),'RESULT_EXPIRED')
            need(not row['error'], row['error'] or 'DEPENDENCY_UNAVAILABLE')
            need(offset < row['size'] or offset == row['size'] == 0)
            block = c.execute('SELECT nonce,payload FROM blocks WHERE file_id=?AND part=?',(ident,offset//CHUNK)).fetchone()
            if row['size']:
                need(block is not None,'DEPENDENCY_UNAVAILABLE')
                try: raw = AESGCM(key(self.repo)).decrypt(block['nonce'],block['payload'],self.aad(row,offset//CHUNK))
                except Exception: raise Rejected('DEPENDENCY_UNAVAILABLE') from None
            else: raw = b''
            need(len(raw)==min(CHUNK,row['size']-offset),'DEPENDENCY_UNAVAILABLE')
            need(row['expires']>self.repo.clock(),'RESULT_EXPIRED')
            return {**self.metadata(row), 'offset':offset, 'next_offset':offset+len(raw),
                    'eof':offset+len(raw)==row['size'], 'base64':base64.b64encode(raw).decode(),
                    'chunk_sha256':hashlib.sha256(raw).hexdigest()}

    def authorize(self, scope, current_owner, ident):
        with self.connection() as c:
            row = c.execute('SELECT * FROM reports WHERE id=?AND tenant=?',(ident,scope.tenant)).fetchone()
            need(row is not None and self.permitted(row,scope,current_owner),'NOT_FOUND')
            need(row['expires']>self.repo.clock(),'RESULT_EXPIRED')
            return True

    def prune(self, batch=200):
        with self.connection() as c:
            ids = [r[0] for r in c.execute('SELECT id FROM reports WHERE expires<=? LIMIT ?', (self.repo.clock(),batch))]
            for ident in ids:
                c.execute('DELETE FROM blocks WHERE file_id=?',(ident,)); c.execute('DELETE FROM reports WHERE id=?',(ident,))
        return len(ids)


def template_operations(template_id, platform):
    from template_catalog import TEMPLATES, dependencies
    from scalar_runtime import MATRIX
    operations = set()
    for tid in dependencies(template_id):
        for step in TEMPLATES[tid]['steps']:
            if 'template' in step or step.get('platform') != platform: continue
            if 'recipe' in step: operations.update(MATRIX.operations_for({'recipe':step['recipe']}))
            else: operations.add(step['operation'])
    return operations


def dependency_sources(operations, store):
    from http_transport import MATRICES
    return sorted({store['platform']+':'+store['identity']+':'+MATRICES[op].recipe(op)['quota_operation']
                   for op in operations})


def capture(engine, row, event, request, store, value, meta):
    archive = getattr(engine,'report_archive',None)
    if archive is None or store is None or meta.get('authentication_only') or meta.get('_report_archive_original_saved') or request.source.startswith('model:'): return
    with engine.repo.connection(True) as c:
        current = dict(engine.repo._owned(c,row['id'],row['owner']))
        plan = strict_json(current['plan']) if current['plan'] else {}
        progress = strict_json(current['progress']) if current['progress'] else {}
        if plan.get('schema')!='alice-template-execution/v1' or not plan.get('selection_verified') or progress.get('_template_state')!='execute': return
        need(engine.authorized(plan),'SOURCE_ACCESS')
        if 'resolved_resource' in request.body:
            from protected_reads import record
            record(engine,row['tenant'],store['id'],request.body['params']['file_ref'],current_job=row['id'])
        fragment = plan['fragments'][progress['fragment_index']]
        calls = {v['id']:v for v in plan['selection']['invocations']}
        from template_catalog import TEMPLATES
        def authorize():
            need(engine.authorized(plan),'SOURCE_ACCESS')
            # External authority may consume the remainder of the worker lease.
            engine.repo._owned(c,row['id'],row['owner'])
        stamp = datetime.fromtimestamp(engine.repo.clock(),timezone.utc).isoformat()
        for ident in fragment['invocation_ids']:
            call = calls[ident]; template = TEMPLATES[call['template_id']]
            if call['store_id'] != store['id']: continue
            operations = template_operations(template['id'],store['platform'])
            if request.operation not in operations: continue
            sources = dependency_sources(operations,store)
            need(request.source in sources,'SOURCE_ACCESS')
            binary = meta.get(BINARY_META)
            if isinstance(value,ProtectedPayload) and not value.safe.get('protected_record'):
                raw,mime = value.raw,value.mime; digest = hashlib.sha256(raw).hexdigest()
            elif binary is not None:
                raw,mime = binary; digest = hashlib.sha256(raw).hexdigest()
            else:
                from decimal import Decimal
                data = strict_json(value.raw,parse_float=Decimal) if isinstance(value,ProtectedPayload) else value
                title = template_name(template)
                raw,mime,digest = document(data,title,request.operation,stamp,call['input'])
            archive.save(current,call,template,store,request.source,request.operation,raw,mime,digest,dependencies=sources,authorize=authorize)


def observe(engine, row, event, request, store, execute):
    """A received file is retained even if a later JSON/business decoder rejects it.

    The sink runs on the calling worker, after bounded HTTP receipt, never in the
    IO thread. It is absent for model/auth calls and always reset on exceptions.
    """
    if getattr(engine,'report_archive',None) is None or store is None or request.source.startswith('model:'):
        return execute()
    saved=[False]
    def received(raw, mime, original=True):
        if not original:
            try:
                from decimal import Decimal
                strict_json(raw,parse_float=Decimal)
            except (ValueError,Rejected): original=True; mime='text/plain'
        safe={'document_received':True} if original else {'protected_record':True}
        try:
            capture(engine,row,event,request,store,ProtectedPayload(safe,raw,mime),{'status':200})
        except Rejected as error:
            if error.code in {'CLAIM_INVALID','LEASE_LOST','JOB_LEASE_LOST','PERMISSION_DENIED','SOURCE_ACCESS','TENANT_DENIED','AUTH_REQUIRED','READ_RESOURCE_EXPIRED'}:raise
            raise ReceivedArchiveError(len(raw),error.code if error.code in {'DEPENDENCY_UNAVAILABLE','STORAGE_CAPACITY'} else 'DEPENDENCY_UNAVAILABLE') from None
        except (sqlite3.Error,OSError,RecursionError):raise ReceivedArchiveError(len(raw)) from None
        saved[0]=True
    token=DOCUMENT_SINK.set(received)
    try:
        value,meta=execute()
        return value,{**meta,'_report_archive_original_saved':True} if saved[0] else meta
    finally:DOCUMENT_SINK.reset(token)


def prune_for(repo, batch=200):
    path = Path(repo.path).with_name('market-report-archive.sqlite3')
    return Archive(repo).prune(batch) if path.exists() else 0
