#!/usr/bin/env python3
"""Owner Station delivery: authenticated admin + private voice ingress + bounded poller."""
import argparse, contextlib, hashlib, hmac, http.cookiejar, json, os, re, secrets, socket, socketserver
import sqlite3, struct, threading, time, urllib.request, urllib.error
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from transport import Yandex, Fault, payload
from eta import baseline, pending, observe, label

BASE = '/admin/station/'
ORIGIN = 'https://alisa-admin.octoport.ru'
SITE_BASE = '/app/station/'
SITE_ORIGIN = 'https://alisa.octoport.ru'
DEFAULTS = {'enabled': True, 'interval_seconds': 10,
            'pending_messages': ['Расчёт ещё выполняется. Ориентировочно осталось {remaining}.'],
            'manual_command': 'результат'}
RESERVED = {'помощь', 'что ты умеешь', 'что умеет навык', 'дальше', 'отмена', 'выход',
            'отмени отчет', 'статус отчета', 'план запроса', 'привязать колонку',
            'проверка связи','короткий тест','состояние','диагностика','проверка авторизации',
            'длинный тест','проверь отчет','прочитай отчет','повтори отчет','другой вопрос',
            'проверка нейросети','результат дипсика'}


def normalize(value):
    return ' '.join(value.lower().replace('ё', 'е').strip(' .!?').split())


def internal_voice_command(value):
    if not isinstance(value, str): return None
    command = normalize(value)
    matched = re.fullmatch(r'(?:спроси|попроси|запусти|открой)(?: навык)? октопорт маркет (доставка(?: .*)?|привязать колонку(?: .*)?)', command)
    if matched: command = matched.group(1)
    if command == 'доставка' or command.startswith('доставка '): return command
    if command == 'привязать колонку' or command.startswith('привязать колонку '): return command
    return None


def validate_settings(value):
    if not isinstance(value, dict) or set(value) != set(DEFAULTS):
        raise Fault('settings_schema')
    if type(value['enabled']) is not bool or type(value['interval_seconds']) is not int or not 10 <= value['interval_seconds'] <= 300:
        raise Fault('interval_10_300')
    messages = value['pending_messages']
    if not isinstance(messages, list) or not 1 <= len(messages) <= 6 or not all(isinstance(x, str) and 1 <= len(x.strip()) <= 200 and not any(ord(c) < 32 for c in x) for x in messages):
        raise Fault('messages_1_6_max_200')
    command = value['manual_command']
    if not isinstance(command, str) or not re.fullmatch(r'[А-Яа-яЁё -]{2,60}', command):
        raise Fault('manual_command_words')
    command = normalize(command)
    if not re.search(r'[а-я]', command): raise Fault('manual_command_words')
    if command in RESERVED or command.startswith(('привязать колонку', 'доставка ', 'тест дипсика ', 'тест нейросети ')):
        raise Fault('manual_command_reserved')
    return dict(value, pending_messages=[x.strip() for x in messages], manual_command=command)


def atomic(path, raw):
    temp = path.with_suffix('.new')
    with temp.open('wb') as f:
        os.fchmod(f.fileno(), 0o600)
        f.write(raw); f.flush(); os.fsync(f.fileno())
    os.replace(temp, path)
    fd = os.open(path.parent, os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)


def gateway(value, path='/run/alice-market/gateway.sock'):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
        s.settimeout(.3); s.connect(path)
        s.sendall(json.dumps(value).encode() + b'\n')
        data = b''
        while not data.endswith(b'\n'):
            part = s.recv(4096)
            if not part or len(data) + len(part) > 16000: raise Fault('runtime_response')
            data += part
        return json.loads(data)


def token_active(tenant, token_hash):
    try:
        with contextlib.closing(sqlite3.connect('file:/var/lib/alice-lab/lab.sqlite3?mode=ro', uri=True, timeout=.15)) as c:
            return bool(c.execute("SELECT 1 FROM tokens WHERE hash=? AND account=? AND kind='access' AND revoked=0 AND expires>?", (token_hash, tenant, time.time())).fetchone())
    except sqlite3.Error:
        return False


