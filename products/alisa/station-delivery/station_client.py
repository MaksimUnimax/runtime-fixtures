"""Optional voice delivery integration; failures keep the ordinary manual skill usable."""
import json
import socket
import re

SOCKET = '/run/alisa-station/ingress.sock'


def call(value, path=SOCKET):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
        s.settimeout(.35)
        s.connect(path)
        s.sendall(json.dumps(value, ensure_ascii=False).encode() + b'\n')
        chunks = b''
        while not chunks.endswith(b'\n'):
            part = s.recv(4096)
            if not part or len(chunks) + len(part) > 16000:
                raise ValueError('station_response')
            chunks += part
        return json.loads(chunks)


def internal_command(command):
    value = ' '.join(command.lower().replace('ё','е').strip(' .!?').split())
    value = re.sub(r'^(?:спроси|попроси|запусти|открой)(?: навык)? октопорт маркет ', '', value)
    return value == 'доставка' or value.startswith(('доставка ', 'привязать колонку'))


def retry_call(value):
    # A delivery receipt and an accepted job are idempotent. Pairing is not.
    attempts = 1 if 'привязать колонку' in value.get('command','').lower() else 2
    for attempt in range(attempts):
        try:
            answer = call(value)
            if not isinstance(answer, dict) or answer.get('error'):
                raise ValueError('station_response')
            return answer
        except (OSError, ValueError):
            if attempt + 1 == attempts:raise


def handle_turn(marketplace, account, command, rid, body_hash, conversation, mid, application, token_hash):
    """Return speech and a structured Dialogs session decision."""
    identity = dict(tenant=account, application=application, token_hash=token_hash)
    ticket = None
    try:
        before = retry_call(dict(op='before', rid=rid, conversation=conversation, message_id=mid, command=command, **identity))
        if before.get('reply'):
            return before['reply'], before.get('end_session') is True
        command = before.get('command', command)
        ticket = before.get('ticket')
    except (OSError, ValueError):
        if internal_command(command):
            return 'Не удалось получить готовый ответ. Скажите: повтори отчёт.', False
    result = marketplace.request_result(account, command, rid, body_hash,
                                         conversation_id=conversation, message_id=mid)
    try:
        after = retry_call(dict(op='after', conversation=conversation, result=result, ticket=ticket, **identity))
        return after.get('text', result['text']), after.get('end_session') is True
    except (OSError, ValueError):
        return result['text'], False


def handle(marketplace, account, command, rid, body_hash, conversation, mid, application, token_hash):
    return handle_turn(marketplace, account, command, rid, body_hash, conversation, mid, application, token_hash)[0]

