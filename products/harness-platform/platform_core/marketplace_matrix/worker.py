"""Run the registered template compiler, HTTP recipes and renderer in an isolated process."""
from contextlib import redirect_stdout
from contextvars import copy_context
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import sys
import tarfile
import time
from types import SimpleNamespace
from zoneinfo import ZoneInfo


from .authority import ChatAuthority
from . import advertising, campaign_inventory, forecast_preview, ozon_retry, store_currency

BUNDLE = Path(__file__).with_name("runtime.tar.gz")
BUNDLE_SHA256 = "b9cb1daec21a7edcf4c6270324d6f9bbac94302b04f07139b2fae68db3fefd5d"


def log_failure(operation, code, retry_at=None):
    """Keep diagnostic codes in the service journal without seller data."""
    try:
        import syslog
        message = {"event": "octoport.matrix.failure", "operation": operation, "code": code}
        if retry_at is not None:
            message["retryAt"] = retry_at
        syslog.syslog(syslog.LOG_WARNING, json.dumps(message, allow_nan=False))
    except (ImportError, OSError, ValueError):
        pass


def unpack(directory):
    if hashlib.sha256(BUNDLE.read_bytes()).hexdigest() != BUNDLE_SHA256:
        raise RuntimeError("Unexpected marketplace runtime")
    with tarfile.open(BUNDLE) as archive:
        archive.extractall(directory, filter="data")
    sys.path.insert(0, str(directory))


def configure_catalogue(engine, fields, authority=None):
    from dataset_pipeline import SOURCES as DATASET_SOURCES, CATALOG as DATASET_CATALOG, operations as dataset_operations
    from http_transport import MATRICES, SCALARS, SCALAR_SOURCES
    from platform_store_credentials import required_fields
    import parameter_source_runtime
    from template_catalog import TEMPLATES, dependencies
    proofs = json.loads(Path(sys.path[0], "source_qualifications.json").read_bytes())
    proofs.update(advertising.descriptors())
    caps = {cid: proofs for cid in fields}
    engine.parameter_source_policy = {"enabled": True, "pin": parameter_source_runtime.PIN}
    forecast_preview.configure(engine, authority)
    engine.table_capabilities = engine.dataset_capabilities = lambda: caps

    def supported(template, store):
        for dependency in dependencies(template["id"]):
            entry = TEMPLATES[dependency]
            if entry["kind"] == "parameter" or entry.get("parameter_report"):
                needed = {"seller_client_id", "seller_api_key"}
                if entry.get("parameter_report") == "economics.unit_forecast.v1":
                    needed |= {"performance_client_id", "performance_client_secret"}
                if not needed.issubset(fields[store.id]):
                    return False
            if query := entry.get("dataset_query"):
                flows = DATASET_CATALOG["queries"][query]["flows"]
                if store.platform not in flows:
                    return False
                for operation in dataset_operations(query, store.platform):
                    if not required_fields(DATASET_SOURCES.recipe(operation)).issubset(fields[store.id]):
                        return False
            for step in entry["steps"]:
                op = step.get("operation")
                if step.get("platform") != store.platform or op not in MATRICES:
                    continue
                recipe = MATRICES[op].recipe(op)
                needed = required_fields(recipe)
                if op == "ozon_ads_daily":
                    needed |= {"seller_api_key", "seller_client_id"}
                profile = SCALARS.profile_for(op)
                if profile:
                    grant_op = SCALARS.auth[profile]["operation"]
                    if grant_op not in proofs:
                        return False
                    needed |= required_fields(SCALAR_SOURCES.recipe(grant_op))
                if op not in proofs or not needed.issubset(fields[store.id]):
                    return False
        return True
    engine.store_template_available = supported
    return proofs


def catalogue(profiles):
    from template_catalog import discovery
    from semantics import Scope, Store

    # This is static discovery on credential types. No account data or keys go to this process.
    stores = tuple(Store(key, provider, key, "", "") for key, provider, _ in profiles)
    fields = {key: set(names) for key, _, names in profiles}
    engine = SimpleNamespace()
    configure_catalogue(engine, fields)
    return [row for row in discovery(engine, Scope("", "", stores))
            if row["available_stores"] and row["id"] not in campaign_inventory.TEMPLATES
            ] + list(campaign_inventory.catalogue(profiles))


