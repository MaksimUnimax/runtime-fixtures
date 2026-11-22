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


def coverage_notes(plan, completed, names):
    """Show period coverage for each current campaign state."""
    from dataset_pipeline import CATALOG, stage_tasks
    from template_catalog import TEMPLATES

    notes = []
    for fragment, result in zip(plan["fragments"], completed, strict=True):
        if fragment["kind"] != "dataset":
            continue
        source = fragment["plan"]
        query_id = source["dataset"]["id"]
        flow = CATALOG["queries"][query_id]["flows"].get("wb", [])
        stage = next((stage for stage in flow if stage["source"] == "ds_wb_adstats"), None)
        if stage is None:
            continue
        template = next(TEMPLATES[tid] for tid in fragment["template_ids"]
                        if TEMPLATES[tid].get("dataset_query") == query_id)
        first, last = source["period"]["from"], source["period"]["to"]
        for store, block in zip(source["stores"], result["data"], strict=True):
            if store["platform"] != "wb":
                continue
            datasets = block["datasets"]
            label = f"Wildberries · {names[store['id']]} · {first} — {last} · {template['purpose']}"
            asked = {str(campaign) for task in stage_tasks(source, store, stage, datasets)
                     for campaign in task["params"]["campaigns"]}
            received = {str(row["campaign_id"]) for row in datasets[stage["id"]]}
            campaigns = datasets["campaigns"]
            active = {str(row["campaign_id"]) for row in campaigns if row["status"] == 9}
            paused = {str(row["campaign_id"]) for row in campaigns if row["status"] == 11}
            archived = {str(row["campaign_id"]) for row in campaigns if row["status"] == 7}
            text = [label + "."]
            groups = [("Активные", active & asked)]
            if query_id == "wb_supported_ads":
                ready = sum(row["status"] == 4 for row in campaigns)
                other = len(campaigns) - len(active | paused | archived) - ready
                text.append(f"Статусы на момент запроса WB — активны {len(active)}, на паузе {len(paused)}, "
                            f"завершены {len(archived)}, готовы к запуску {ready}."
                            + (f" Другие статусы — {other}." if other else ""))
                old_archive = {
                    str(row["campaign_id"]) for row in campaigns
                    if row["status"] == 7 and changed_before(row.get("changed_at"), first)
                }
                groups.extend((("На паузе", paused & asked),
                               ("Завершённые, кроме архива до периода", (archived - old_archive) & asked)))
                if old_archive:
                    text.append(f"Архив до начала периода — {len(old_archive)} кампаний. "
                                f"Строки за период получены по {len(received & old_archive)} из них.")
            for status_label, selected in groups:
                if selected:
                    text.append(f"{status_label} — WB прислал строки по {len(received & selected)} "
                                f"из {len(selected)} кампаний.")
                elif status_label == "Активные":
                    text.append("Активных кампаний в выборке нет.")
            if asked - received:
                text.append("Итоги охватывают полученные строки. По остальным кампаниям статистика отсутствует.")
            notes.append(" ".join(text))
    return notes


def changed_before(value, first):
    """For terminal statuses, use only a verifiable timestamp with timezone."""
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return stamp.tzinfo is not None and stamp.astimezone(ZoneInfo("Europe/Moscow")).date() < date.fromisoformat(first)
    except (AttributeError, TypeError, ValueError, OverflowError):
        return False
