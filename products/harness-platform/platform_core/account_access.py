"""Account verification, shared by browser and bearer sign-in. Time is in seconds."""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
from pathlib import Path
from time import time

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives.hashes import SHA1
from cryptography.hazmat.primitives.twofactor.hotp import HOTP

from .access_mail import deliver
from .identity import AuthenticationError, _SESSION_SECONDS, _derive, _password_bytes, _login_name, _secret_digest, _principal

REMEMBER_SECONDS = 14 * 24 * 60 * 60
WINDOW = 600
MAX_TRIES = 5
SCHEMA = (
    """CREATE TABLE IF NOT EXISTS access_contacts(
        actor TEXT PRIMARY KEY REFERENCES identity_accounts ON DELETE CASCADE,
        email TEXT UNIQUE NOT NULL, verified INTEGER NOT NULL DEFAULT 0,
        email_login INTEGER NOT NULL DEFAULT 1, seed BLOB, last_step INTEGER NOT NULL DEFAULT -1)""",
    """CREATE TABLE IF NOT EXISTS access_pending(
        id BLOB PRIMARY KEY, actor TEXT REFERENCES identity_accounts ON DELETE CASCADE,
        stage TEXT NOT NULL, address TEXT, verifier BLOB, expires INTEGER NOT NULL,
        state TEXT NOT NULL, seed BLOB)""",
    "CREATE INDEX IF NOT EXISTS access_pending_expiry ON access_pending(expires)",
    "CREATE INDEX IF NOT EXISTS access_pending_actor ON access_pending(actor)",
    """CREATE TABLE IF NOT EXISTS access_limits(
         bucket BLOB PRIMARY KEY, until INTEGER NOT NULL, count INTEGER NOT NULL)""",
    "CREATE INDEX IF NOT EXISTS access_limit_expiry ON access_limits(until)",
)


class AccessError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def mailbox(value):
    if not isinstance(value, str):
        raise AccessError("Введите адрес электронной почты.")
    value = value.strip().casefold()
    if (len(value) > 254 or not re.fullmatch(r"[a-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}@[a-z0-9.-]+\.[a-z]{2,63}", value)
            or value.startswith(".") or ".@" in value or ".." in value
            or any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", part)
                   for part in value.split("@")[1].split("."))):
        raise AccessError("Проверьте адрес электронной почты.")
    return value


def admin(db, actor):
    return bool(db.execute("SELECT 1 FROM identity_admins WHERE actor_id=?", (actor,)).fetchone())


def budget(db, prefix, key, seconds, limit, now):
    # A short independent bucket also prevents guessing across new challenges.
    ident = hashlib.sha256((prefix + "\0" + key).encode()).digest()
    row = db.execute("SELECT count,until FROM access_limits WHERE bucket=?", (ident,)).fetchone()
    if row and row[1] > now:
        if row[0] >= limit:
            raise AccessError("Слишком много попыток. Попробуйте позже.", 429)
        db.execute("UPDATE access_limits SET count=count+1 WHERE bucket=?", (ident,))
    else:
        db.execute("INSERT OR REPLACE INTO access_limits VALUES(?,?,1)", (ident, now + seconds))


def issue(db, actor, remember, now):
    remember = remember and not admin(db, actor)
    duration = REMEMBER_SECONDS if remember else _SESSION_SECONDS
    token = secrets.token_urlsafe(32)
    db.execute("DELETE FROM identity_sessions WHERE expires_at<=?", (now,))
    db.execute("INSERT INTO identity_sessions VALUES(?,?,?)", (_secret_digest(token), actor, now + duration))
    return {"token": token, "max_age": duration if remember else None}