def token_refresh_possible(tenant):
    try:
        with contextlib.closing(sqlite3.connect('file:/var/lib/alice-lab/lab.sqlite3?mode=ro', uri=True, timeout=.15)) as c:
            return bool(c.execute("SELECT 1 FROM tokens WHERE account=? AND kind='refresh' AND revoked=0 AND expires>? LIMIT 1", (tenant, time.time())).fetchone())
    except sqlite3.Error:
        return False


class Delivery:
    def __init__(self, directory, cipher, client=None, clock=time.time, auth=token_active, peek=gateway):
        self.directory = Path(directory); self.cipher = cipher
        self.clock, self.auth, self.peek = clock, auth, peek
        self.lock, self.transport_lock = threading.RLock(), threading.Lock()
        self.policy_enabled=lambda: True
        self.policy_guard=threading.RLock()
        self.client = client or Yandex(); self.devices = []; self.qr = None; self.qr_until = 0
        self.last_poll = 0; self.pair_hash = ''; self.pair_until = 0; self.pair_tries = 0
        self.state = {'settings': dict(DEFAULTS), 'revision': 1, 'owner': None, 'selected': None,
                      'scenario': None, 'binding': None, 'job': None, 'connected': False,
                      'uncertain': False, 'generation': 0, 'last_delivery': None, 'trigger': secrets.token_hex(12), 'eta_history': []}
        path = self.directory / 'state.json'
        if path.exists():
            self.state = json.loads(path.read_text())
            self.state.setdefault('eta_history', [])
            validate_settings(self.state['settings'])
            if self.state.get('connected'):
                try:
                    jar = json.loads(cipher.decrypt((self.directory / 'session.enc').read_bytes()))
                    for cookie in jar: self.client.jar.set_cookie(http.cookiejar.Cookie(**cookie))
                except Exception:
                    self.state['connected'] = False; self.state['uncertain'] = True
            job = self.state.get('job')
            if job and job['delivery'] == 'sending':
                job['delivery'] = 'unknown'; self.state['uncertain'] = True
        self.save()

    def save(self):
        atomic(self.directory / 'state.json', json.dumps(self.state, ensure_ascii=False).encode())

    def save_session(self):
        rows = []
        for c in self.client.jar:
            rows.append({k: getattr(c, k) for k in ('version', 'name', 'value', 'port', 'port_specified',
                'domain', 'domain_specified', 'domain_initial_dot', 'path', 'path_specified',
                'secure', 'expires', 'discard', 'comment', 'comment_url', 'rfc2109')})
            rows[-1]['rest'] = c._rest
        atomic(self.directory / 'session.enc', self.cipher.encrypt(json.dumps(rows).encode()))

    def view(self):
        with self.lock:
            s = self.state
            job = s['job']
            return {'settings': s['settings'], 'revision': s['revision'], 'connected': s['connected'],
                    'selected': s['selected'], 'devices': self.devices, 'paired': bool(s['binding']),
                    'uncertain': s['uncertain'], 'last_delivery': s['last_delivery'],
                    'job_state': job['delivery'] if job else None,
                    'transport': 'Quasar → навык Октопорт маркет', 'pair_pending': self.clock() < self.pair_until}

    def configure(self, data):
        setting = validate_settings(data.get('settings'))
        with self.lock:
            if type(data.get('revision')) is not int or data['revision'] != self.state['revision']:
                raise Fault('settings_changed_reload')
            self.state['settings'] = setting; self.state['revision'] += 1
            # A disabled task never unexpectedly resumes when the switch is enabled later.
            if self.state['job'] and (not setting['enabled'] or self.state['job']['delivery'] == 'sending'):
                self.state['job']['delivery'] = 'manual'
            self.state['generation'] += 1
            self.save()
        return self.view()

    def disconnect(self):
        with self.lock:
            self.state.update(connected=False, binding=None, selected=None, scenario=None, job=None,
                              uncertain=False, generation=self.state['generation']+1)
            self.pair_until = 0; self.qr = None; self.devices = []
            self.save()
            (self.directory / 'session.enc').unlink(missing_ok=True)
        # In-flight network work cannot be recalled; its generation cannot send another action.
        with self.transport_lock: self.client = Yandex()
        return self.view()

    def admin(self, kind, data, owner):
        with self.lock:
            if self.state['owner'] not in (None, owner): raise Fault('connection_other_owner')
            self.state['owner'] = owner
        if kind == 'status': return self.view()
        if kind == 'settings': return self.configure(data)
        if kind == 'disconnect': return self.disconnect()
        if kind == 'qr':
            with self.transport_lock:
                if self.state['connected']: raise Fault('already_connected')
                if self.qr and self.clock() < self.qr_until: return {'link': self.qr}
                generation = self.state['generation']; client = Yandex(); self.client = client
                link = client.start_qr()
                with self.lock:
                    if generation != self.state['generation']: raise Fault('delivery_cancelled')
                    self.qr = link; self.qr_until = self.clock()+240
                return {'link': self.qr}
        if kind == 'poll':
            with self.transport_lock:
                if self.state['connected']: return self.view()
                if not self.qr or self.clock() >= self.qr_until: raise Fault('qr_expired')
                if self.clock()-self.last_poll < 2: return self.view()
                self.last_poll = self.clock()
                generation = self.state['generation']
                if self.client.poll_qr():
                    with self.lock:
                        if generation != self.state['generation']: raise Fault('delivery_cancelled')
                        self.save_session(); self.state['connected'] = True; self.save(); self.qr = None
            return self.view()
        if not self.state['connected']: raise Fault('connect_first')
        if kind == 'devices':
            with self.transport_lock:
                generation = self.state['generation']; devices = self.client.devices()
                with self.lock:
                    if generation != self.state['generation']: raise Fault('delivery_cancelled')
                    self.devices = devices
            return self.view()
        if kind == 'select':
            with self.lock:
                if self.state['selected']: raise Fault('disconnect_before_reselect')
                if data.get('device') not in {d['id'] for d in self.devices}: raise Fault('invalid_device')
                self.state['selected'] = next(d for d in self.devices if d['id']==data['device'])
                self.save()
            return self.view()
        if kind == 'pair':
            if self.state['binding']: raise Fault('already_paired')
            code = ''.join(str(secrets.randbelow(10)) for _ in range(24))
            with self.lock:
                self.pair_hash = hashlib.sha256(code.encode()).hexdigest()
                self.pair_until = self.clock()+180; self.pair_tries = 0
                generation = self.state['generation']
            self.speak('Спроси Октопорт маркет привязать колонку '+code, generation, mode='skill')
            return self.view()
        raise Fault('unknown_action')

    def speak(self, text, generation, guard=None, mode="text"):
        with self.transport_lock:
            launch_attempted = False
            with self.lock:
                if generation != self.state['generation'] or not self.state['connected'] or not self.state['selected']:
                    raise Fault('delivery_cancelled')
                if self.state['uncertain']: raise Fault('delivery_unknown_reconnect')
                selected, sid = self.state['selected']['id'], self.state['scenario']
                name = 'Октопорт автоответ'; trigger = 'октопорт техническая доставка '+self.state['trigger']
                # Mark uncertain before every external mutation, persisted across a crash.
                self.state['uncertain'] = True; self.save()
            try:
                body = payload(name, trigger, selected, text, mode)
                if sid:
                    self.client.api('PUT', '/m/v4/user/scenarios/'+sid, body)
                else:
                    answer = self.client.api('POST', '/m/v4/user/scenarios', body)
                    sid = answer.get('scenario_id')
                    if not isinstance(sid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', sid):
                        raise Fault('scenario_id_missing')
                    with self.lock:
                        if generation != self.state['generation']: raise Fault('delivery_cancelled')
                        self.state['scenario'] = sid; self.save()
                with self.lock:
                    if generation != self.state['generation']: raise Fault('delivery_cancelled')
                    if guard is not None and not guard(): raise Fault('delivery_cancelled')
                if guard is not None:
                    with self.policy_guard:
                        if not self.policy_enabled() or generation != self.state['generation'] or not guard():
                            raise Fault('delivery_cancelled')
                        launch_attempted = True
                        self.client.api('POST', '/m/user/scenarios/'+sid+'/actions')
                else:
                    launch_attempted = True
                    self.client.api('POST', '/m/user/scenarios/'+sid+'/actions')
                with self.lock:
                    if generation == self.state['generation']:
                        self.state['uncertain'] = False
                        self.state['last_delivery'] = {'state': 'accepted_not_heard', 'at': self.clock()}
                        self.save_session(); self.save()
            except Exception as exc:
                with self.lock:
                    cancelled_before_launch = isinstance(exc, Fault) and exc.code == 'delivery_cancelled' and not launch_attempted
                    if cancelled_before_launch:
                        self.state['uncertain'] = False
                    self.state['last_delivery'] = {'state': 'cancelled_before_launch' if cancelled_before_launch else 'unknown_no_retry', 'at': self.clock()}; self.save()
                raise

    def status_job(self, job):
        active = self.auth(job['tenant'], job['token_hash'])
        if not active and not token_refresh_possible(job['tenant']): return {'state': 'REVOKED', 'text': ''}
        result = self.peek({'op':'station_status','tenant':job['tenant'], 'conversation_id':job['conversation'], 'job_id':job['jid']})
        # Expired access tokens may be refreshed by Yandex when the skill wakes.
        # Until that callback presents a fresh token, only the state is exposed.
        return result if active else {'state': result.get('state', 'REVOKED'), 'text': ''}

    def ingress(self, data):
        with self.lock:
            if not isinstance(data, dict) or data.get('op') not in ('before', 'after'):
                raise Fault('ingress_schema')
            for key in ('tenant', 'application', 'token_hash'):
                if not isinstance(data.get(key), str) or not re.fullmatch(r'[A-Za-z0-9_:-]{1,128}', data[key]):
                    raise Fault('ingress_identity')
            if not self.auth(data['tenant'], data['token_hash']): raise Fault('voice_revoked')
            settings = self.state['settings']; command = data.get('command', '')
            binding = self.state['binding']
            match = bool(binding and all(data[k] == binding[k] for k in ('tenant', 'application')))
            if match and self.state['job']:
                self.state['job']['token_hash'] = data['token_hash']; self.save()
            if data['op'] == 'before':
                if not isinstance(command, str) or len(command) > 1000: raise Fault('command_schema')
                command = internal_voice_command(command) or command
                if command == 'доставка' or command.startswith('доставка '):
                    job = self.state['job']
                    code = ''.join(re.findall(r'\d', command[9:]))
                    if not match or not job or not settings['enabled'] or job.get('nonce_until', 0) < self.clock() or job.get('nonce_generation') != self.state['generation'] or not hmac.compare_digest(job.get('nonce', '-'), code):
                        return {'reply': 'Этот автоматический ответ больше недоступен.'}
                    if job.get('callback_rid') not in (None, data.get('rid')) or not data.get('rid'):
                        return {'reply': 'Этот автоматический ответ уже передан.'}
                    result = self.status_job(job)
                    if result.get('state') != 'READY': return {'reply': 'Готовый ответ больше недоступен.'}
                    result = self.peek({'op':'station_deliver','tenant':job['tenant'], 'conversation_id':job['conversation'], 'job_id':job['jid'],
                                        'target_conversation':data.get('conversation'), 'message_id':data.get('message_id')})
                    if result.get('state') != 'READY': return {'reply': 'Автоматический ответ уже недоступен для этой беседы.'}
                    job['callback_rid'] = data['rid']; job['delivery'] = 'responded_to_skill'; self.save()
                    return {'reply': result['text']}
                if command.startswith('привязать колонку'):
                    code = ''.join(re.findall(r'\d', command[len('привязать колонку'):]))
                    if self.clock() >= self.pair_until or self.pair_tries >= 5: return {'reply': 'Подключение колонки не завершено. Обновите состояние на сайте.'}
                    self.pair_tries += 1
                    if not hmac.compare_digest(hashlib.sha256(code.encode()).hexdigest(), self.pair_hash):
                        return {'reply': 'Автоматическое подключение не подтверждено.'}
                    self.state['binding'] = {k: data[k] for k in ('tenant', 'application')}
                    self.pair_until = 0; self.save()
                    return {'reply': 'Колонка подключена. Теперь я сообщу ответ, когда расчёт завершится.'}
                if normalize(command) == settings['manual_command']:
                    if match and self.state['job']:
                        job = dict(self.state['job']); result = self.status_job(job)
                        if result['state'] == 'READY':
                            self.state['job']['delivery'] = 'manual'; self.state['generation'] += 1; self.save()
                            delivered = self.peek({'op':'station_deliver','tenant':job['tenant'], 'conversation_id':job['conversation'], 'job_id':job['jid'],
                                                   'target_conversation':data.get('conversation'), 'message_id':data.get('message_id')})
                            return {'reply': delivered['text'] if delivered.get('state') == 'READY' else 'Этот ответ больше недоступен для текущей беседы.'}
                        if result['state'] in ('QUEUED', 'RUNNING'):
                            return {'reply': pending('Расчёт ещё выполняется.', self.state['job'], self.clock())}
                        return {'reply': result.get('text') or 'Для этого запроса нет доступного готового ответа.'}
                    return {'command': 'результат'}
                if match and command in ('отмени отчет', 'выход') and self.state['job']:
                    self.state['job']['delivery'] = 'manual'; self.state['generation'] += 1; self.save()
                return {'command': command}
            result = data.get('result')
            if not isinstance(result, dict) or not isinstance(result.get('text'), str): raise Fault('result_schema')
            text = result['text']
            if match and result.get('job_id') and result.get('state') in ('QUEUED', 'RUNNING'):
                old = self.state['job']; jid = result['job_id']; conversation = data.get('conversation')
                if not isinstance(conversation, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,128}', conversation): raise Fault('conversation_schema')
                if not old or (old['jid'], old['conversation']) != (jid, conversation):
                    self.state['generation'] += 1
                    estimate = baseline(self.state['eta_history'])
                    self.state['job'] = dict(tenant=data['tenant'], token_hash=data['token_hash'], jid=jid,
                        conversation=conversation, created=self.clock(), next_at=self.clock()+settings['interval_seconds'],
                        eta_base=estimate, eta_until=self.clock()+estimate, eta_observed=False,
                        message=0, delivery='waiting' if settings['enabled'] and self.state['connected'] and not self.state['uncertain'] else 'manual')
                    self.save()
                if self.state['job']['delivery'] == 'waiting':
                    return {'text': 'Задание принято. Примерное время ответа — около '+label(self.state['job'].get('eta_base', 60))+'. Сообщу ответ на этой колонке, когда расчёт завершится.', 'end_session': True}
            # Replace only the runtime's exact fixed instruction, never figures or arbitrary prose.
            text = text.replace('Скажите: результат.', 'Скажите: '+settings['manual_command']+'.')
            text = text.replace('Для получения отчета: результат.', 'Для получения отчета: '+settings['manual_command']+'.')
            return {'text': text}

    def tick(self):
        with self.lock:
            job = self.state['job']; settings = self.state['settings']
            if not job or job['delivery'] != 'waiting' or not settings['enabled'] or self.state['uncertain']: return
            if self.clock()-job['created'] > 86400:
                job['delivery'] = 'stopped'; self.save(); return
            snapshot = dict(job); generation = self.state['generation']
        try: result = self.status_job(snapshot)
        except (OSError, ValueError, Fault): return
        with self.lock:
            if generation != self.state['generation'] or self.state['job'] != job or job['delivery'] != 'waiting': return
            state = result.get('state')
            if state not in ('READY', 'QUEUED', 'RUNNING', 'FAILED', 'UNKNOWN') or self.clock()-job['created'] > 86400:
                job['delivery'] = 'stopped'; self.save(); return
            final = state == 'READY'; failed = state in ('FAILED', 'UNKNOWN')
            if final and not job.get('eta_observed'):
                observe(self.state['eta_history'], self.clock()-job['created'])
                job['eta_observed'] = True
                self.save()
            if not final and not failed and self.clock() < job['next_at']: return
            text = (result.get('text') or 'Расчёт не завершился. Повторите исходный запрос.')[:900] if failed else (result.get('text', '') if final else pending(settings['pending_messages'][job['message'] % len(settings['pending_messages'])], job, self.clock()))
            if not text and not final: return
            job['delivery'] = 'sending'
            if final:
                job['nonce'] = ''.join(str(secrets.randbelow(10)) for _ in range(8))
                job['nonce_until'] = self.clock()+90; job['nonce_generation'] = generation
                job['callback_rid'] = None
                text = 'Спроси Октопорт маркет доставка '+job['nonce']
            self.save()
        try:
            # Recheck permission and concrete job immediately before dispatch.
            latest = self.status_job(snapshot)
            accepted_states = ('READY',) if final else (('FAILED','UNKNOWN') if failed else ('QUEUED','RUNNING'))
            if latest.get('state') not in accepted_states:
                with self.lock:
                    if self.state['job'] is job: job['delivery']='waiting'; self.save()
                return
            self.speak(text, generation, guard=lambda: self.state['job'] is job and job['delivery'] == 'sending' and self.status_job(snapshot).get('state') in accepted_states, mode='skill' if final else 'text')
            with self.lock:
                if self.state['job'] is job and generation == self.state['generation']:
                    if job['delivery'] != 'responded_to_skill': job['delivery'] = 'accepted_waiting_skill' if final else ('failed_notified' if failed else 'waiting')
                    job['next_at'] = self.clock()+settings['interval_seconds']; job['message'] += 1; self.save()
        except Exception:
            with self.lock:
                if self.state['job'] is job:
                    job['delivery'] = 'unknown' if self.state['uncertain'] else 'manual'; self.save()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): raise Fault('auth_redirect')


