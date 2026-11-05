"""Bounded immutable owner-input resolution, independent of platform/UI/storage.

The matrix declares fields, dimensions and bounds. A trusted external authority
must approve the exact content/scope on every action. No implicit defaults,
proration, currency conversion, tariff inference or report execution happens here.
"""
from __future__ import annotations
from copy import deepcopy
from datetime import date
from decimal import Decimal, InvalidOperation
import hashlib
import json
import re
from typing import Any, Callable

HEX = re.compile(r"[a-f0-9]{64}\Z")
IDENT = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}\Z")
FIELD = re.compile(r"[a-z][a-z0-9_]{0,79}\Z")
AMOUNT = re.compile(r"-?\d{1,20}(?:\.\d{1,8})?\Z")


class InputError(ValueError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def need(condition: Any, code: str = "OWNER_INPUT_SCHEMA") -> None:
    if not condition:
        raise InputError(code)


def exact(obj: Any, keys: set[str], code: str = "OWNER_INPUT_SCHEMA") -> None:
    need(type(obj) is dict and set(obj) == keys, code)


def text(value: Any, maximum: int = 300) -> bool:
    return type(value) is str and 1 <= len(value) <= maximum and all(ord(c) >= 32 for c in value)


def canonical(value: Any) -> bytes:
    try:
        raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    except (TypeError, ValueError, RecursionError):
        raise InputError("OWNER_INPUT_JSON") from None
    need(len(raw) <= 1048576, "OWNER_INPUT_SIZE")
    return raw


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def strict_loads(raw: str) -> Any:
    need(type(raw) is str and len(raw.encode()) <= 1048576, "OWNER_INPUT_SIZE")
    def pairs(items):
        obj = {}
        for key, value in items:
            need(key not in obj, "OWNER_INPUT_DUPLICATE_KEY")
            obj[key] = value
        return obj
    def constant(_):
        raise InputError("OWNER_INPUT_NONFINITE")
    try:
        return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)
    except InputError:
        raise
    except (ValueError, RecursionError):
        raise InputError("OWNER_INPUT_JSON") from None


def amount(value: Any) -> Decimal:
    need(type(value) is str and AMOUNT.fullmatch(value), "OWNER_INPUT_VALUE")
    try:
        result = Decimal(value)
    except InvalidOperation:
        raise InputError("OWNER_INPUT_VALUE") from None
    need(result.is_finite(), "OWNER_INPUT_VALUE")
    return result


def period(value: Any) -> tuple[int, int]:
    exact(value, {"from", "to"}, "OWNER_INPUT_PERIOD")
    ordinals = []
    for key in ("from", "to"):
        v = value[key]
        need(type(v) is str and len(v) == 10, "OWNER_INPUT_PERIOD")
        try:
            parsed = date.fromisoformat(v)
        except ValueError:
            raise InputError("OWNER_INPUT_PERIOD") from None
        need(parsed.isoformat() == v, "OWNER_INPUT_PERIOD")
        ordinals.append(parsed.toordinal())
    need(ordinals[0] <= ordinals[1], "OWNER_INPUT_PERIOD")
    return ordinals[0], ordinals[1]