class AccountAccess:
    def __init__(self, store, mail=deliver, keyfile=None, clock=time):
        self.store, self.mail, self.clock = store, mail, clock
        self.keyfile = keyfile or os.getenv("HARNESS_AUTH_KEY_FILE")
        with store._write() as db:
            fresh = not db.execute("SELECT 1 FROM sqlite_master WHERE name='access_pending'").fetchone()
            for statement in SCHEMA:
                db.execute(statement)
            if fresh:
                # Old administrator sessions have no proof of authenticator ownership.
                db.execute("DELETE FROM identity_sessions WHERE actor_id IN (SELECT actor_id FROM identity_admins)")

    def cipher(self):
        try:
            return Fernet(Path(self.keyfile).read_bytes().strip())
        except (OSError, ValueError, TypeError):
            raise AccessError("Подключение приложения временно недоступно. Обратитесь в поддержку.", 503) from None

    def decrypt(self, encrypted):
        try:
            return self.cipher().decrypt(encrypted)
        except InvalidToken:
            raise AccessError("Не удалось открыть ключ приложения. Обратитесь в поддержку.", 503) from None

    def pending(self, db, stage, actor, address, state):
        now = int(self.clock())
        handle = secrets.token_urlsafe(32)
        db.execute("DELETE FROM access_pending WHERE expires<=?", (now,))
        db.execute("DELETE FROM access_limits WHERE until<=?", (now,))
        db.execute("INSERT INTO access_pending(id,actor,stage,address,expires,state) VALUES(?,?,?,?,?,?)",
                   (_secret_digest(handle), actor, stage, address, now + WINDOW, json.dumps(state)))
        return self.transition(db, handle, stage, address, state, actor)

    def transition(self, db, handle, stage, address, state, actor):
        now, ident = int(self.clock()), _secret_digest(handle)
        result = {"challenge": handle, "stage": stage}
        db.execute("UPDATE access_pending SET stage=?,address=?,verifier=NULL,expires=? WHERE id=?", (stage, address, now + WINDOW, ident))
        if stage == "email":
            budget(db, "send", address, 60, 1, now)
            budget(db, "mail-hour", address, 3600, 8, now)
            if actor:
                budget(db, "actor-mail", actor, 3600, 8, now)
            code = f"{secrets.randbelow(1000000):06}"
            db.execute("UPDATE access_pending SET verifier=? WHERE id=?", (hmac.digest(handle.encode(), code.encode(), "sha256"), ident))
            result["_delivery"] = (address, code)
        elif stage == "setup":
            seed = base64.b32encode(secrets.token_bytes(20)).decode()
            db.execute("UPDATE access_pending SET seed=? WHERE id=?", (self.cipher().encrypt(seed.encode()), ident))
            result["setup_key"] = seed
        return result

    def send(self, result, previous=None):
        envelope = result.pop("_delivery", None)
        if envelope:
            try:
                self.mail(*envelope)
            except Exception:
                with self.store._write() as db:
                    handle = result["challenge"]
                    current = hmac.digest(handle.encode(), envelope[1].encode(), "sha256")
                    if previous:
                        db.execute("UPDATE access_pending SET verifier=?, expires=? WHERE id=? AND stage='email' AND verifier=?",
                                   (*previous, _secret_digest(handle), current))
                    else:
                        db.execute("DELETE FROM access_pending WHERE id=? AND stage='email' AND verifier=?",
                                   (_secret_digest(handle), current))
                raise AccessError("Не удалось отправить письмо. Повторите вход чуть позже.", 503) from None
        return result

    def login(self, login, password, remember=False):
        if type(remember) is not bool:
            raise AccessError("Некорректные настройки входа.")
        def begin(db, actor, _now):
            contact = db.execute("SELECT email,verified,email_login FROM access_contacts WHERE actor=?", (actor,)).fetchone()
            pw = db.execute("SELECT password_hash FROM identity_accounts WHERE actor_id=?", (actor,)).fetchone()[0]
            state = {"password": pw.hex(), "remember": remember}
            if not contact:
                if admin(db, actor):
                    raise AccessError("Для первого входа администратора нужно привязать почту через владельца сервера.", 403)
                return self.pending(db, "bind", actor, None, state)
            address, verified, email_login = contact
            if admin(db, actor) or not verified or email_login:
                return self.pending(db, "email", actor, address, state)
            return issue(db, actor, remember, int(self.clock()))
        return self.send(self.store.password_action(login, password, begin))

    def registration(self, guest, login, password, address, peer, remember=False, recovery=None):
        name, address = _login_name(login), mailbox(address)
        encoded = _password_bytes(password)
        self.store.guest_chat(guest)
        salt = secrets.token_bytes(16)
        state = {"guest": _secret_digest(guest).hex(), "login": name, "salt": salt.hex(), "remember": remember,
                 "hash": _derive(encoded, salt).hex()}
        if recovery:
            if not hmac.compare_digest(self.store.guest_recovery(guest), recovery):
                raise AuthenticationError("Invalid registration form")
            state["recovery"] = _secret_digest(recovery).hex()
        with self.store._write() as db:
            now = int(self.clock())
            self.store._active(db, guest)
            budget(db, "guest-send", state["guest"], 3600, 6, now)
            budget(db, "signup-source", peer, 3600, 120, now)
            if db.execute("SELECT 1 FROM identity_accounts WHERE login=?", (name,)).fetchone():
                raise AccessError("Этот логин уже занят. Выберите другой логин.", 409)
            result = self.pending(db, "email", None, address, state)
        return self.send(result)

    def read(self, db, handle):
        try:
            ident = _secret_digest(handle)
        except AuthenticationError:
            raise AccessError("Время подтверждения истекло. Начните вход заново.", 401) from None
        row = db.execute("SELECT actor,stage,address,verifier,state,seed FROM access_pending WHERE id=? AND expires>?",
                         (ident, int(self.clock()))).fetchone()
        if not row:
            raise AccessError("Время подтверждения истекло. Начните вход заново.", 401)
        actor, stage, address, verifier, payload, seed = row
        state = json.loads(payload)
        if actor:
            password_hash = db.execute("SELECT password_hash FROM identity_accounts WHERE actor_id=?", (actor,)).fetchone()[0]
            if password_hash.hex() != state["password"]:
                raise AccessError("Пароль изменился. Начните вход заново.", 401)
        return actor, stage, address, verifier, state, seed

    def describe(self, handle):
        with self.store._lock:
            _, stage, _, _, _, seed = self.read(self.store._db, handle)
            return {"stage": stage, **({"setup_key": self.decrypt(seed).decode()} if stage == "setup" else {})}

    def resend(self, handle):
        with self.store._write() as db:
            actor, stage, address, _, state, _ = self.read(db, handle)
            if stage != "email":
                raise AccessError("Запросите код на шаге подтверждения почты.")
            previous = db.execute("SELECT verifier,expires FROM access_pending WHERE id=?", (_secret_digest(handle),)).fetchone()
            result = self.transition(db, handle, stage, address, state, actor)
        return self.send(result, previous)

    def advance(self, handle, value, guest=None):
        if not isinstance(value, str) or not 1 <= len(value) <= 254:
            raise AccessError("Заполните поле подтверждения.")
        with self.store._write() as db:
            now = int(self.clock())
            actor, stage, address, verifier, state, seed = self.read(db, handle)
            if "guest" in state and state["guest"] != _secret_digest(guest).hex():
                raise AccessError("Продолжите регистрацию в том же браузере.", 403)
            if stage == "registered":
                budget(db, "signup-receipt", handle, 60, MAX_TRIES, now)
                result = self.registration_receipt(db, handle, guest, value, verifier, state, now)
            elif stage == "bind":
                result = self.transition(db, handle, "email", mailbox(value), state, actor)
            else:
                bucket = "verify-mail" if stage == "email" else "verify-app"
                budget(db, bucket, actor or address, WINDOW, MAX_TRIES, now)
                if stage == "email":
                    correct = hmac.compare_digest(verifier, hmac.digest(handle.encode(), value.encode(), "sha256"))
                    result = self.after_email(db, handle, actor, address, state, guest, now) if correct else None
                else:
                    result = self.after_totp(db, actor, seed, stage, value, state, now)
                if result:
                    db.execute("DELETE FROM access_limits WHERE bucket=?",
                               (hashlib.sha256((bucket+"\0"+(actor or address)).encode()).digest(),))
                if result and "token" in result and "guest" not in state:
                    db.execute("DELETE FROM access_pending WHERE id=?", (_secret_digest(handle),))
        if not result:
            raise AccessError("Код не подошёл. Проверьте цифры и попробуйте ещё раз.", 401)
        return self.send(result)

    def after_email(self, db, handle, actor, address, state, guest, now):
        existing = db.execute("SELECT actor FROM access_contacts WHERE email=?", (address,)).fetchone()
        if existing and existing[0] != actor:
            raise AccessError("Этот адрес уже привязан к аккаунту. Войдите в него.", 409)
        if actor is None:
            chat = self.store._active(db, guest)
            token = self.signup_token(handle, guest)
            duration = REMEMBER_SECONDS if state["remember"] else _SESSION_SECONDS
            recovery = bytes.fromhex(state["recovery"]) if "recovery" in state else hmac.digest(guest.encode(), b"guest-registration-v2", "sha256")
            if db.execute("SELECT 1 FROM identity_accounts WHERE login=?", (state["login"],)).fetchone():
                raise AccessError("Этот логин уже занят. Выберите другой логин.", 409)
            actor = self.store.claim_signup(db, state["login"], bytes.fromhex(state["salt"]), bytes.fromhex(state["hash"]),
                                           recovery, chat, token, now + duration)
            db.execute("INSERT INTO access_contacts(actor,email,verified) VALUES(?,?,1)", (actor,address))
            receipt = {"guest":state["guest"], "chat":chat, "remember":state["remember"]}
            db.execute("UPDATE access_pending SET stage='registered', state=?,expires=? WHERE id=?",
                       (json.dumps(receipt), now + 60, _secret_digest(handle)))
            return {"token":token, "max_age":duration if state["remember"] else None, "chat":chat}
        current = db.execute("SELECT email,seed FROM access_contacts WHERE actor=?", (actor,)).fetchone()
        if current and current[0] != address:
            raise AccessError("Почта уже изменилась. Начните вход заново.", 409)
        db.execute("""INSERT INTO access_contacts(actor,email,verified) VALUES(?,?,1)
                      ON CONFLICT(actor) DO UPDATE SET verified=1""", (actor,address))
        if admin(db, actor):
            return self.transition(db, handle, "totp" if current and current[1] else "setup", address, state, actor)
        return issue(db, actor, state["remember"], now)

    @staticmethod
    def signup_token(handle, guest):
        raw = hmac.digest(guest.encode(), b"verified-signup:" + handle.encode(), "sha256")
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")

    def registration_receipt(self, db, handle, guest, value, expected, state, now):
        if not hmac.compare_digest(expected, hmac.digest(handle.encode(), value.encode(), "sha256")):
            return None
        token = self.signup_token(handle, guest)
        row = db.execute("SELECT expires_at FROM identity_sessions WHERE digest=? AND expires_at>?",
                         (_secret_digest(token), now)).fetchone()
        if not row:
            raise AccessError("Войдите с логином и паролем.", 401)
        return {"token":token, "max_age":row[0]-now if state["remember"] else None, "chat":state["chat"]}

    def after_totp(self, db, actor, pending_seed, stage, value, state, now):
        if not admin(db, actor) or not re.fullmatch(r"[0-9]{6}", value):
            return None
        saved, last = db.execute("SELECT seed,last_step FROM access_contacts WHERE actor=?", (actor,)).fetchone()
        if stage == "setup" and saved:
            raise AccessError("Приложение уже подключено. Начните вход заново.", 409)
        encrypted = pending_seed if stage == "setup" else saved
        secret = self.decrypt(encrypted)
        hotp = HOTP(base64.b32decode(secret), 6, SHA1())
        for step in range(now // 30 - 1, now // 30 + 2):
            if step > last and hmac.compare_digest(hotp.generate(step), value.encode()):
                db.execute("UPDATE access_contacts SET seed=?,last_step=? WHERE actor=?", (encrypted,step,actor))
                return issue(db, actor, state["remember"], now)
        return None

    def preferences(self, token):
        with self.store._lock:
            actor, _ = _principal(self.store._db, token)
            row = self.store._db.execute("SELECT email,email_login FROM access_contacts WHERE actor=? AND verified=1",(actor,)).fetchone()
            administrator = admin(self.store._db, actor)
            return {"email": row[0] if row else None, "enabled": administrator or row is None or bool(row[1]),
                    "admin": administrator}

    def configure(self, token, password, enabled):
        login = self.store.account_login(token)
        def save(db, actor, _now):
            if admin(db, actor):
                raise AccessError("Администратор подтверждает вход по почте и в приложении.", 403)
            if not db.execute("UPDATE access_contacts SET email_login=? WHERE actor=? AND verified=1", (enabled,actor)).rowcount:
                raise AccessError("Сначала войдите с подтверждением почты.", 409)
            db.execute("DELETE FROM access_pending WHERE actor=?", (actor,))
            return True
        return self.store.password_action(login, password, save, session=token)