def formula_inputs(plan, completed, names):
    """Pass through the verified inputs used by the renderer before output rounding."""
    from registry import DEFINITIONS
    from template_catalog import TEMPLATES
    inputs = []
    for fragment, item in zip(plan.get("fragments", []), completed):
        if fragment["kind"] != "scalar" or not any(
                TEMPLATES[tid]["kind"] == "formula" for tid in fragment["template_ids"]):
            continue
        source = fragment["plan"]
        for store, result in zip(source["stores"], item["data"], strict=True):
            for slot, bucket, period_key in (("current", "values", "period"),
                                            ("previous", "previous_values", "comparison")):
                required = source["program"]["required"][slot]
                if not required:
                    continue
                values = []
                for metric in required:
                    definition = DEFINITIONS[metric]
                    unit = definition["unit"]
                    if unit in ("currency", "source_currency"):
                        unit = result["currency"]
                    values.append({"label": definition["label"], "value": result[bucket][metric], "unit": unit})
                inputs.append({"marketplace": store["platform"], "store": names[store["id"]],
                               "period": source[period_key], "values": values})
    return inputs


def pending_result(repo, row):
    # The scheduler persists the exact provider deadline on the job and its source.
    # Look at that source's latest receipt, so an earlier failure in another part
    # of a compound report cannot change the explanation.
    with repo.connection() as db:
        receipts = db.execute("""
            SELECT c.state, c.http FROM rates r JOIN calls c ON c.id = (
                SELECT MAX(id) FROM calls WHERE jid = ? AND source = r.source
            ) WHERE r.not_before = ?
        """, (row["id"], row["due"])).fetchall()
    code = None
    if len(receipts) == 1 and receipts[0]["state"] in ("UNKNOWN", "HTTP_ERROR"):
        status = receipts[0]["http"]
        if status == 429:
            code = "HTTP_429"
        elif status is not None and 500 <= status < 600:
            code = "PROVIDER_SERVER_ERROR"
        else:
            code = "PROVIDER_READ_UNAVAILABLE"
    return store_currency.wait_result(row["due"], code)