def session_cookie(header, name):
    found = [part.strip().split('=', 1)[1] for part in (header or '').split(';')
             if part.strip().startswith(name+'=')]
    if len(found) != 1 or not re.fullmatch(r'[A-Za-z0-9_-]{43}', found[0]): raise Fault('login_required')
    return found[0]

def staff_cookie(header): return session_cookie(header, '__Host-alisa_staff')

def site_profile(cookie):
    token = session_cookie(cookie, '__Host-alisa_session')
    base = os.environ['ALISA_PLATFORM_URL'].rstrip('/')
    if base not in ('http://127.0.0.1:18102', 'http://127.0.0.1:18104'): raise Fault('platform_origin')
    req = urllib.request.Request(base+'/api/v1/account/me', data=json.dumps({'session_token':token}).encode(),
        headers={'Authorization':'Bearer '+os.environ['ALISA_AUTH_SERVICE_TOKEN'], 'Content-Type':'application/json'})
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=3) as response: value=json.load(response)
    except urllib.error.HTTPError: raise Fault('login_required') from None
    profile=value.get('profile', {})
    if profile.get('role') != 'OWNER_CLIENT' or not isinstance(profile.get('customer_id'),str) or not re.fullmatch(r'[0-9a-f-]{36}', profile['customer_id']):
        raise Fault('customer_required')
    return profile

