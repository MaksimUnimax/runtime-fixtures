import uuid


def identifier(value):
    if not isinstance(value, str):
        raise ValueError()
    return uuid.UUID(value)


def label(value, empty=False):
    if (not isinstance(value, str) or len(value.strip()) > 80
            or (not empty and not value.strip()) or any(ord(c) < 32 for c in value)):
        raise ValueError()
    return value.strip()


def credential(kind, value):
    fields = {'SELLER': {'client_id', 'api_key'}, 'PERFORMANCE': {'client_id', 'client_secret'}, 'WB': {'token'}}
    if kind not in fields or not isinstance(value, dict) or set(value) != fields[kind]:
        raise ValueError()
    for key, text in value.items():
        minimum = 1 if key == 'client_id' else 12
        if (not isinstance(text, str) or not minimum <= len(text) <= (160 if key == 'client_id' else 8192)
                or not text.isascii() or any(ord(c) <= 32 or ord(c) >= 127 for c in text)):
            raise ValueError()
    if kind == 'SELLER' and not value['client_id'].isdigit():
        raise ValueError()
    return value


def validate(data):
    if not isinstance(data, dict) or not isinstance(data.get('action'), str):
        raise ValueError()
    action = data['action']
    if action == 'command_status':
        if set(data) != {'action', 'command_id'}:
            raise ValueError()
        identifier(data['command_id'])
        return data
    if action == 'list':
        if set(data)-{'action', 'cursor'} or not isinstance(data.get('cursor', ''), str) or len(data.get('cursor', '')) > 1024:
            raise ValueError()
        return data
    required = {
        'create': {'provider', 'name', 'voice_alias', 'credential'},
        'rename': {'store_id', 'expected_revision', 'name', 'voice_alias'},
        'credential': {'store_id', 'expected_revision', 'kind', 'credential'},
        'revoke_credential': {'store_id', 'expected_revision', 'kind'},
        'check': {'store_id', 'expected_revision', 'credential_id'},
        'disable': {'store_id', 'expected_revision'},
        'enable': {'store_id', 'expected_revision'},
        'delete': {'store_id', 'expected_revision'},
    }
    if action not in required or set(data) != {'action', 'command_id'} | required[action]:
        raise ValueError()
    identifier(data['command_id'])
    if action != 'create':
        identifier(data['store_id'])
        if type(data['expected_revision']) is not int or not 1 <= data['expected_revision'] < 2**31:
            raise ValueError()
    if action in {'create', 'rename'}:
        label(data['name']); label(data['voice_alias'], True)
    if action == 'create':
        if data['provider'] not in {'OZON', 'WB'}:
            raise ValueError()
        credential('SELLER' if data['provider'] == 'OZON' else 'WB', data['credential'])
    if action == 'credential':
        credential(data['kind'], data['credential'])
    if action == 'revoke_credential' and data['kind'] not in {'SELLER', 'PERFORMANCE', 'WB'}:
        raise ValueError()
    if action == 'check':
        identifier(data['credential_id'])
    return data
