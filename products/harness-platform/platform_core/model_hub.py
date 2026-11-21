"""Public candidate discovery and the private, operator-owned hub registry."""
import argparse
import asyncio
import json
import os
import re
import sqlite3
import time
from decimal import Decimal, InvalidOperation
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4
from urllib.parse import urlsplit

import httpx
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.routing import Route

from .chat_connections import vault_cipher
from .model_catalog import catalog_rows
from . import hub_runtime

CATALOG = "https://openrouter.ai/api/v1/models"
# These mappings are discovery evidence, never permission to send traffic.
ENROLLMENT = {row["id"]: row for row in json.loads(Path(__file__).with_name("hub_enrollment.json").read_text())}
RESEARCH_VERSION = "direct-free-customer-use-v4"
PROVIDERS = {key: row["name"] for key, row in ENROLLMENT.items()}
ALIASES = {"dots-studio": "dots", "dots-ai": "dots", "dotsstudio": "dots", "rednote": "dots",
           "xiaohongshu": "dots", "xiao-hong-shu": "dots", "atlascloud": "atlas", "atlas-cloud": "atlas", "atlascloud-ai": "atlas", "atlas-cloud-ai": "atlas",
           "liquid": "liquid-ai", "nvidia-build": "nvidia", "inclusionai": "ant-ling", "z-ai": "zai",
           "particle-ai": "particle", "groqcloud": "groq"}


def provider_id(provider, name="", source=""):
    host = (urlsplit(source).hostname or "").lower()
    for domain, key in (("atlascloud.ai", "atlas"), ("dots.ai", "dots"), ("askdiandian.com", "dots"),
                        ("nvidia.com", "nvidia"), ("liquid.ai", "liquid-ai"), ("mistral.ai", "mistral")):
        if host == domain or host.endswith("." + domain):
            return key
    if name.strip() == "小红书":
        return "dots"
    label = re.sub(r"[^a-z0-9]", "", name.lower())
    if label in {"nvidia","nvidiabuild","nvidianim","nvidiadeveloper","liquidai","liquidconsole"}:
        return "nvidia" if label.startswith("nvidia") else "liquid-ai"
    if label in {"dotsstudio", "dotsai", "xiaohongshu", "rednote", "atlascloud", "atlascloudai"}:
        return "atlas" if label.startswith("atlas") else "dots"
    if label in {"mistral","mistralai","mistralstudio","laplateforme"} or provider in {"mistralai","mistral-ai","mistral-studio","la-plateforme"}:
        return "mistral"
    if provider in {"nvidia-nim","nvidia-api-catalog","nvidia-developer","nvidiabuild"}:
        return "nvidia"
    if provider in {"liquidai","liquid-console"}:
        return "liquid-ai"
    return ALIASES.get(provider, provider)


def registration_excluded(provider):
    return ENROLLMENT.get(provider, {}).get("kind") == "excluded"

MODELS = {
    "dots-studio/dots-3-note-preview": ("dots", "atlas"),
    "google/gemma-4-26b-a4b-it": ("cloudflare", "google"),
    "google/gemma-4-31b-it": ("google",),
}
SCHEMA = """
CREATE TABLE IF NOT EXISTS candidates(model TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS catalog_state(
    id INTEGER PRIMARY KEY CHECK(id=1), attempted INTEGER, succeeded INTEGER, error TEXT);
CREATE TABLE IF NOT EXISTS hub_keys(
    id TEXT PRIMARY KEY, provider TEXT NOT NULL, label TEXT NOT NULL, sealed BLOB NOT NULL,
    UNIQUE(provider,label));
CREATE TABLE IF NOT EXISTS hub_cloudflare_accounts(
    key_id TEXT PRIMARY KEY REFERENCES hub_keys(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS research(
    model TEXT PRIMARY KEY, checked INTEGER NOT NULL, finding TEXT NOT NULL, source TEXT NOT NULL,
    access TEXT NOT NULL, provider TEXT NOT NULL, provider_name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS research_alternatives(
    model TEXT NOT NULL, checked INTEGER NOT NULL, finding TEXT NOT NULL, source TEXT NOT NULL,
    access TEXT NOT NULL, provider TEXT NOT NULL, provider_name TEXT NOT NULL, PRIMARY KEY(model,provider));
CREATE TABLE IF NOT EXISTS research_versions(version TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS research_expiry(model TEXT NOT NULL, provider TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(model,provider));
CREATE TABLE IF NOT EXISTS research_revision(model TEXT PRIMARY KEY, version TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS research_attempts(model TEXT PRIMARY KEY, attempted INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS research_state(
    id INTEGER PRIMARY KEY CHECK(id=1), attempted INTEGER, succeeded INTEGER, error TEXT);
"""

