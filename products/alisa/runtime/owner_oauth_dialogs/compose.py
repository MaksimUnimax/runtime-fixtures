"""Exact pinned read-only composition from the already accepted installations.

No services, databases, credentials, tenants or configuration are changed here.
The correct owner-aware OAuth backend already exists: this is just the minimal
compatibility layer for the old configured Yandex Dialogs URLs and Station.
"""
from pathlib import Path
import hashlib

STATION='26efc00fdae78ae37005da2f817665a09b9f97b8fade11b108368ab2f9bf338f'
CLIENT='46869ad571a7e6a24a41f9890d25f6742938dfb8c4775394a22d6f0384ea4f0c'
LAB='b33686666b30a1fa40b67a4ba1a39124ed514c6c309468efb3fa1825d9e66efd'
NGINX='32a3caaa78fc990bcc1b664c7dd2a3b59e1246cd4c6746e05bf2feb4469bc71e'
ROOT=Path(__file__).resolve().parent


def pinned(path,digest):
    raw=Path(path).read_bytes()
    if hashlib.sha256(raw).hexdigest()!=digest:raise ValueError('OAUTH_BASE_CHANGED')
    return raw.decode('utf-8')


def one(text,source,target):
    if text.count(source)!=1:raise ValueError('OAUTH_SOURCE_CONTEXT_MOVED')
    return text.replace(source,target)


def station_sources(root):
    src=pinned(Path(root)/'service.py',STATION)
    src=one(src,"    def ingress(self, data):\n        with self.lock:\n            if not isinstance(data, dict)",
            "    def ingress(self, data, oauth_identity=None):\n        with self.lock:\n            if not isinstance(data, dict)")
    old="if not self.auth(data['tenant'], data['token_hash']): raise Fault('voice_revoked')"
    new="""if oauth_identity is None:
                if not self.auth(data['tenant'],data['token_hash']):raise Fault('voice_revoked')
            elif (oauth_identity.get('native_tenant')!=data['tenant'] or
                  oauth_identity.get('owner')!=self.state.get('owner') or
                  not self.state.get('binding') or
                  self.state['binding'].get('tenant')!=data['tenant']):
                raise Fault('voice_revoked')"""
    src=one(src,old,new)
    old="    def ingress(self, data):\n        with self.lock:\n            for d in self.users.values():"
    new="""    def ingress(self, data):
        # Resolve the modern OAuth identity BEFORE holding the registry lock.
        # The platform's own write path may call back into Station during an
        # owner transaction; taking that lock while awaiting platform would
        # deadlock. No token bytes are retained in station state or receipts.
        if not isinstance(data,dict):raise Fault('ingress_schema')
        modern=None
        if data.get('op')=='oauth_identity':
            from station_oauth import owner as verified_owner
            modern=verified_owner(data.get('access_token'))
            with self.lock:
                bound=[d for d in self.users.values()
                       if d.state.get('binding') and d.state.get('owner')==modern['owner']
                       and d.state['binding'].get('tenant')==modern['native_tenant']]
                if len(bound)!=1:raise Fault('voice_revoked')
                return {'native_tenant':modern['native_tenant']}
        if data.get('op') in ('before','after') and 'oauth_token' in data:
            from station_oauth import owner as verified_owner
            token=data['oauth_token']
            modern=verified_owner(token)
            if (not isinstance(data.get('token_hash'),str) or
                hashlib.sha256(token.encode()).hexdigest()!=data['token_hash'] or
                data.get('tenant')!=modern['native_tenant']):raise Fault('voice_revoked')
            data={k:v for k,v in data.items() if k!='oauth_token'}
        with self.lock:
            for d in self.users.values():"""
    src=one(src,old,new)
    old="return bound[0].ingress(data)"
    if src.count(old)!=2:raise ValueError('OAUTH_BOUND_STATION_CONTEXT')
    src=src.replace(old,"return bound[0].ingress(data, oauth_identity=modern) if modern is not None else bound[0].ingress(data)")
    # Mark only bearer turns already verified by the modern platform. The
    # raw token is NOT serialized; all later claims re-check access_hash with
    # the current platform user/link/revision instead of the empty legacy DB.
    before="""                if match and ticket:
                    from station_parameters import before as parameter_before
                    answer=parameter_before(self,data,command,ticket)"""
    after="""                if match and ticket and oauth_identity is not None:
                    turn=self.state['turn_receipts'].get(data['rid'])
                    if turn is not None and turn.get('voice_auth',{}).get('binding'):
                        turn['voice_auth']['scheme']='modern'
                        self.save()
                if match and ticket:
                    from station_parameters import before as parameter_before
                    answer=parameter_before(self,data,command,ticket)"""
    src=one(src,before,after)
    # A new access token can update the current same-binding turns. This
    # remains subject to the verified native owner/tenant mapping above.
    before="""            if match and self.state['job']:
                self.state['job']['token_hash'] = data['token_hash']; self.save()"""
    after="""            if match and oauth_identity is not None:
                from station_authority import binding_id
                for entry in self.state.get('turn_receipts',{}).values():
                    auth=entry.get('voice_auth',{})
                    if auth.get('binding')==binding_id(self):
                        auth['scheme']='modern'
                self.save()
            if match and self.state['job']:
                self.state['job']['token_hash'] = data['token_hash']; self.save()"""
    src=one(src,before,after)
    compile(src,'service.py','exec')
    client=pinned(Path(root)/'station_client.py',CLIENT)
    client=one(client,'def call(value, path=SOCKET):','def call(value, path=SOCKET, timeout=.35):')
    client=one(client,'s.settimeout(.35)','s.settimeout(timeout)')
    client=one(client,"attempts = 1 if internal and internal.startswith('привязать колонку') else 2","attempts = 1 if value.get('oauth_token') or internal and internal.startswith('привязать колонку') else 2")
    client=one(client,'answer = call(value)', "answer = call(value,timeout=4.5) if value.get('oauth_token') else call(value)")
    client=one(client,'def handle_turn(marketplace, account, command, rid, body_hash, conversation, mid, application, token_hash):','def handle_turn(marketplace, account, command, rid, body_hash, conversation, mid, application, token_hash, oauth_token=None):')
    client=one(client,'identity = dict(tenant=account, application=application, token_hash=token_hash)',"identity = dict(tenant=account, application=application, token_hash=token_hash)\n    if oauth_token is not None:\n        if not isinstance(oauth_token,str) or not oauth_token.startswith('as6_'):\n            raise StationUnavailable('voice_revoked')\n        identity['oauth_token']=oauth_token")
    compile(client,'station_client.py','exec')
    authority=pinned(Path(root)/'station_authority.py',
                     '1b9133d87becdd008aab26a70e45074a7f4b3701c9b36c1121db571293c118de')
    before="""            and delivery.auth(delivery.state['binding']['tenant'], auth.get('token_hash', '')))"""
    after="""            and (delivery.auth(delivery.state['binding']['tenant'], auth.get('token_hash', ''))
                 if auth.get('scheme') is None else
                 (auth.get('scheme')=='modern' and
                  __import__('station_oauth').current(delivery.state['owner'],
                    delivery.state['binding']['tenant'], auth.get('token_hash','')))))"""
    authority=one(authority,before,after)
    compile(authority,'station_authority.py','exec')
    return {'service.py':src, 'station_client.py':client,
            'station_oauth.py':(ROOT/'station_oauth.py').read_text(),
            'station_authority.py':authority}