class Registry:
    """One private Station session per authenticated site customer; shared admin policy."""
    def __init__(self, directory, cipher):
        self.root=Path(directory); self.cipher=cipher;self.lock=threading.RLock()
        self.policy=Delivery(self.root,cipher)
        self.users={}
        self.pair_fail={}
        parent=self.root/'users';parent.mkdir(exist_ok=True)
        for path in parent.iterdir():
            if path.is_dir() and re.fullmatch(r'[0-9a-f-]{36}',path.name):self._open(path.name)
    def _open(self, owner):
        if owner not in self.users:
            path=self.root/'users'/owner;path.mkdir(mode=0o700,exist_ok=True)
            d=Delivery(path,self.cipher)
            d.policy_enabled=lambda:self.policy.state['settings']['enabled']
            d.policy_guard=self.policy.lock
            if d.state['owner'] not in (None,owner):raise Fault('connection_other_owner')
            d.state['owner']=owner
            if d.state['settings']!=self.policy.state['settings']:
                d.configure({'revision':d.state['revision'],'settings':self.policy.state['settings']})
            self.users[owner]=d
        return self.users[owner]
    def site(self, owner):
        with self.lock:return self._open(owner)
    def admin(self, kind, data, owner):
        if kind not in ('status','settings'):raise Fault('personal_connection_on_site')
        with self.lock:
            if kind=='status':return self.policy.view()
            result=self.policy.configure(data)
            for d in self.users.values():d.configure({'revision':d.state['revision'],'settings':self.policy.state['settings']})
            return result
    def ingress(self, data):
        with self.lock:
            for d in self.users.values():
                if d.state['settings']!=self.policy.state['settings']:
                    d.configure({'revision':d.state['revision'],'settings':self.policy.state['settings']})
            identity=(data.get('tenant'),data.get('application'))
            bound=[d for d in self.users.values() if d.state['binding'] and (d.state['binding']['tenant'],d.state['binding']['application'])==identity]
            if len(bound)>1:return {'error':'ambiguous_station_binding'}
            command=data.get('command','')
            internal=internal_voice_command(command) if data.get('op')=='before' else None
            if internal:
                data=dict(data,command=internal); command=internal
                if internal == 'доставка' or internal.startswith('доставка '):
                    return bound[0].ingress(data) if bound else {'reply':'Этот автоматический ответ больше недоступен.'}
            if data.get('op')=='before' and isinstance(command,str) and command.startswith('привязать колонку'):
                code=''.join(re.findall(r'\d',command[len('привязать колонку'):]))
                marker=identity
                until,count=self.pair_fail.get(marker,(0,0))
                if until<time.time():until,count=time.time()+180,0
                if count>=5:return {'reply':'Подключение временно недоступно. Начните его повторно позже.'}
                target=[d for d in self.users.values() if d.pair_until>d.clock() and hmac.compare_digest(d.pair_hash,hashlib.sha256(code.encode()).hexdigest())]
                if len(target)!=1 or bound and bound[0] is not target[0]:
                    self.pair_fail[marker]=(until,count+1)
                    if len(self.pair_fail)>1000:self.pair_fail={k:v for k,v in self.pair_fail.items() if v[0]>=time.time()}
                    return {'reply':'Подключение не подтверждено.'}
                self.pair_fail.pop(marker,None)
                return target[0].ingress(data)
            if bound:return bound[0].ingress(data)
            if data.get('op')=='before':
                if normalize(command)==self.policy.state['settings']['manual_command']:return {'command':'результат'}
                return {'command':command}
            return {'text':data.get('result',{}).get('text','')}
    def tick(self):
        with self.lock:users=list(self.users.values())
        for d in users:
            if d.state['settings']!=self.policy.state['settings']:
                d.configure({'revision':d.state['revision'],'settings':self.policy.state['settings']})
            d.tick()