class OwnerInputs:
    """Stateless resolver. A snapshot is a bounded input, not an append-only log.

    authorize(metadata, request, action) -> literal True. Metadata includes the
    computed content hash. This callback owns identity, approval, mapping,
    revisions and revocation. The supplied scope_hash is not self-authorizing.
    """
    def __init__(self, catalog: dict):
        canonical(catalog)
        exact(catalog, {"schema", "version", "max_entries", "max_period_days", "max_segments", "fields"})
        need(catalog["schema"] == "alice-owner-input-catalog/v1" and text(catalog["version"], 80))
        for name, upper in (("max_entries", 5000), ("max_period_days", 366), ("max_segments", 2048)):
            need(type(catalog[name]) is int and 1 <= catalog[name] <= upper)
        fields = catalog["fields"]
        need(type(fields) is dict and 1 <= len(fields) <= 64)
        for field, rule in fields.items():
            need(type(field) is str and FIELD.fullmatch(field))
            exact(rule, {"label", "unit", "mode", "minimum", "maximum", "allow_exclusion", "omission_label"})
            need(text(rule["label"], 160) and text(rule["omission_label"], 300))
            need(type(rule["unit"]) is str and FIELD.fullmatch(rule["unit"]))
            need(rule["mode"] in ("effective_date", "exact_period"))
            need(type(rule["allow_exclusion"]) is bool)
            need(amount(rule["minimum"]) <= amount(rule["maximum"]), "OWNER_INPUT_BOUNDS")
        self._catalog = deepcopy(catalog)
        self.hash = digest(catalog)

    @property
    def catalog(self) -> dict:
        return deepcopy(self._catalog)

    def _validate(self, envelope: dict, request: dict, now: int) -> tuple[dict, dict]:
        canonical(envelope)
        exact(envelope, {"payload", "sha256"})
        payload = envelope["payload"]
        need(type(envelope["sha256"]) is str and HEX.fullmatch(envelope["sha256"]), "OWNER_INPUT_HASH")
        need(digest(payload) == envelope["sha256"], "OWNER_INPUT_HASH")
        exact(payload, {"schema", "revision", "scope_hash", "catalog_hash", "issued_at", "expires_at", "entries"})
        need(payload["schema"] == "alice-owner-input-snapshot/v1")
        need(type(payload["revision"]) is str and IDENT.fullmatch(payload["revision"]))
        need(type(payload["scope_hash"]) is str and HEX.fullmatch(payload["scope_hash"]), "OWNER_INPUT_SCOPE")
        need(payload["catalog_hash"] == self.hash, "OWNER_INPUT_CATALOG")
        for v in (now, payload["issued_at"], payload["expires_at"]):
            need(type(v) is int and v >= 0, "OWNER_INPUT_CLOCK")
        need(payload["issued_at"] <= now < payload["expires_at"] and
             0 < payload["expires_at"] - payload["issued_at"] <= 86400, "OWNER_INPUT_EXPIRED")
        exact(request, {"scope_hash", "entity", "currency", "period", "fields"}, "OWNER_INPUT_REQUEST")
        need(request["scope_hash"] == payload["scope_hash"], "OWNER_INPUT_SCOPE")
        need(type(request["entity"]) is str and IDENT.fullmatch(request["entity"]), "OWNER_INPUT_ENTITY")
        need(type(request["currency"]) is str and re.fullmatch(r"[A-Z]{3}", request["currency"]), "OWNER_INPUT_CURRENCY")
        a, b = period(request["period"])
        need(b - a + 1 <= self._catalog["max_period_days"], "OWNER_INPUT_PERIOD_LIMIT")
        fields = request["fields"]
        need(type(fields) is list and 1 <= len(fields) <= 64 and
             all(type(f) is str for f in fields), "OWNER_INPUT_FIELDS")
        need(len(set(fields)) == len(fields) and set(fields) <= self._catalog["fields"].keys(), "OWNER_INPUT_FIELDS")
        normalized = deepcopy(request)
        normalized["fields"] = sorted(fields)
        rows = payload["entries"]
        need(type(rows) is list and len(rows) <= self._catalog["max_entries"], "OWNER_INPUT_CAPACITY")
        keys, groups = set(), {}
        for row in rows:
            exact(row, {"id", "field", "entity", "currency", "period", "state", "value"})
            need(type(row["id"]) is str and IDENT.fullmatch(row["id"]))
            need(row["id"] not in keys, "OWNER_INPUT_DUPLICATE_ID")
            keys.add(row["id"])
            need(type(row["field"]) is str and row["field"] in self._catalog["fields"], "OWNER_INPUT_FIELDS")
            need(type(row["entity"]) is str and IDENT.fullmatch(row["entity"]), "OWNER_INPUT_ENTITY")
            need(type(row["currency"]) is str and re.fullmatch(r"[A-Z]{3}", row["currency"]), "OWNER_INPUT_CURRENCY")
            x, y = period(row["period"])
            rule = self._catalog["fields"][row["field"]]
            need(row["state"] in ("VALUE", "EXCLUDED_BY_OWNER", "NOT_PROVIDED"), "OWNER_INPUT_STATE")
            if row["state"] == "VALUE":
                val = amount(row["value"])
                need(amount(rule["minimum"]) <= val <= amount(rule["maximum"]), "OWNER_INPUT_BOUNDS")
            else:
                need(row["value"] is None, "OWNER_INPUT_MISSING_NOT_ZERO")
                need(row["state"] != "EXCLUDED_BY_OWNER" or rule["allow_exclusion"], "OWNER_INPUT_EXCLUSION")
            # A second currency is not a second candidate for the same input.
            groups.setdefault((row["field"], row["entity"]), []).append((x, y))
        for intervals in groups.values():
            last_end = 0
            for begin, end in sorted(intervals):
                need(begin > last_end, "OWNER_INPUT_OVERLAP")
                last_end = end
        return deepcopy(payload), normalized

    def resolve(self, envelope: dict, request: dict, *, authorize: Callable | None,
                now: int, action: str = "resolve", pin: dict | None = None) -> dict:
        need(action in ("resolve", "execute", "read"), "OWNER_INPUT_ACTION")
        envelope = strict_loads(canonical(envelope).decode())
        request = strict_loads(canonical(request).decode())
        payload, req = self._validate(envelope, request, now)
        binding = {"catalog_hash": self.hash, "facts_sha256": envelope["sha256"],
                   "revision": payload["revision"], "request_sha256": digest(req)}
        if pin is not None:
            need(type(pin) is dict and canonical(pin) == canonical(binding), "OWNER_INPUT_PIN_CHANGED")
        need(callable(authorize), "OWNER_INPUT_AUTH_REQUIRED")
        metadata = {**binding, "scope_hash": payload["scope_hash"],
                    "issued_at": payload["issued_at"], "expires_at": payload["expires_at"]}
        try:
            allowed = authorize(deepcopy(metadata), deepcopy(req), action)
        except Exception:
            raise InputError("OWNER_INPUT_AUTH_UNAVAILABLE") from None
        need(allowed is True, "OWNER_INPUT_AUTH_DENIED")
        a, b = period(req["period"])
        outputs, count, missing = {}, 0, False
        for field in req["fields"]:
            rule = self._catalog["fields"][field]
            rows = [r for r in payload["entries"] if r["field"] == field and r["entity"] == req["entity"]
                    and period(r["period"])[0] <= b and period(r["period"])[1] >= a]
            need(all(r["currency"] == req["currency"] for r in rows), "OWNER_INPUT_CURRENCY")
            if rule["mode"] == "exact_period":
                matches = [r for r in rows if r["period"] == req["period"]]
                chunks = [(a, b, matches[0] if matches else None,
                           "PERIOD_ALLOCATION_REQUIRED" if rows and not matches else "NOT_PROVIDED")]
            else:
                cuts = sorted({a, b + 1} | {max(a, period(r["period"])[0]) for r in rows} |
                              {min(b + 1, period(r["period"])[1] + 1) for r in rows})
                chunks = []
                for start, end in zip(cuts, cuts[1:]):
                    row = next((r for r in rows if period(r["period"])[0] <= start <= period(r["period"])[1]), None)
                    chunks.append((start, end - 1, row, "NOT_PROVIDED"))
            segments = []
            for start, end, row, absent in chunks:
                count += 1
                need(count <= self._catalog["max_segments"], "OWNER_INPUT_CAPACITY")
                state = row["state"] if row else "NOT_PROVIDED"
                missing |= state != "VALUE"
                segments.append({"period": {"from": date.fromordinal(start).isoformat(), "to": date.fromordinal(end).isoformat()},
                                 "state": state, "value": row["value"] if row else None,
                                 "unit": rule["unit"], "currency": req["currency"],
                                 "entry_id": row["id"] if row else None,
                                 "reason": None if state == "VALUE" else state if row else absent})
            outputs[field] = {"label": rule["label"], "unit": rule["unit"], "mode": rule["mode"],
                              "omission_label": rule["omission_label"], "segments": segments}
        result = {"schema": "alice-owner-input-resolution/v1", "status": "RESOLVED_WITH_OMISSIONS" if missing else "RESOLVED",
                  "pin": binding, "scope_hash": req["scope_hash"], "entity": req["entity"], "period": req["period"],
                  "fields": outputs, "network_calls": 0, "report_saved": False}
        return {**result, "resolution_sha256": digest(result)}