def lab_sources(root):
    text=pinned(Path(root)/'alice_lab.py',LAB)
    text=one(text,'    account=auth_token(token)\n',"    if isinstance(token,str) and token.startswith('as6_'):\n        from lab_oauth import account as owner_account\n        account=owner_account(token)\n    else:\n        account=auth_token(token)\n")
    text=one(text,'hp((s.get("application") or {}).get("application_id") or "missing:"+sid),digest(token))','hp((s.get("application") or {}).get("application_id") or "missing:"+sid),digest(token),token if isinstance(token,str) and token.startswith("as6_") else None)')
    compile(text,'alice_lab.py','exec')
    return {'alice_lab.py':text,'lab_oauth.py':(ROOT/'lab_oauth.py').read_text()}


def nginx_source(path):
    text=pinned(path,NGINX)
    # Exact locations win before the old regex. Keep the old block as a
    # fail-closed historical fallback for any old syntax and preserve its
    # rate limiting. Redirect users to the existing owner-authenticated web
    # consent; proxy token exchanges to the existing OAuthlib implementation.
    anchor='    location ~ ^/oauth/(authorize|token|refresh)$ {'
    new="""    location = /oauth/authorize {
        access_log /var/log/nginx/alice-lab-oauth-safe.log alice_oauth_safe;
        limit_req zone=alice_lab_ip burst=15 nodelay;
        limit_req_status 429;
        if ($request_method != GET) { return 405; }
        return 302 https://alisa.octoport.ru/alice/oauth/authorize$is_args$args;
    }
    location = /oauth/token {
        access_log /var/log/nginx/alice-lab-oauth-safe.log alice_oauth_safe;
        limit_req zone=alice_lab_ip burst=15 nodelay;
        limit_req_status 429;
        limit_except POST { deny all; }
        proxy_pass http://127.0.0.1:18100/alice/oauth/token;
        proxy_set_header Host alisa.octoport.ru;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Authorization $http_authorization;
        proxy_connect_timeout 1s;
        proxy_read_timeout 4s;
        proxy_send_timeout 4s;
        proxy_buffering off;
    }
    location = /oauth/refresh {
        access_log /var/log/nginx/alice-lab-oauth-safe.log alice_oauth_safe;
        limit_req zone=alice_lab_ip burst=15 nodelay;
        limit_req_status 429;
        limit_except POST { deny all; }
        proxy_pass http://127.0.0.1:18100/alice/oauth/refresh;
        proxy_set_header Host alisa.octoport.ru;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Authorization $http_authorization;
        proxy_connect_timeout 1s;
        proxy_read_timeout 4s;
        proxy_send_timeout 4s;
        proxy_buffering off;
    }
"""
    return one(text,anchor,new+anchor)