def valid_rate(value):
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        return False
    try:
        return Decimal(str(value)).is_finite()
    except InvalidOperation:
        return False


def string_list(items):
    return isinstance(items, list) and all(isinstance(value, str) for value in items)


def valid_catalog_record(item):
    if not isinstance(item, dict):
        return False
    architecture = item.get("architecture")
    price = item.get("pricing")
    return (isinstance(item.get("id"), str) and isinstance(item.get("name"), str)
            and isinstance(architecture, dict) and string_list(architecture.get("output_modalities"))
            and string_list(item.get("supported_parameters"))
            and isinstance(price, dict) and {"prompt", "completion"}.issubset(price)
            and all(valid_rate(rate) for key, rate in price.items() if key != "overrides")
            and isinstance(price.get("overrides", []), list)
            and all(isinstance(tier, dict) for tier in price.get("overrides", [])))


def registration_providers(db):
    providers = {key: row["name"] for key,row in ENROLLMENT.items() if row["kind"] == "free"}
    for row in db.execute("""SELECT provider,provider_name,source FROM
            (SELECT * FROM research UNION ALL SELECT * FROM research_alternatives)
            JOIN candidates USING(model) JOIN research_revision v USING(model)
            LEFT JOIN research_expiry e USING(model,provider)
            WHERE (e.expires IS NULL OR e.expires>unixepoch()) AND access='public_free' AND checked>0 AND v.version=? ORDER BY checked""",(RESEARCH_VERSION,)):
        key = provider_id(row["provider"], row["provider_name"], row["source"])
        if not registration_excluded(key):
            providers.setdefault(key, row["provider_name"])
    return providers


