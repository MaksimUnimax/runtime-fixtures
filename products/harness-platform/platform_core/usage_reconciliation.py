"""Reconcile an immutable snapshot of a native gateway JSONL journal offline."""

from collections import Counter
from dataclasses import dataclass, field
from decimal import Decimal, DecimalException
from hashlib import sha256
import json
import re


RATE_KEYS = ("input", "cache", "output")
TOKEN_KEYS = ("input_tokens", "cache_read_input_tokens", "output_tokens",
              "cache_creation_input_tokens")
MAX_TOKENS = 2**53 - 1
ZERO = Decimal(0)
ATTRIBUTION_KEYS = ("workspace_id", "operation_id", "source")
OPERATION_ID = re.compile(r"[0-9a-f]{32}")
OPERATION_SOURCE = re.compile(r"[a-z][a-z0-9_.-]{0,63}")


def unique_keys(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate key")
        value[key] = item
    return value


def invalid_constant(_):
    raise ValueError("invalid JSON number")


def parse(line):
    return json.loads(line, object_pairs_hook=unique_keys,
                      parse_float=Decimal, parse_constant=invalid_constant)


def number(value, *, allow_text=False, amount=False):
    if type(value) not in (int, Decimal) and not (allow_text and isinstance(value, str)):
        raise ValueError("expected decimal")
    try:
        result = Decimal(value)
    except DecimalException as exc:
        raise ValueError("invalid decimal") from exc
    if not result.is_finite() or result < 0:
        raise ValueError("expected a finite nonnegative decimal")
    if result.is_zero():
        return ZERO
    # Strip insignificant zeros without rounding; JSON 0.10 and 0.1 are equal.
    sign, digits, exponent = result.as_tuple()
    end = len(digits)
    while digits[end - 1] == 0:
        end -= 1
    exponent += len(digits) - end
    digits = digits[:end]
    result = Decimal((sign, digits, exponent))
    # Peak estimates may have more places than either a unit rate or the FX.
    digits_limit, exponent_min, magnitude_max = (140, -200, 130) if amount else (40, -60, 40)
    if len(digits) > digits_limit or exponent < exponent_min or result.adjusted() > magnitude_max:
        raise ValueError("decimal outside supported range")
    return result


def rates(obj, *, allow_text=False):
    if not isinstance(obj, dict) or set(obj) != set(RATE_KEYS):
        raise ValueError("invalid rates")
    return tuple(number(obj[key], allow_text=allow_text) for key in RATE_KEYS)


def read_tariffs(path):
    manifest = parse(path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or manifest.get("schema") != "usage-tariffs/v1":
        raise ValueError("invalid manifest")
    versions = manifest.get("versions")
    if not isinstance(versions, dict) or not versions:
        raise ValueError("invalid versions")
    lookup = {}
    for version, entry in versions.items():
        models = entry.get("models") if isinstance(entry, dict) else None
        if not version or not isinstance(models, dict) or not models:
            raise ValueError("invalid models")
        for model, price in models.items():
            if not model:
                raise ValueError("invalid model")
            lookup[version, model] = rates(price, allow_text=True)
    return lookup


def canonical(value):
    """Canonical JSON for equality across key order and numeric spellings."""
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(k) + ":" + canonical(value[k]) for k in sorted(value)) + "}"
    if isinstance(value, list):
        return "[" + ",".join(canonical(item) for item in value) + "]"
    if type(value) in (int, Decimal):
        # Avoid decimal-context rounding or expanding 1e99999 when hashing.
        sign, digits, exponent = Decimal(value).as_tuple()
        digits = "".join(map(str, digits))
        if not digits.strip("0"):
            return "0"
        trimmed = digits.rstrip("0")
        return ("-" if sign else "") + trimmed + "e" + str(exponent + len(digits) - len(trimmed))
    return json.dumps(value)


@dataclass
class Phase:
    event: dict
    fingerprints: set = field(default_factory=set)
    duplicates: int = 0


def index_journal(path, *, operation_claims=None):
    attempts = {}
    duplicates = 0
    with path.open("rb") as stream:
        for line_num, line in enumerate(stream, 1):
            try:
                event = parse(line.decode("utf-8"))
                if not isinstance(event, dict) or event.get("schema") != "harness-lab-model-attempt/v1":
                    raise ValueError("unsupported event schema")
                phase_name = event.get("event")
                attempt_id = event.get("attempt_id")
                if phase_name not in ("admitted", "finished") or not isinstance(attempt_id, str) or not attempt_id:
                    raise ValueError("invalid event envelope")
                fingerprint = sha256(canonical(event).encode("ascii")).digest()
            except (ValueError, DecimalException, RecursionError) as exc:
                raise ValueError(f"invalid journal record at line {line_num}") from exc
            if operation_claims is not None:
                scope = event.get("attribution")
                operation = scope.get("operation_id") if isinstance(scope, dict) else None
                if isinstance(operation, str) and OPERATION_ID.fullmatch(operation):
                    operation_claims.setdefault(attempt_id, set()).add(operation)
            phases = attempts.setdefault(attempt_id, {})
            if phase_name not in phases:
                phases[phase_name] = Phase(event)
            phase = phases[phase_name]
            if fingerprint in phase.fingerprints:
                duplicates += 1
                phase.duplicates += 1
            phase.fingerprints.add(fingerprint)
    return attempts, duplicates


def agrees(stored, calculated):
    try:
        quoted = number(stored, amount=True)
    except ValueError:
        return False
    # Gateway v1 uses binary64. Multiplication, addition and FX conversion
    # can move the last digits. A zero quote must still match zero exactly.
    return abs(quoted - calculated) <= calculated * Decimal("2e-15")


def nonnegative_integer(value, maximum):
    if type(value) is int:
        return 0 <= value <= maximum
    return (isinstance(value, Decimal) and 0 <= value <= maximum
            and value == value.to_integral_value())


def verified_amounts(phases, tariffs):
    if any(len(phase.fingerprints) != 1 for phase in phases.values()):
        return None, None, "conflicting_events"
    if "admitted" not in phases:
        return None, None, "missing_admission"
    if "finished" not in phases:
        return None, None, "missing_finish"
    start = phases["admitted"].event
    end = phases["finished"].event
    session = start.get("session_id")
    if (not isinstance(start.get("model"), str) or not start["model"]
            or not isinstance(start.get("purpose"), str) or not start["purpose"]
            or "session_id" not in start or (session is not None and not isinstance(session, str))):
        return None, None, "invalid_identity"
    # Gateway v1 copies all admission metadata into its terminal record.
    for key in ("model", "purpose", "session_id", "started_at", "started_ms",
                "thinking", "effort", "max_tokens", "messages", "tools", "attribution"):
        if (key in start) != (key in end) or canonical(start.get(key)) != canonical(end.get(key)):
            return None, None, "identity_mismatch"
    status = end.get("status")
    if end.get("outcome") != "completed" or not nonnegative_integer(status, 299) or status < 200:
        return None, None, "incomplete_outcome"
    if end.get("partial_usage") is not None:
        return None, None, "ambiguous_usage"
    usage = end.get("usage")
    if not isinstance(usage, dict) or any(
        not nonnegative_integer(usage.get(k), MAX_TOKENS) for k in TOKEN_KEYS
    ):
        return None, None, "invalid_usage"
    if usage["cache_creation_input_tokens"]:
        return None, None, "unpriced_cache_creation"
    quote = end.get("quote")
    if not isinstance(quote, dict) or quote.get("quote_kind") != "conservative_peak_estimate":
        return None, None, "unavailable_quote"
    model = end.get("response_model")
    if model is None or model == "":
        model = start["model"]
    version = quote.get("pricing_version")
    if not isinstance(model, str) or not isinstance(version, str) or (version, model) not in tariffs:
        return None, None, "unknown_tariff"
    price = tariffs[version, model]
    try:
        journal_rates = rates(quote.get("prices_usd_per_million"))
    except ValueError:
        return None, None, "invalid_quoted_rates"
    if journal_rates != price:
        return None, None, "tariff_mismatch"
    input_rate, cache_rate, output_rate = price
    usd = (int(usage["input_tokens"]) * input_rate
           + int(usage["cache_read_input_tokens"]) * cache_rate
           + int(usage["output_tokens"]) * output_rate) / 1_000_000
    if not agrees(quote.get("usd_peak_estimate"), usd):
        return None, None, "usd_mismatch"
    if quote.get("fx_rub_per_usd") is None:
        reason = "missing_fx" if quote.get("rub_peak_estimate") is None else "rub_without_fx"
        return usd, None, reason
    try:
        fx = number(quote["fx_rub_per_usd"])
    except ValueError:
        return usd, None, "invalid_fx"
    if not fx:
        return usd, None, "invalid_fx"
    rub = usd * fx
    if not agrees(quote.get("rub_peak_estimate"), rub):
        return usd, None, "rub_mismatch"
    return usd, rub, None


def money(value):
    if not value:
        return "0"
    return format(value.normalize(), "f")


def reconcile(attempts, duplicates, tariffs):
    known_usd = known_rub = ZERO
    usd_count = rub_count = 0
    issues = Counter()
    for phases in attempts.values():
        usd, rub, issue = verified_amounts(phases, tariffs)
        if issue:
            issues[issue] += 1
        if usd is not None:
            known_usd += usd
            usd_count += 1
        if rub is not None:
            known_rub += rub
            rub_count += 1
    if not attempts:
        issues["empty_journal"] = 1
    return {
        "schema": "usage-reconciliation/v1", "basis": "conservative_peak_estimate",
        "status": "partial" if issues else "complete", "unique_attempts": len(attempts),
        "duplicate_events": duplicates, "verified_usd_attempts": usd_count,
        "verified_rub_attempts": rub_count, "known_usd": money(known_usd),
        "known_rub": money(known_rub),
        "total_usd": money(known_usd) if attempts and usd_count == len(attempts) else None,
        "total_rub": money(known_rub) if attempts and rub_count == len(attempts) else None,
        "issues": dict(sorted(issues.items())),
    }


def operation_key(phases):
    """Return a trusted group key, or the reason this attempt is unassigned."""
    if any(len(phase.fingerprints) != 1 for phase in phases.values()):
        return None, "conflicting_events"
    events = [phase.event for phase in phases.values()]
    scopes = [event["attribution"] for event in events if "attribution" in event]
    if not scopes:
        return None, "missing_attribution"
    if len(scopes) != len(events) or any(scope != scopes[0] for scope in scopes[1:]):
        return None, "attribution_mismatch"
    scope = scopes[0]
    if not isinstance(scope, dict) or set(scope) != set(ATTRIBUTION_KEYS):
        return None, "invalid_attribution"
    workspace, operation, source = (scope[key] for key in ATTRIBUTION_KEYS)
    if (not isinstance(workspace, str) or not 1 <= len(workspace) <= 256
            or "\x00" in workspace or workspace != workspace.strip()
            or not isinstance(operation, str) or not OPERATION_ID.fullmatch(operation)
            or not isinstance(source, str) or not OPERATION_SOURCE.fullmatch(source)):
        return None, "invalid_attribution"
    return (workspace, operation, source), None


def attribution_summary(attempts, tariffs):
    groups = {}
    issues = Counter()
    for attempt_id, phases in attempts.items():
        key, issue = operation_key(phases)
        if issue:
            issues[issue] += 1
        else:
            groups.setdefault(key, {})[attempt_id] = phases
    # The product store gives each operation ID one workspace and one source.
    # Count distinct bindings before emitting any group so input order cannot decide ownership.
    binding_counts = Counter(operation for _, operation, _ in groups)
    operations = []
    for key, members in sorted(groups.items()):
        if binding_counts[key[1]] != 1:
            issues["operation_binding_conflict"] += len(members)
            continue
        duplicates = sum(phase.duplicates for phases in members.values() for phase in phases.values())
        operations.append({
            **dict(zip(ATTRIBUTION_KEYS, key)),
            **reconcile(members, duplicates, tariffs),
        })
    unassigned = sum(issues.values())
    if not attempts:
        issues["empty_journal"] = 1
    return {
        "status": "partial" if issues else "complete",
        "assigned_attempts": len(attempts) - unassigned,
        "unassigned_attempts": unassigned,
        "issues": dict(sorted(issues.items())),
        "operations": operations,
    }