def execute(packet, directory):
    from direct_response import answer_step
    from engine import CallError, Engine, Worker
    from failure_explanations import explain
    from http_transport import HTTPTransport
    from parameter_source_runtime import required_operations
    import read_surface
    import model_answer
    from repository import Repository
    from semantics import Rejected, fingerprint
    from template_catalog import HASH, TEMPLATES, dependencies, _availability
    from template_runtime import submit

    authority = ChatAuthority(packet)
    turn, pins = packet["turn"], authority.pins
    guard = {"pins": pins}
    repo = Repository(str(directory / "requests.sqlite"))
    engine = Engine(repo, lambda tenant: authority.scope_for(guard), execution_policy=authority, template_mode=True)
    allowed = {store.id: store for store in authority.scope_for(guard).stores}
    fields = {cid: authority.field_names(store) for cid, store in allowed.items()}
    proofs = configure_catalogue(engine, fields, authority)
    calls = []
    inventories = []
    for index, item in enumerate(packet["selections"], 1):
        tid, cid = item["templateId"], item["connectionId"]
        if tid in campaign_inventory.TEMPLATES:
            platform = campaign_inventory.TEMPLATES[tid]
            store = allowed.get(cid)
            if not store or store.platform != platform or not campaign_inventory.FIELDS[platform] <= fields[cid]:
                raise Rejected("SOURCE_ACCESS")
            inventories.append((tid, store, campaign_inventory.scope_for(platform, item["input"])))
            continue
        if tid not in TEMPLATES or cid not in allowed or not _availability(engine, TEMPLATES[tid], allowed[cid]):
            raise Rejected("SOURCE_ACCESS")
        inputs = item["input"]
        if inputs.get("parameter_mode", "preview") != "preview":
            raise Rejected("PERMISSION_DENIED")
        if inputs.get("owner_inputs") and tid != "economics.unit_forecast.v1":
            raise Rejected("ECONOMICS_OWNER_INPUT")
        owner_inputs = inputs.get("owner_inputs", {})
        if tid == "economics.unit_forecast.v1" and not {"unit_cost", "unit_cost_by_sku"} & owner_inputs.keys():
            return {"ok": True, "clarification": "Укажите себестоимость в рублях по SKU или общую для всех товаров."}
        if TEMPLATES[tid].get("parameter_report"):
            inputs = dict(inputs)
            inputs.pop("parameter_mode", None)
            # A projection is compiled separately for each selected store.
            if inputs.get("group_by") == "total":
                inputs["group_by"] = "marketplace"
        calls.append({"id": str(index), "template_id": tid, "store_id": cid, "input": inputs})
    campaign_trace = {"templates": [{"id": tid, "connectionId": store.id, "statuses": selection}
                                    for tid, store, selection in inventories],
                      "operations": [], "rateLimitResponses": 0}
    campaign_reports = [campaign_inventory.report(authority, store, selection, campaign_trace)
                        for _, store, selection in inventories]
    if not calls:
        authority.check()
        return {"ok": True, "campaignReports": campaign_reports,
                "trace": {"selectionBy": "chat_agent", **campaign_trace}}
    try:
        store_currency.resolve(authority, calls, allowed, fields)
    except store_currency.ProfileError as error:
        log_failure("store_currency", error.result["code"], error.result.get("retryAt"))
        if campaign_reports:
            return {"ok": True, "campaignReports": campaign_reports, "reportFailure": error.result["reason"],
                    "trace": {"selectionBy": "chat_agent", **campaign_trace}}
        return error.result
    engine.chat_template_selection = {
        "action": "plan", "complete": True, "missing": [], "invocations": calls,
        "requirements": [{"id": call["id"], "description": TEMPLATES[call["template_id"]]["purpose"],
                          "invocations": [call["id"]]} for call in calls],
    }
    engine.harness_store_names = lambda plan: authority.names
    engine.program_answers = False
    model_answer.step = answer_step  # Only in this request's private child interpreter.
    operations = []
    report_pending = False
    long_report = any(TEMPLATES[call["template_id"]]["kind"] == "parameter"
                      or TEMPLATES[call["template_id"]].get("parameter_report") for call in calls)

    rate_limits = 0
    ozon_retries = {}

    class ChatTransport(HTTPTransport):
        def _read_request(self, request, store):
            if request.operation not in permitted_parameter_reads:
                raise CallError("MARKETPLACE_OPERATION_REQUIRED")
            built, metadata = super()._read_request(request, store)
            if request.operation in realization_reads:
                metadata = {**metadata, "completion": {"mode": "ozon-protected"}}
            return built, metadata

        def _scoped_qualification(self, matrix, request, store):
            if request.operation == "ozon_ads_daily":
                advertising.authorize_daily_request(matrix, request, store)
                return
            return super()._scoped_qualification(matrix, request, store)

        def execute(self, request, store, *, on_dispatch=None):
            nonlocal report_pending, rate_limits
            report_pending = False
            if store is None:
                raise CallError("MARKETPLACE_OPERATION_REQUIRED")
            context = copy_context()
            retry_key = (request.source, request.operation, fingerprint(request.body))
            previous = ozon_retries.get(retry_key)

            def guard_dispatch():
                result = context.run(on_dispatch) if on_dispatch else authority.check()
                if previous and authority.resume_rate_limits:
                    number, retry = previous
                    authority.ozon_notice(retry.sending(number))
                return result
            try:
                answer = super().execute(request, store, on_dispatch=guard_dispatch)
                if request.operation == "ds_wb_adstats" and answer[0] is None and answer[1]["status"] == 200:
                    # A successful null payload is an empty response, not numeric zeros.
                    answer = ([], answer[1])
                if request.operation == "ozon_ads_daily":
                    from http_transport import MATRICES
                    advertising.qualify_daily_response(MATRICES[request.operation], request, store, *answer)
            except CallError as error:
                log_failure(request.operation, error.code, error.retry_at)
                if request.operation in ("ds_wb_campaigns", "ds_wb_adstats") and error.status in (401, 403):
                    raise CallError("WB_ADVERTISING_ACCESS", status=error.status) from None
                if error.status == 429:
                    rate_limits += 1
                    if store["platform"] == "ozon":
                        retry = ozon_retry.plan(ozon_retry.endpoint(request.operation), error.retry_at, time.time())
                        error.ozon_retry = retry
                        number = previous[0] + 1 if previous else 1
                        ozon_retries[retry_key] = number, retry
                        from request_recovery import repeat_safe
                        if authority.resume_rate_limits and repeat_safe(request):
                            authority.ozon_notice(retry.waiting(number))
                raise
            if previous:
                del ozon_retries[retry_key]
                if authority.resume_rate_limits:
                    authority.ozon_notice(f"Ozon принял повтор №{previous[0]} ({previous[1].label}).")
            if request.operation == "read.ozon.report_info" and isinstance(answer[0], dict):
                report_pending = answer[0].get("result", {}).get("status") in ("waiting", "processing")
            if authority.resume_rate_limits and (request.operation == "ds_wb_adstats"
                                                    or long_report and store["platform"] == "ozon"):
                authority.report_progress()
            operations.append({"operation": request.operation, "connectionId": store["id"]})
            return answer

    parameter_keys = {TEMPLATES[tid]["parameter_key"] for call in calls
                      for tid in dependencies(call["template_id"]) if TEMPLATES[tid]["kind"] == "parameter"}
    has_forecast = any(TEMPLATES[call["template_id"]].get("parameter_report") for call in calls)
    if has_forecast:
        from economics_report_runtime import READ_OPERATIONS
        parameter_keys.update(("loss_rate", "delivery_mean"))
    else:
        READ_OPERATIONS = ()
    permitted_parameter_reads = {"read.ozon." + op for key in parameter_keys for op in required_operations(key)}
    realization_reads = set()
    if any(call["template_id"] == "economics.unit_forecast.v1" for call in calls):
        from realization_source_runtime import STEPS
        realization_reads = {"read.ozon." + item["operation"] for item in STEPS}
        permitted_parameter_reads.update("read.ozon." + op for op in READ_OPERATIONS)
    transport = ChatTransport(directory, {}, proofs, enabled=True,
                              read_surface_policy=lambda: {"enabled": True, "pin": read_surface.PIN})
    worker = Worker(engine, transport, execution_ready=authority.check)
    today = datetime.now(ZoneInfo("Europe/Moscow")).date()
    root = submit(engine, pins["tenant_id"], turn["question"], turn["requestId"],
                  fingerprint([turn["question"], calls]), today, execution_context=guard)
    while time.time() < authority.deadline:
        row = repo.get(pins["tenant_id"], root["job_id"])
        if row["state"] != "QUEUED":
            break
        delay = row["due"] - time.time()
        if delay > 0:
            pending = pending_result(repo, row)
            if authority.resume_rate_limits and report_pending:
                authority.wait_for_provider(max(row["due"], time.time() + 4))
                report_pending = False
            elif pending["code"] == "HTTP_429" and authority.resume_rate_limits:
                authority.wait_for_provider(row["due"])
            elif row["due"] >= authority.deadline:
                return pending
            else:
                time.sleep(delay)
        worker.step()
    else:
        raise Rejected("DEADLINE_EXCEEDED")
    authority.check()
    plan = json.loads(row["plan"])
    selected = plan.get("selection", {}).get("invocations", [])
    for receipt in operations:
        platform = next(r[1] for r in authority.frozen if r[0] == receipt["connectionId"])
        field_map = {}
        for selection in selected:
            if selection["store_id"] != receipt["connectionId"]:
                continue
            for tid in dependencies(selection["template_id"]):
                for step in TEMPLATES[tid]["steps"]:
                    if step.get("platform") == platform and step.get("operation") == receipt["operation"]:
                        field_map.update(step.get("bind", {}).get("fields", {}))
        if field_map:
            receipt["metricFields"] = field_map
    trace = {"selectionBy": "chat_agent", "catalogHash": HASH, "catalogSize": len(TEMPLATES),
             "templates": campaign_trace["templates"] + [
                 {"id": item["template_id"], "connectionId": item["store_id"]} for item in selected],
             "operations": campaign_trace["operations"] + operations,
             "rateLimitResponses": campaign_trace["rateLimitResponses"] + rate_limits}
    if row["state"] != "READY":
        code = row.get("error") or row["state"]
        reason = explain(code)["text"]
        if code in ("ACCRUAL_CURRENCY", "FINANCE_CURRENCY_CHANGED") and authority.currencies:
            reason = "Код валюты в финансовых данных не совпал с подтверждённой валютой магазина."
        elif code == "ACCRUAL_PRODUCT_MONEY":
            reason = "Денежные поля товарной строки начислений Ozon не прошли проверку суммы или валюты."
        if campaign_reports:
            return {"ok": True, "campaignReports": campaign_reports, "reportFailure": reason, "trace": trace}
        return {"ok": False, "code": code, "reason": reason, "trace": trace}
    result = json.loads(row["result"])
    if result.get("clarification"):
        return {"ok": True, "clarification": result["clarification"]["question"],
                "campaignReports": campaign_reports, "trace": trace}
    presentation = result.get("chat_presentation") or {}
    guidance = list(dict.fromkeys(note for item in selected
        for note in TEMPLATES[item["template_id"]].get("notes", [])))
    completed = (result.get("data") or {}).get("templates", [])
    source_values = formula_inputs(plan, completed, authority.names) if not result.get("failure_code") else []
    answer = presentation.get("details") or "\n".join(result.get("pages", []))
    coverage = advertising.coverage_notes(plan, completed, authority.names) if not result.get("failure_code") else []
    if coverage:
        answer = "\n".join(coverage) + "\n\n" + answer
    coefficient=None
    if packet.get("coefficientJob") and not result.get("failure_code"):
        fragments=plan["fragments"]
        if len(fragments)!=1 or fragments[0]["kind"]!="parameter":
            raise Rejected("PARAMETER_PREVIEW_INVALID")
        source=fragments[0]["plan"]["parameter_source"]
        info=result["data"]["templates"][0]["data"]
        if info.get("saved") is not False or info["mode"]!="preview":
            raise Rejected("PARAMETER_PREVIEW_INVALID")
        coefficient={**info,"sku":source["target"]["scope"]["sku"],"store":source["target"]["store_id"]}
    if campaign_reports and result.get("failure_code"):
        return {"ok": True, "campaignReports": campaign_reports,
                "reportFailure": explain(result["failure_code"])["text"], "trace": trace}
    return {"ok": not bool(result.get("failure_code")), "coefficient":coefficient, "sourceValues": source_values,
            "guidance": guidance, "answer": answer, "campaignReports": campaign_reports,
            "code": result.get("failure_code"), "trace": trace}


