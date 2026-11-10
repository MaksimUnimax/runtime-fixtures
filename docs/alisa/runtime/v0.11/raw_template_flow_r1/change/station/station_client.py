"""Optional voice delivery integration; failures keep the ordinary manual skill usable."""
import json
import socket
from voice_protocol import internal_voice_command

SOCKET = '/run/alisa-station/ingress.sock'

class StationUnavailable(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


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
    return internal_voice_command(command) is not None


def retry_call(value):
    # A delivery receipt and an accepted job are idempotent. Pairing is not.
    internal=internal_voice_command(value.get('command',''))
    attempts = 1 if internal and internal.startswith('привязать колонку') else 2
    for attempt in range(attempts):
        try:
            answer = call(value)
            if not isinstance(answer, dict):
                raise ValueError('station_response')
            if answer.get('error'):
                raise StationUnavailable(answer['error'])
            return answer
        except (OSError, ValueError) as error:
            if getattr(error,'code',None)=='voice_revoked' or attempt + 1 == attempts:raise


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
            return 'Автоматический ответ сейчас недоступен. Попробуйте ещё раз.', True
        return 'Автоматическая выдача ответа сейчас недоступна. Запрос не запущен.', True
    result = marketplace.request_result(account, command, rid, body_hash,
                                         conversation_id=conversation, message_id=mid)
    try:
        after = retry_call(dict(op='after', conversation=conversation, result=result, ticket=ticket, **identity))
        return after.get('text', result['text']), after.get('end_session') is True
    except (OSError, ValueError):
        return 'Запрос принят, но не удалось подключить автоматическую выдачу ответа.', True


def handle(marketplace, account, command, rid, body_hash, conversation, mid, application, token_hash):
    return handle_turn(marketplace, account, command, rid, body_hash, conversation, mid, application, token_hash)[0]