def staff_profile(cookie):
    token = staff_cookie(cookie)
    base = os.environ['ALISA_PLATFORM_URL'].rstrip('/')
    if base not in ('http://127.0.0.1:18102', 'http://127.0.0.1:18104'): raise Fault('platform_origin')
    req = urllib.request.Request(base+'/api/v1/staff/me', data=json.dumps({'session_token':token}).encode(),
        headers={'Authorization':'Bearer '+os.environ['ALISA_STAFF_SERVICE_TOKEN'], 'Content-Type':'application/json'})
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=3) as response: value = json.load(response)
    except urllib.error.HTTPError: raise Fault('login_required') from None
    profile = value.get('staff', {})
    if profile.get('role') != 'OWNER' or profile.get('product_id') != 'alisa_market': raise Fault('owner_required')
    return profile


class AdminHandler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def send(self, status, body, mime='application/json; charset=utf-8', location=None):
        self.send_response(status)
        self.send_header('Content-Type', mime); self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control','no-store'); self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        if location: self.send_header('Location', location)
        self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        try:
            site=self.headers.get('Host')=='alisa.octoport.ru' and self.path.startswith(SITE_BASE)
            admin=self.headers.get('Host')=='alisa-admin.octoport.ru' and self.path.startswith(BASE)
            if not (site or admin):raise Fault('origin')
            profile=site_profile(self.headers.get('Cookie')) if site else staff_profile(self.headers.get('Cookie'))
            base=SITE_BASE if site else BASE
            device=self.server.delivery.site(profile['customer_id']) if site else None
            name=self.path.removeprefix(base)
            if self.path==base:name='index-site.html' if site else 'index-admin.html'
            if self.path==base+'qr.svg':
                if not site:raise Fault('personal_connection_on_site')
                link=device.qr
                if not link or time.time()>=device.qr_until:raise Fault('qr_expired')
                from qrcodegen import QrCode
                qr = QrCode.encode_text(link, QrCode.Ecc.MEDIUM)
                rects = ''.join(f'<path d="M{x+4},{y+4}h1v1h-1z"/>' for y in range(qr.get_size()) for x in range(qr.get_size()) if qr.get_module(x,y))
                svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {qr.get_size()+8} {qr.get_size()+8}"><rect width="100%" height="100%" fill="white"/><g fill="black">{rects}</g></svg>'
                self.send(200, svg.encode(), 'image/svg+xml'); return
            allowed=('index-site.html','app.js','style.css') if site else ('index-admin.html','app-admin.js','style.css')
            if name not in allowed:raise Fault('not_found')
            mime = {'index-site.html':'text/html','index-admin.html':'text/html','app.js':'text/javascript','app-admin.js':'text/javascript','style.css':'text/css'}[name]
            self.send(200, Path(__file__).with_name(name).read_bytes(), mime+'; charset=utf-8')
        except Fault as e:
            if e.code == 'login_required': self.send(303, b'', location='/login')
            else: self.send(403, json.dumps({'error':e.code}).encode())
        except Exception: self.send(503, b'{"error":"service_unavailable"}')
    def do_POST(self):
        try:
            site=self.headers.get('Host')=='alisa.octoport.ru' and self.headers.get('Origin')==SITE_ORIGIN and self.path==SITE_BASE+'api'
            admin=self.headers.get('Host')=='alisa-admin.octoport.ru' and self.headers.get('Origin')==ORIGIN and self.path==BASE+'api'
            if not (site or admin):raise Fault('origin')
            if self.headers.get('Content-Type')!='application/json':raise Fault('request_schema')
            profile=site_profile(self.headers.get('Cookie')) if site else staff_profile(self.headers.get('Cookie'))
            length = int(self.headers.get('Content-Length','0'))
            if not 1 <= length <= 4096: raise Fault('request_size')
            data = json.loads(self.rfile.read(length)); action = data.pop('action')
            if site and action not in ('status','qr','poll','devices','select','pair','disconnect'):
                raise Fault('owner_only_setting')
            response=(self.server.delivery.site(profile['customer_id']).admin(action,data,profile['customer_id']) if site
                      else self.server.delivery.admin(action,data,profile['id']))
            self.send(200, json.dumps(response, ensure_ascii=False).encode())
        except Fault as e: self.send(409 if e.code=='settings_changed_reload' else 403, json.dumps({'error':e.code}).encode())
        except Exception: self.send(503, b'{"error":"service_unavailable"}')


