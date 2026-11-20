"""MCP-independent application boundary, tested with explicit synthetic transports."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import hashlib
import json

from config import Config
import connectors
from errors import LabError
from ledger import Ledger

SCHEMA = "harness-lab-tool-result/v1"


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class Application:
    def __init__(self, config_file, state_dir, *, transport=None, ledger=None):
        self.config = Config(config_file)
        self.ledger = ledger or Ledger(state_dir)
        self.transport = transport

    def capabilities(self):
        config = self.config.read()
        counts = self.ledger.counts(config["scope_id"])
        providers = []
        for key, name in (("yandex", "Yandex Wordstat"), ("ozon", "Ozon orders")):
            item = config[key]
            providers.append({"id": key, "name": name, "enabled": item["enabled"],
                              "configuration_status": "operator_enabled" if item["enabled"] else "not_configured",
                              "connection_checked": False,
                              "provider_requests_last_24h": counts.get(key, 0),
                              "max_daily_requests": item.get("max_daily_requests"),
                              "requests_per_call": 1,
                              "setup": ("Доступность ключа, магазина и источника проверяется при бизнес-запросе; флаг включения не доказывает соединение."
                                        if item["enabled"] else "Владелец подключает отдельный credential file на сервере; ключи в чат не отправляются.")})
        return {"schema": SCHEMA, "kind": "capabilities", "data": {"connectors": providers,
                "authorization": "single-owner isolated lab; server-configured connectors only",
                "automatic_retry": False}, "as_of": stamp(), "complete": True}

    async def call(self, tool: str, arguments: dict):
        if tool == "lab_capabilities":
            if arguments:
                raise LabError("UNKNOWN_ARGUMENT")
            return self.capabilities()
        mapping = {"yandex_collect_phrases": ("yandex", connectors.yandex,
                                              {"phrase", "limit", "regions", "device"}),
                   "marketplace_orders_report": ("ozon", connectors.ozon, {"date_from", "date_to", "period"}),
                   "marketplace_stock_snapshot": ("ozon", connectors.ozon_stock_snapshot, set())}
        if tool not in mapping:
            raise LabError("UNKNOWN_TOOL")
        provider, prepare, allowed = mapping[tool]
        if set(arguments) - allowed:
            raise LabError("UNKNOWN_ARGUMENT", "Инструмент не принимает адреса, ключи, аккаунты или другие произвольные параметры.")
        config, settings = self.config.connector(provider)
        prepared = prepare(settings, arguments)
        fingerprint = hashlib.sha256(json.dumps({"tool": tool, "revision": config["revision"],
                    "body": prepared.body, "source": prepared.source, "identity": prepared.identity},
                    ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
        request_id, cached = self.ledger.admit(config["scope_id"], provider, fingerprint, ttl=prepared.ttl,
                                              interval=prepared.interval, maximum=prepared.maximum)
        if cached is not None:
            cached["cache"] = {"hit": True, "acquired_at": cached["as_of"], "ttl_seconds": prepared.ttl}
            cached["execution"] = {"provider_requests_this_call": 0, "automatic_retry": False}
            return cached
        try:
            # Ozon /v1/analytics/data allows at most one request per minute.
            # Never issue a quick intra-call retry on HTTP 429. The durable
            # ledger enforces cooldown before the next explicit call.
            attempts = self.ledger.reserve_attempt(request_id, prepared.maximum)
            raw = await connectors.request_json(prepared, transport=self.transport)
            data = prepared.decoder(raw)
            # The decoder emits a closed projection, never the private HTTP headers/raw envelope.
            timestamp = stamp()
            result = {"schema": SCHEMA, "kind": "data", "data": data, "source": prepared.source,
                      "as_of": timestamp, "complete": True,
                      "cache": {"hit": False, "acquired_at": timestamp, "ttl_seconds": prepared.ttl},
                      "execution": {"provider_requests_this_call": attempts, "automatic_retry": attempts > 1}}
            self.ledger.complete(request_id, result)
            return result
        except LabError as error:
            self.ledger.fail(request_id, error)
            raise
        except asyncio.CancelledError:
            self.ledger.fail(request_id, LabError("CALL_CANCELLED_OUTCOME_UNKNOWN", unknown=True))
            raise
        except Exception:
            # Includes local crashes after HTTP: preserve no-replay, do not guess whether a call happened.
            error = LabError("INTERNAL_OUTCOME_UNKNOWN", "Локальная обработка прервана. Повторный вызов источника автоматически не выполняется.", unknown=True)
            self.ledger.fail(request_id, error)
            raise error from None


def error_result(error: LabError):
    return {"schema": SCHEMA, "kind": "error", "error": error.public(),
            "complete": False, "as_of": stamp()}
