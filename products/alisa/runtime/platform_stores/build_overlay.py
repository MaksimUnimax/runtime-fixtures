"""Finite additive overlay on a validated native source, preserving its other files.

The frozen core input remains immutable. Each exact replacement is checked once;
the result has fresh complete source hashes and the normal RuntimePort versions.
"""
import hashlib
import json
from pathlib import Path
import shutil


def replace_once(text, before, after):
    if text.count(before) != 1:
        raise ValueError('NATIVE_OVERLAY_CONTEXT_MOVED')
    return text.replace(before, after)


def sources(root):
    result = {}
    text = (root / 'report_archive.py').read_text()
    text = replace_once(text, 'def observe(engine, row, event, request, store, execute):',
        'def observe(engine, row, event, request, store, execute):\n'
        '    from platform_store_credentials import execution\n'
        '    with execution(engine, row, store):\n'
        '        return _observe_document(engine, row, event, request, store, execute)\n\n\n'
        'def _observe_document(engine, row, event, request, store, execute):')
    result['report_archive.py'] = text
    text = (root / 'http_transport.py').read_text()
    scope = "    def _scope(self,request,store):\n        if store is None or store['id']!=request.store_id or store['id'] not in self.bindings:raise CallError('CREDENTIAL_SCOPE')"
    replacement = """    def _store_credentials(self,store,required=()):
        from platform_store_credentials import dynamic,resolve
        if dynamic(store):
            material=resolve(store)
            if any(name not in material for name in required):raise CallError('CREDENTIAL_UNAVAILABLE')
            return material
        return strict_json(self._credential(self.bindings[store['id']]))

    def _scope(self,request,store):
        from platform_store_credentials import dynamic
        if store is None or store['id']!=request.store_id or (not dynamic(store) and store['id'] not in self.bindings):raise CallError('CREDENTIAL_SCOPE')"""
    text = replace_once(text, scope, replacement)
    # Only callers of the old credential loader change; its legacy implementation
    # above intentionally keeps the admitted systemd file boundary unchanged.
    text = replace_once(text,
        "        credentials=strict_json(self._credential(self.bindings[store['id']]))\n        if (not isinstance(credentials.get('wb_service_token'),str)",
        "        credentials=self._store_credentials(store)\n        if (not isinstance(credentials.get('wb_service_token'),str)")
    text = replace_once(text,
        "credentials={}if private_mode=='opaque-file'else strict_json(self._credential(self.bindings[store['id']]))",
        "credentials={}if private_mode=='opaque-file'else self._store_credentials(store,meta.get('credential_headers',{}).values())")
    text = replace_once(text,
        "            credentials=strict_json(self._credential(self.bindings[store['id']]))\n            profile=SCALARS.profile_for(operation)",
        "            from platform_store_credentials import required_fields\n"
        "            credentials=self._store_credentials(store,required_fields(specification))\n"
        "            profile=SCALARS.profile_for(operation)")
    text = replace_once(text, '            self._completion_credentials(meta,store)\n            if profile is None:',
        '            from platform_store_credentials import dynamic\n'
        '            if not dynamic(store):self._completion_credentials(meta,store)\n            if profile is None:')
    result['http_transport.py'] = text
    text = (root / 'platform_authority_client.py').read_text()
    anchor = '    def publish_query_gaps(self,batch):'
    method = '''    def credentials(self,pins,store):
        scope_shape({'tenant':'credential-scope','revision':'shape','stores':[store]})
        need(str(store.get('source_revision','')).startswith('platform:'))
        data=self._call('credentials',{'pins':pins,'store':store})
        need(type(data)is dict and set(data)=={'store','credentials'} and data['store']==store)
        value=data['credentials'];need(type(value)is dict)
        if store.get('platform')=='ozon':
            seller={'seller_client_id','seller_api_key'};ads={'performance_client_id','performance_client_secret'}
            need(set(value)in (seller,seller|ads))
        else:need(store.get('platform')=='wb' and set(value)=={'seller_token'})
        for field,secret in value.items():
            minimum=1 if field.endswith('client_id') else 12
            maximum=160 if field.endswith('client_id') else 8192
            need(type(secret)is str and minimum<=len(secret)<=maximum
                 and secret.isascii() and all(32<ord(c)<127 for c in secret))
        return value

'''
    result['platform_authority_client.py'] = replace_once(text, anchor, method + anchor)
    result['platform_store_credentials.py'] = Path(__file__).with_name('platform_store_credentials.py').read_text()
    for name, text in result.items():
        compile(text, name, 'exec')
    return result


def build(source, destination):
    source, destination = Path(source).resolve(), Path(destination)
    if destination.exists():
        raise ValueError('OVERLAY_DESTINATION_EXISTS')
    manifest = json.loads((source / 'CURRENT_CORE_MANIFEST.json').read_text())
    covered = set(manifest['files'])
    runtime_files = {p.name for p in source.glob('*.py')}
    runtime_files.update(str(p.relative_to(source)) for p in (source / 'read_surface_data').rglob('*')
                         if p.is_file() and '__pycache__' not in p.parts)
    if not runtime_files <= covered:
        raise ValueError('NATIVE_BASE_COVERAGE')
    for name, digest in manifest['files'].items():
        path = source / name
        if (Path(name).is_absolute() or '..' in Path(name).parts or
                any(p.is_symlink() for p in [path, *path.parents] if p != source and p.is_relative_to(source)) or
                not path.resolve().is_relative_to(source) or hashlib.sha256(path.read_bytes()).hexdigest() != digest):
            raise ValueError('NATIVE_BASE_HASH')
    changed = sources(source)
    destination.mkdir()
    try:
        for name in covered:
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source / name, target)
        for name, text in changed.items():
            (destination / name).write_text(text)
            manifest['files'][name] = hashlib.sha256(text.encode()).hexdigest()
        manifest['platform_store_overlay'] = 'platform-store-v1'
        (destination / 'CURRENT_CORE_MANIFEST.json').write_text(json.dumps(manifest, indent=2) + '\n')
        return destination
    except BaseException:
        shutil.rmtree(destination)
        raise