class Hub:
    def __init__(self, path):
        self.path = Path(path)

    @contextmanager
    def database(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=8)
        try:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA foreign_keys = ON")
            db.executescript(SCHEMA + hub_runtime.SCHEMA)
            with db:
                yield db
        finally:
            db.close()

    def record_catalog(self, models, error=None):
        now = int(time.time())
        with self.database() as db:
            db.execute("""INSERT INTO catalog_state VALUES(1,?,?,?)
                ON CONFLICT(id) DO UPDATE SET attempted=excluded.attempted,
                succeeded=coalesce(excluded.succeeded,succeeded),error=excluded.error""",
                       (now, None if error else now, error))
            if error is None:
                db.execute("DELETE FROM candidates")
                db.executemany("INSERT INTO candidates VALUES(?,?)", models)

    async def refresh(self, client):
        try:
            response = await client.get(CATALOG)
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
                raise ValueError("catalog format")
            rows = payload["data"]
            if not rows or not all(valid_catalog_record(item) for item in rows):
                raise ValueError("incomplete catalog")
            for row in rows:
                # An explicitly empty tier list has exactly the base prices.
                if row["pricing"].get("overrides") == []:
                    row["pricing"].pop("overrides")
            models = [(m["id"], m["name"]) for m in catalog_rows(payload).values() if m["free"]]
        except httpx.HTTPStatusError as exc:
            error = f"HTTP {exc.response.status_code}"
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            error = "Каталог недоступен или ответ имеет неизвестный формат"
        else:
            await run_in_threadpool(self.record_catalog, models)
            return True
        await run_in_threadpool(self.record_catalog, [], error)
        return False

    def save_key(self, provider, label, key):
        if not isinstance(provider, str) or not re.fullmatch(r"[a-z][a-z0-9-]{0,62}", provider):
            raise ValueError("Неизвестный поставщик")
        if not isinstance(label, str) or not 1 <= len(label.strip()) <= 70 or not label.isprintable():
            raise ValueError("Укажите метку ключа")
        if not isinstance(key, str) or not 10 <= len(key) <= 2048 or not all(32 < ord(c) < 127 for c in key):
            raise ValueError("Некорректный ключ")
        label = label.strip()
        cipher = vault_cipher()
        with self.database() as db:
            db.execute("BEGIN IMMEDIATE")
            previous = db.execute("SELECT id FROM hub_keys WHERE provider=? AND label=?", (provider,label)).fetchone()
            if not previous and provider not in registration_providers(db):
                raise ValueError("У поставщика нет подходящего бесплатного тарифа")
            kid = previous["id"] if previous else uuid4().hex
            nonce = os.urandom(12)
            aad = json.dumps(["model-hub", provider, kid]).encode()
            sealed = nonce + cipher.encrypt(nonce, key.encode(), aad)
            db.execute("""INSERT INTO hub_keys VALUES(?,?,?,?)
                ON CONFLICT(provider,label) DO UPDATE SET sealed=excluded.sealed""", (kid,provider,label,sealed))
            if previous:
                hub_runtime.invalidate(db,kid)
            if previous and provider == "cloudflare":
                db.execute("DELETE FROM hub_cloudflare_accounts WHERE key_id=?", (kid,))

    def save_cloudflare_account(self, key_id, account_id, *, expected_sealed=None):
        if not isinstance(account_id, str) or not re.fullmatch(r"[0-9A-Fa-f]{32}", account_id.strip()):
            raise ValueError("Account ID должен содержать 32 шестнадцатеричных символа")
        with self.database() as db:
            db.execute("BEGIN IMMEDIATE")
            key = db.execute("SELECT sealed FROM hub_keys WHERE id=? AND provider='cloudflare'", (key_id,)).fetchone()
            if key is None:
                raise ValueError("Выберите сохранённый ключ Cloudflare")
            if expected_sealed is not None and key["sealed"] != expected_sealed:
                raise ValueError("Ключ Cloudflare изменился во время проверки")
            db.execute("DELETE FROM hub_health WHERE key_id=?",(key_id,))
            db.execute("DELETE FROM hub_text_health WHERE key_id=?",(key_id,))
            db.execute("""INSERT INTO hub_cloudflare_accounts(key_id, account_id) VALUES(?,?)
                ON CONFLICT(key_id) DO UPDATE SET account_id=excluded.account_id""",
                       (key_id, account_id.strip().lower()))

    def key_control(self,key_id,action):
        if action not in ("disable","enable","revoke","google-private","google-public"):
            raise ValueError("Неизвестное действие")
        with self.database() as db:
            db.execute("BEGIN IMMEDIATE")
            k=db.execute("SELECT provider FROM hub_keys WHERE id=?",(key_id,)).fetchone()
            if not k: raise ValueError("Ключ отсутствует")
            if action=="revoke":
                db.execute("DELETE FROM hub_keys WHERE id=?",(key_id,))
                return
            db.execute("INSERT OR IGNORE INTO hub_control(key_id) VALUES(?)",(key_id,))
            if action.startswith("google-"):
                if k[0]!="google": raise ValueError("Только для проекта Google")
                expires=int(time.time())+86400*30 if action=="google-private" else 0
                db.execute("UPDATE hub_control SET private_until=? WHERE key_id=?",(expires,key_id))
            else:
                db.execute("UPDATE hub_control SET enabled=? WHERE key_id=?",(action=="enable",key_id))
            db.execute("DELETE FROM hub_health WHERE key_id=?",(key_id,))
            db.execute("DELETE FROM hub_text_health WHERE key_id=?",(key_id,))

    def dashboard(self):
        with self.database() as db:
            db.execute("BEGIN")
            state = db.execute("SELECT attempted,succeeded,error FROM catalog_state").fetchone()
            monitor = db.execute("SELECT attempted,succeeded,error FROM research_state").fetchone()
            eligible = registration_providers(db)
            keys = [dict(r) for r in db.execute("""SELECT k.id,k.provider,k.label,
                    a.key_id IS NOT NULL AS account_configured, coalesce(c.enabled,1) enabled, coalesce(c.private_until,0) private_until
                FROM hub_keys k LEFT JOIN hub_cloudflare_accounts a ON a.key_id=k.id LEFT JOIN hub_control c ON c.key_id=k.id
                ORDER BY k.provider,k.label""")]
            findings = {}
            for row in db.execute("""SELECT f.*, v.version AS revision, e.expires FROM
                    (SELECT * FROM research UNION ALL SELECT * FROM research_alternatives) f
                    LEFT JOIN research_revision v USING(model) LEFT JOIN research_expiry e USING(model,provider) WHERE checked>0 ORDER BY model,provider"""):
                review = dict(row)
                key = provider_id(review["provider"], review["provider_name"], review["source"])
                review["provider"] = key
                if registration_excluded(key):
                    review["finding"] = ENROLLMENT[key]["terms"]
                findings.setdefault(row["model"], []).append(review)
            models = [dict(r) for r in db.execute("SELECT model,name FROM candidates ORDER BY model")]
        provider_names = {k["provider"]: PROVIDERS.get(k["provider"],k["provider"]) for k in keys}
        provider_names.update(eligible)
        configured = {provider_id(k["provider"]) for k in keys}
        now = int(time.time())
        missing = {}
        for item in models:
            mid = item["model"]
            reviews = findings.get(mid, [])
            suppliers = set(MODELS.get(mid.removesuffix(":free"), ()))
            blocked = {p for p in suppliers if registration_excluded(p)}
            for review in reviews:
                key = review["provider"]
                if registration_excluded(key):
                    blocked.add(key)
                if review["access"] != "public_free" or (review["expires"] is not None and review["expires"] <= now):
                    suppliers.discard(key)
                elif review["revision"] == RESEARCH_VERSION:
                    suppliers.add(key)
            candidates = suppliers - blocked
            for key in sorted(candidates - configured):
                missing.setdefault(key, []).append(mid)
            if configured.intersection(suppliers):
                status = "key_saved"
            elif candidates:
                status = "needs_key"
            elif blocked:
                status = "excluded"
            else:
                status = "research"
            item.update(providers=sorted(suppliers), research=reviews[0] if reviews else None,
                        findings=reviews, status=status)
        enrollment = [dict(row, configured=row["id"] in configured) for row in ENROLLMENT.values()]
        return dict(catalog=dict(state) if state else None, monitor=dict(monitor) if monitor else None,
                    providers=provider_names, registration_providers=eligible, keys=keys, models=models, missing=missing, enrollment=enrollment)


