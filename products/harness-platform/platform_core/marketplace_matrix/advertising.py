"""Validate advertising source contracts for the current store and report."""
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
import time
from zoneinfo import ZoneInfo


def descriptors():
    from dataset_pipeline import HASH, SOURCES
    from http_transport import SCALARS
    from registry import REGISTRY_HASH

    return {
        "ds_wb_adstats": {
            "status": "READ_ONLY_CANARY", "registry_hash": REGISTRY_HASH,
            "evidence_ref": "octoport/wb-fullstats-v3", "token_class": "personal",
            "dataset_query_hash": HASH, "dataset_source_hash": SOURCES.hash,
        },
        "ozon_ads_daily": {
            "status": "READ_ONLY_CANARY", "registry_hash": REGISTRY_HASH,
            "evidence_ref": "octoport/ozon-performance-live-contract", "scalar_hash": SCALARS.hash,
        },
    }


def authorize_daily_request(matrix, request, store):
    """Apply the registered provider period policy before qualifying its current reply."""
    from engine import CallError
    from qualification_scope import QualificationError, exact_day, validate_policy

    policy = matrix.recipe(request.operation)["options"]["qualification_scope"]
    try:
        validate_policy(policy)
        if policy["schema"] != "source-contract-scope/v1" or store["currency"] != "RUB":
            raise QualificationError("ADS_CURRENCY")
        start = date.fromisoformat(exact_day(request.body[policy["period_from_field"]]))
        end = date.fromisoformat(exact_day(request.body[policy["period_to_field"]]))
        today = datetime.now(ZoneInfo(policy["business_timezone"])).date()
        if not 1 <= (end - start).days + 1 <= policy["max_period_days"] or (
                policy["completed_periods_only"] and end >= today):
            raise QualificationError("SOURCE_PROOF_PERIOD")
    except (KeyError, QualificationError) as err:
        raise CallError(getattr(err, "code", "SOURCE_PROOF_PERIOD")) from None


def qualify_daily_response(matrix, request, store, data, meta):
    """Only an authenticated, nonempty, bounded and valid reply qualifies this contract."""
    from engine import CallError
    from qualification_scope import QualificationError, check_scope

    recipe = matrix.recipe(request.operation)
    policy = recipe["options"]["qualification_scope"]
    first = request.body[policy["period_from_field"]]
    last = request.body[policy["period_to_field"]]
    rows = data.get("rows") if isinstance(data, dict) else None
    if not isinstance(rows, list) or not rows:
        raise CallError("ADS_EMPTY_UNCONFIRMED", status=meta["status"])
    if len(rows) >= 20_000:
        raise CallError("ADS_POSSIBLE_TRUNCATION", status=meta["status"])
    keys = set()
    try:
        for row in rows:
            raw_day = row["date"]
            try:
                day = date.fromisoformat(raw_day).isoformat()
            except ValueError:
                day = datetime.strptime(raw_day, "%d.%m.%Y").date().isoformat()
            campaign = str(row["id"])
            spent = Decimal(str(row["moneySpent"]).replace(",", "."))
            if not first <= day <= last or not campaign.isascii() or not campaign.isdigit() or (
                    not spent.is_finite()) or (campaign, day) in keys:
                raise ValueError("Invalid daily advertising row")
            keys.add((campaign, day))
    except (InvalidOperation, KeyError, TypeError, ValueError):
        raise CallError("ADS_SCHEMA", status=meta["status"]) from None
    observed = time.time()
    source_hash = matrix.fingerprint(request.operation)
    proof = {**recipe["proof_requirements"], "contract_scopes": [{
        "store_id": store["id"], "identity": store["identity"], "access_revision": store["access_revision"],
        "source_revision": store["source_revision"], "source_hash": source_hash, "observed_at": observed,
        "evidence_ref": "octoport/verified-current-performance-response",
    }]}
    try:
        check_scope(recipe, source_hash, proof, store, request.body, observed)
    except QualificationError as err:
        raise CallError(err.code, status=meta["status"]) from None


def record_campaign_coverage(coverage, request, store, data):
    """Report omissions as unknown, separately from provider-confirmed zero rows."""
    from engine import CallError

    try:
        requested = {int(item) for item in request.body["ids"].split(",")}
        if not isinstance(data, list):
            raise ValueError("Expected one list of campaign stats")
        received = {row["advertId"] for row in data}
        if len(received) != len(data) or not received <= requested:
            raise ValueError("Unexpected campaign identities")
        key = (store["id"], request.body["beginDate"], request.body["endDate"])
    except (KeyError, TypeError, ValueError):
        raise CallError("DATASET_CAMPAIGN_SCOPE") from None
    asked, confirmed, missing = coverage.setdefault(key, (set(), set(), set()))
    asked.update(requested)
    confirmed.update(received)
    missing.update(requested - received)


def coverage_notes(coverage, names):
    notes = []
    for (store_id, first, last), (asked, confirmed, missing) in coverage.items():
        label = f"Wildberries · {names[store_id]} · {first} — {last}"
        if missing:
            notes.append(
                f"{label}: WB прислал показатели по {len(confirmed)} из {len(asked)} запрошенных кампаний. "
                f"Данные по {len(missing)} кампаниям отсутствовали хотя бы в одном ответе. "
                "Итоги охватывают только полученные строки. Полная сумма по выбранным кампаниям неизвестна."
            )
        else:
            notes.append(f"{label}: WB прислал показатели по всем {len(asked)} запрошенным кампаниям.")
    return notes