def seller_result(result):
    """Expose confirmed figures and business explanations through the chat tool."""
    if result.get("ok"):
        return {key: result[key] for key in ("ok", "answer", "clarification", "guidance", "sourceValues", "campaignReports", "reportFailure") if result.get(key)}
    if result.get("retryAt") and result.get("reason"):
        return {"ok": False, "reason": result["reason"], "retryAt": result["retryAt"]}
    from failure_explanations import explain
    code = result.get("code")
    classes = {
        "FINANCE_CURRENCY": "В финансовом отчёте не указана распознаваемая валюта.",
        "FINANCE_CURRENCY_CHANGED": "Суммы отчёта указаны в разных валютах. Общий итог в одной валюте получить не удалось.",
        "SOURCE_CURRENCY_MISMATCH": "Валюту всех сумм отчёта подтвердить не удалось.",
        "ACCRUAL_CURRENCY": "Валюту начислений подтвердить не удалось.",
        "ACCRUAL_PRODUCT_MONEY": "Не удалось подтвердить сумму и валюту товарных начислений.",
        "OZON_SELLER_PROFILE_CURRENCY": "Не удалось определить валюту кабинета Ozon.",
        "OZON_SELLER_PROFILE_UNAVAILABLE": "Не удалось получить валюту кабинета Ozon.",
        "OZON_SELLER_PROFILE_HTTP": "Не удалось получить валюту кабинета Ozon.",
        "WB_SELLER_PROFILE_CURRENCY": "Wildberries не указал валюту кабинета для этого отчёта.",
        "WB_SELLER_PROFILE_ACCESS": "Чтобы подтвердить валюту сумм, нужен доступ к балансу этого магазина Wildberries.",
        "WB_SELLER_PROFILE_HTTP": "Wildberries не вернул валюту кабинета для этого отчёта.",
        "WB_SELLER_PROFILE_UNAVAILABLE": "Не удалось получить валюту кабинета Wildberries.",
        "TOKEN_CLASS_REQUALIFICATION_REQUIRED": "Текущий тип токена Wildberries не подходит для этого отчёта. Проверьте подключение магазина в интеграциях.",
        "HTTP_429_RETRY_EXHAUSTED": "Площадка временно ограничила частоту запросов.",
        "SOURCE_PACING": "Следующий запрос к площадке будет доступен позже.",
        "FINANCIAL_REPORT_NOT_READY": "Финансовый отчёт пока не охватывает весь выбранный период.",
        "TEMPLATE_NOT_FOUND": "Такой отчёт пока недоступен для выбранного магазина.",
        "TEMPLATE_EXECUTION_FAILED": "Рассчитать запрошенный показатель не удалось.",
        "PARAMETER_DELIVERY_SKU_UNALLOCATED": "В начислениях Ozon есть доставка без привязки к товару. Для этого SKU можно ввести сумму вручную.",
        "PARAMETER_ZERO_DENOMINATOR": "За выбранный период нет заказанных единиц для расчёта.",
        "PARAMETER_REPORT_INPUT": "В прогноз переданы неподдерживаемые параметры.",
        "PARAMETER_REPORT_SCOPE_UNSUPPORTED": "Этот прогноз строится по одному магазину за выбранный период. Фильтры и сравнение периодов для него недоступны.",
        "CAMPAIGN_STATUS_SCOPE": "Укажите допустимые статусы рекламных кампаний.",
        "SOURCE_ACCESS": "Для подключения сейчас недоступны запрошенные данные.",
        "WB_ADVERTISING_ACCESS": "Для рекламы Wildberries нужен токен с доступом к категории «Продвижение».",
        "TARIFF_QUOTE_OR_SKU_MISSING": "В текущем каталоге Ozon отсутствует тариф для части товаров или схем доставки из выбранных заказов. Полный прогноз требует этих тарифов.",
        "OTHER_UNCLASSIFIED_FEE": "В заказах есть начисление Ozon, для которого в правилах прогноза ещё не определена статья расходов.",
        "ECONOMICS_OWNER_INPUTS_MISSING": "Для прогноза не хватает себестоимости части товаров. Укажите её по SKU или общую для всех товаров.",
        "UNSPECIFIED": "Получить подтверждённый результат за выбранный период не удалось.",
    }
    info = explain(code)
    reason = classes.get(code) or classes.get(info["reason_code"]) or info["reason"]
    return {"ok": False, "reason": reason, **({"retryAt": result["retryAt"]} if result.get("retryAt") else {})}


def main():
    packet = json.load(sys.stdin)
    root = Path(packet["workingDirectory"])
    unpack(root / "runtime")
    from semantics import Rejected
    with open(os.devnull, "w") as sink, redirect_stdout(sink):
        try:
            result = catalogue(packet["profiles"]) if "profiles" in packet else execute(packet, root)
        except Rejected as error:
            from failure_explanations import explain
            result = {"ok": False, "code": error.code, "reason": explain(error.code)["text"]}
    if "profiles" not in packet:
        if not result.get("ok"):
            log_failure(",".join(sorted({item["templateId"] for item in packet["selections"]})),
                        result.get("code"), result.get("retryAt"))
        coefficient=result.get("coefficient")
        public = seller_result(result)
        result = {"public": public, "diagnostics": {k: result[k] for k in ("code", "trace") if k in result}}
        if coefficient is not None:
            result["coefficient"]=coefficient
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