def routes(get_token, body):
    async def dashboard(req):
        token = get_token(req, allow_cookie=True)
        if not await run_in_threadpool(req.app.state.identity.is_admin, token):
            raise HTTPException(403, "Administrator required")
        hub = req.app.state.model_hub
        if req.method == "POST":
            try:
                if req.url.path.endswith("/control"):
                    fields = await body(req,"action")
                    await run_in_threadpool(hub.key_control,req.path_params["key_id"],fields["action"])
                elif "key_id" in req.path_params:
                    fields = await body(req, "account_id")
                    await run_in_threadpool(hub.save_cloudflare_account,
                                           req.path_params["key_id"], fields["account_id"])
                else:
                    fields = await body(req, "provider", "label", "key")
                    await run_in_threadpool(hub.save_key, **fields)
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from None
        data = await run_in_threadpool(hub.dashboard)
        runtime = getattr(req.app.state.model_router,"hub",None)
        if runtime:
            data.update(await run_in_threadpool(runtime.summary))
        return JSONResponse(data)
    return [Route("/api/admin/model-hub", dashboard),
            Route("/api/admin/model-hub/keys", dashboard, methods=["POST"]),
            Route("/api/admin/model-hub/keys/{key_id}/control", dashboard, methods=["POST"]),
            Route("/api/admin/model-hub/keys/{key_id}/cloudflare-account", dashboard, methods=["POST"])]

def provider_http(*, timeout):
    proxy = os.getenv("HARNESS_MODEL_EGRESS_PROXY", "").strip()
    if not proxy and os.getenv("HARNESS_MODEL_EGRESS_REQUIRED") == "1":
        raise RuntimeError("Model providers require an outbound router")
    return httpx.AsyncClient(
        proxy=proxy or None, timeout=timeout,
        trust_env=False, follow_redirects=False,
        limits=httpx.Limits(max_connections=64, max_keepalive_connections=16),
    )


async def refresh_database(path):
    async with provider_http(timeout=15) as http:
        return await Hub(path).refresh(http)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Update the public candidate catalogue")
    parser.add_argument("--database", type=Path, required=True)
    args = parser.parse_args()
    raise SystemExit(0 if asyncio.run(refresh_database(args.database)) else 1)
