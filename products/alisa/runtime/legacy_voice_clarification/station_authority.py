"""Private read-only admission from existing Station receipts and legacy OAuth."""
import hashlib
import json
import socket
import socketserver
import struct
from copy import deepcopy
from types import SimpleNamespace

SCHEMA = 'station-clarification-authority/v1'
FIELDS = {'schema', 'tenant', 'owner', 'application', 'conversation', 'ticket'}


def binding_id(delivery):
    state = delivery.state
    value = [state['owner'], state['binding'], state['selected'], state['trigger'],
             state.get('voice_binding_revision', 0)]
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def remember(delivery, turn, data):
    turn['voice_auth'] = {'token_hash': data['token_hash'], 'binding': binding_id(delivery)}


def refresh(delivery, data):
    # A fresh, already validated legacy token of the same saved binding may
    # replace an expired one. This never creates a token or extends a receipt.
    current = binding_id(delivery)
    changed = False
    for turn in delivery.state.get('turn_receipts', {}).values():
        auth = turn.get('voice_auth', {})
        if auth.get('binding') == current:
            changed = changed or auth['token_hash'] != data['token_hash']
            auth['token_hash'] = data['token_hash']
    return changed


def snapshot(delivery):
    fields = ('owner', 'binding', 'selected', 'trigger', 'voice_binding_revision', 'turn_receipts')
    return deepcopy({k: delivery.state[k] for k in fields if k in delivery.state})


def before_save(delivery):
    if getattr(delivery, 'voice_authority_view', None) != snapshot(delivery):
        delivery.voice_authority_view = None


def invalidate(delivery):
    delivery.voice_authority_view = None


def publish(delivery):
    """Publish one immutable view while the normal Station save holds its lock.

    Native status is called while Station ingress holds its ordinary locks.
    The reverse authority RPC must never acquire those locks. It reads this
    atomically replaced view and rejects a concurrent replacement instead.
    """
    value = snapshot(delivery)
    if getattr(delivery, 'voice_authority_view', None) != value:
        delivery.voice_authority_view = value


def claims(delivery, turn):
    binding = delivery.state['binding']
    return {'schema': SCHEMA, 'tenant': binding['tenant'], 'owner': delivery.state['owner'],
            'application': binding['application'], 'conversation': turn['conversation'],
            'ticket': turn['ticket']}


def usable(delivery, turn):
    auth = turn.get('voice_auth', {})
    return (delivery.state.get('binding') is not None
            and auth.get('binding') == binding_id(delivery)
            and turn.get('at', 0) + 3600 > delivery.clock()
            and delivery.auth(delivery.state['binding']['tenant'], auth.get('token_hash', '')))


def authorize(registry, value):
    if type(value) is not dict:
        raise ValueError('authority_schema')
    deliveries = tuple(registry.users.values())
    snapshots = [(d, d.voice_authority_view) for d in deliveries]

    def invalid_relevant():
        # Mutable state is used only to deny, never to authorize. A failed save
        # for a different owner must not disable all other Station accounts.
        for delivery, view in snapshots:
            if view is not None:
                continue
            state = delivery.state; binding = state.get('binding') or {}
            if value.get('op') == 'admit':
                if binding.get('tenant') == value.get('tenant') or value.get('rid') in state.get('turn_receipts', {}):
                    raise ValueError('authority_changed')
            elif value.get('op') == 'current' and type(value.get('guard')) is dict:
                guard = value['guard']
                if (state.get('owner') == guard.get('owner')
                        or binding.get('tenant') == guard.get('tenant') and binding.get('application') == guard.get('application')):
                    raise ValueError('authority_changed')

    invalid_relevant()
    views = [(d, SimpleNamespace(state=view, auth=d.auth, clock=d.clock))
             for d, view in snapshots if view is not None]

    def stable(result):
        invalid_relevant()
        if (tuple(registry.users.values()) != deliveries
                or any(d.voice_authority_view is not view for d, view in snapshots)):
            raise ValueError('authority_changed')
        return result

    if value.get('op') == 'admit' and set(value) == {'op', 'tenant', 'conversation', 'rid'}:
        if not all(type(value[k]) is str and 1 <= len(value[k]) <= 128 for k in ('tenant', 'conversation', 'rid')):
            raise ValueError('authority_schema')
        found = []
        for _, delivery in views:
            turn = delivery.state.get('turn_receipts', {}).get(value['rid'])
            if (turn and turn.get('conversation') == value['conversation']
                    and (delivery.state.get('binding') or {}).get('tenant') == value['tenant']
                    and usable(delivery, turn)):
                found.append(claims(delivery, turn))
        return stable({'guard': found[0] if len(found) == 1 else None})
    if value.get('op') == 'current' and set(value) == {'op', 'guard'}:
        guard = value['guard']
        if type(guard) is not dict or set(guard) != FIELDS or guard['schema'] != SCHEMA:
            raise ValueError('authority_schema')
        bindings = [d for _, d in views
                    if (d.state.get('binding') or {}).get('tenant') == guard['tenant']
                    and (d.state.get('binding') or {}).get('application') == guard['application']]
        if len(bindings) != 1:
            return stable({'allowed': False})
        found = 0
        for _, delivery in views:
            if not delivery.state.get('binding'):
                continue
            for turn in delivery.state.get('turn_receipts', {}).values():
                if turn.get('ticket') == guard['ticket'] and claims(delivery, turn) == guard and usable(delivery, turn):
                    found += 1
        return stable({'allowed': found == 1})
    raise ValueError('authority_schema')


class Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        try:
            self.request.settimeout(.5)
            uid = struct.unpack('3i', self.request.getsockopt(socket.SOL_SOCKET,
                               socket.SO_PEERCRED, 12))[1]
            if uid != self.server.allowed_uid:
                raise ValueError('authority_peer')
            raw = self.rfile.readline(4001)
            if len(raw) > 4000 or not raw.endswith(b'\n'):
                raise ValueError('authority_size')
            result = authorize(self.server.registry, json.loads(raw))
        except Exception:
            result = {'error': 'authority_unavailable'}
        try:
            self.wfile.write(json.dumps(result).encode() + b'\n')
        except OSError:
            pass