class Ingress(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True
class IngressHandler(socketserver.StreamRequestHandler):
    def handle(self):
        data = None
        try:
            self.request.settimeout(.5)
            uid = struct.unpack('3i', self.request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))[1]
            if uid != os.geteuid(): raise Fault('peer_denied')
            raw = self.rfile.readline(16001)
            if len(raw) > 16000 or not raw.endswith(b'\n'): raise Fault('ingress_size')
            data = json.loads(raw)
            result = self.server.delivery.ingress(data)
        except Exception as exc:
            print('station ingress failure', type(exc).__name__, getattr(exc, 'code', ''), flush=True)
            if isinstance(data, dict) and data.get('op') == 'before' and internal_voice_command(data.get('command')):
                result = {'reply':'Автоматический ответ сейчас недоступен. Повторите исходный запрос.'}
            else:
                result = {'error':'delivery_unavailable'}
        try: self.wfile.write(json.dumps(result, ensure_ascii=False).encode()+b'\n')
        except OSError: pass


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--state', required=True); parser.add_argument('--key', required=True)
    args = parser.parse_args()
    from cryptography.fernet import Fernet
    os.umask(0o077)
    core = Registry(args.state, Fernet(Path(args.key).read_bytes()))
    ipc_path = '/run/alisa-station/ingress.sock'
    ipc = Ingress(ipc_path, IngressHandler); ipc.delivery = core
    web = ThreadingHTTPServer(('127.0.0.1',8777), AdminHandler); web.delivery = core
    threading.Thread(target=ipc.serve_forever, daemon=True).start()
    def work():
        while True:
            try: core.tick()
            except Exception: pass
            time.sleep(1)
    threading.Thread(target=work, daemon=True).start()
    web.serve_forever()
if __name__ == '__main__': main()