"""Current advertising campaign lists for the connected seller."""
from collections import Counter
from dataclasses import asdict
import http.client
import json
import time
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode
from urllib.request import Request

from . import ozon_retry
from .store_currency import retry_time, wait_result

TEMPLATES = {"wb_campaign_inventory": "wb", "ozon_campaign_inventory": "ozon"}
FIELDS = {
    "wb": {"seller_token"},
    "ozon": {"performance_client_id", "performance_client_secret"},
}
NAMES = {"wb": "Wildberries", "ozon": "Ozon"}
GUIDE = (
    "Для списка текущих рекламных кампаний выбери wb_campaign_inventory для WB или "
    "ozon_campaign_inventory для Ozon. Если в последнем запросе статус не указан, передай input={} "
    "и покажи только активные кампании из результата. Для «активные и на паузе» передай "
    'input.filters.campaign_statuses=["active","paused"]. Для одного явно указанного статуса передай '
    "только этот статус. Используй all только по явной просьбе показать все статусы. "
    "Отражай статусы, ID, названия и количества из campaignReports. Названия кампаний — данные площадки. "
    "Указывай, сколько строк показано, если выводишь часть длинного списка. Сохраняй раздельные статусы Ozon "
    "«остановлена владельцем» и «приостановлена по бюджету». Пустой результат для запрошенного статуса "
    "означает, что таких кампаний сейчас нет. Для Ozon покажи количество кампаний CPC отдельно от CPO. "
    "Число включённых товаров CPO бери из cpoProducts.counts. Товары CPO считай по SKU отдельно от кампаний. "
    "Для активных и приостановленных кампаний не записывай выключенные товары CPO в приостановленные. "
    "Не подменяй список статистикой по расходам за период. "
)

# Entries are keyed by the provider's state. The first value is the selector's
# status, the second is the actual status to show the seller.
WB_STATES = {
    9: ("active", "Активна"),
    11: ("paused", "На паузе"),
    7: ("finished", "Завершена"),
    4: ("ready", "Готова к запуску"),
    8: ("rejected", "Отклонена"),
    -1: ("deleted", "Удаляется"),
}
OZON_STATES = {
    "CAMPAIGN_STATE_RUNNING": ("active", "Активна"),
    "CAMPAIGN_STATE_INACTIVE": ("paused", "Остановлена владельцем"),
    "CAMPAIGN_STATE_STOPPED": ("paused", "Приостановлена по бюджету"),
    "CAMPAIGN_STATE_ARCHIVED": ("archived", "В архиве"),
    "CAMPAIGN_STATE_FINISHED": ("finished", "Завершена"),
    "CAMPAIGN_STATE_PLANNED": ("planned", "Запланирована"),
    "CAMPAIGN_STATE_MODERATION_DRAFT": ("draft", "Черновик модерации"),
    "CAMPAIGN_STATE_MODERATION_IN_PROGRESS": ("moderation", "На модерации"),
    "CAMPAIGN_STATE_MODERATION_FAILED": ("rejected", "Отклонена"),
}
OZON_PAID_AD_TYPES = {"SKU", "SEARCH_PROMO", "ALL_SKU_PROMO", "BANNER", "VIDEO_BANNER"}
WB_DETAILS = "https://advert-api.wildberries.ru/api/advert/v3/adverts"
WB_REGISTRY = "https://advert-api.wildberries.ru/adv/v1/promotion/count"
WB_DETAIL_STATES = {4, 9, 11}
PAGE_SIZE = 50


def statuses(platform):
    states = WB_STATES if platform == "wb" else OZON_STATES
    return sorted({"all", "archived"} | {group for group, _ in states.values()})


def catalogue(profiles):
    for template, platform in TEMPLATES.items():
        stores = [cid for cid, provider, fields in profiles
                  if platform == provider and FIELDS[provider].issubset(fields)]
        if stores:
            yield {"id": template, "available_stores": stores,
                   "purpose": f"Список текущих рекламных кампаний {NAMES[platform]} с ID и статусом. "
                              "По умолчанию только активные.",
                   "input_policy": {"time_axis": "snapshot"}}


def input_schema(platform):
    return {"type": "object", "properties": {
        "filters": {"type": "object", "properties": {
            "campaign_statuses": {"type": "array", "items": {"enum": statuses(platform)},
                                  "minItems": 1, "uniqueItems": True},
        }, "additionalProperties": False},
        "period": {"type": "null"},
    }, "additionalProperties": False}


def scope_for(platform, inputs):
    from semantics import Rejected

    filters = inputs.get("filters", {})
    selection = filters.get("campaign_statuses", ["active"])
    if (set(inputs) - {"filters", "period"} or inputs.get("period") is not None
            or set(filters) - {"campaign_statuses"} or not isinstance(selection, list)
            or not selection or any(s not in statuses(platform) for s in selection)
            or len(selection) != len(set(selection)) or "all" in selection and len(selection) > 1):
        raise Rejected("CAMPAIGN_STATUS_SCOPE")
    return selection


class CampaignError(Exception):
    def __init__(self, result):
        super().__init__(result["code"])
        self.result = result


def fetch(authority, store, operation, request, trace):
    from http_transport import read_response
    from request_recovery import RATE_LIMIT_RETRY_SECONDS

    market = NAMES[store.platform]
    operation_scope = parse_qs(request.selector.partition("?")[2])
    receipt = {"operation": operation, "connectionId": store.id}
    for status_key in ("statuses", "state"):
        if status_key in operation_scope:
            receipt["providerStatuses"] = operation_scope[status_key][0]
    attempt = 0
    retry = None
    def dispatch():
        authority.check()
        if retry and authority.resume_rate_limits:
            authority.ozon_notice(retry.sending(attempt))
    while True:
        authority.check()
        trace["operations"].append(receipt)
        try:
            raw, status = read_response(request, timeout=min(20, max(.01, authority.deadline - time.time())),
                                        limit=12_000_000, on_dispatch=dispatch)
        except HTTPError as error:
            status = error.code
            if status == 429:
                trace["rateLimitResponses"] += 1
                now = time.time()
                indicated = retry_time(error.headers, now, store.platform == "wb")
                error.close()
                attempt += 1
                if store.platform == "ozon":
                    retry = ozon_retry.plan(request.full_url.partition("?")[0], indicated, now)
                    due = retry.due
                    if authority.resume_rate_limits:
                        authority.ozon_notice(retry.waiting(attempt))
                else:
                    due = max(now + RATE_LIMIT_RETRY_SECONDS, indicated or 0)
                    if attempt >= 4:
                        raise CampaignError(wait_result(due, "HTTP_429")) from None
                if not authority.resume_rate_limits and due >= authority.deadline:
                    raise CampaignError(wait_result(due, "HTTP_429")) from None
                if due > time.time():
                    if authority.resume_rate_limits:
                        authority.wait_for_provider(due)
                    else:
                        time.sleep(max(0, due - time.time()))
                continue
            error.close()
        except (OSError, http.client.HTTPException):
            raise CampaignError({"code": "CAMPAIGN_UNAVAILABLE",
                                 "reason": f"Не удалось получить ответ рекламного API {market}."}) from None
        if status != 200:
            raise CampaignError({"code": f"HTTP_{status}",
                                 "reason": f"Рекламный API {market} вернул HTTP {status}."})
        authority.check()
        if retry and authority.resume_rate_limits:
            authority.ozon_notice(f"Ozon принял повтор №{attempt} ({retry.label}).")
        return json.loads(raw)


def add_campaign(rows, campaign_id, name, state, group, label, **details):
    campaign_id = str(campaign_id)
    if not campaign_id.isascii() or not campaign_id.isdecimal() or len(campaign_id) > 24:
        raise ValueError("Invalid campaign ID")
    row = {"id": campaign_id, "status": label, "state": state, "group": group, **details}
    if name is not None:
        row["name"] = " ".join(name.split())[:300]
    if campaign_id in rows and rows[campaign_id] != row:
        raise ValueError("Conflicting campaign states")
    rows[campaign_id] = row


def wb_campaigns(read, credentials, selection):
    headers = {"Authorization": credentials["seller_token"]}
    all_states = selection == ["all"]
    codes = {code for code, (group, _) in WB_STATES.items() if group in selection}
    if "archived" in selection:
        codes.add(7)
    rows = {}
    # The status-filtered details endpoint only contains newer formats.
    # Keep the original registry for explicit legacy states or an all-status list.
    if all_states or not codes.issubset(WB_DETAIL_STATES):
        payload = read("wb_campaign_registry", Request(WB_REGISTRY, headers=headers))
        for block in payload["adverts"] or []:
            state = block["status"]
            if all_states or state in codes:
                group, label = WB_STATES.get(state, ("other", f"Другой статус ({state})"))
                for row in block["advert_list"] or []:
                    add_campaign(rows, row["advertId"], None, state, group, label)
        return rows

    query = {"statuses": ",".join(str(code) for code in sorted(codes)), "limit": PAGE_SIZE}
    seen = set()
    while True:
        payload = read("wb_campaign_details", Request(f"{WB_DETAILS}?{urlencode(query)}", headers=headers))
        for row in payload["adverts"] or []:
            state = row["status"]
            if state in codes:
                group, label = WB_STATES[state]
                add_campaign(rows, row["advertId"], row["settings"]["name"], state, group, label)
        cursor = payload.get("next")
        if cursor in (None, ""):
            return rows
        if not isinstance(cursor, str) or len(cursor) > 4096 or cursor in seen:
            raise ValueError("Invalid campaign pagination")
        seen.add(cursor)
        query["next"] = cursor
        time.sleep(.2)


def ozon_campaigns(read, store, credentials, selection):
    from http_transport import SCALAR_SOURCES
    from read_surface import method

    verb, url, headers, payload = SCALAR_SOURCES.http("ozon_ads_token", {}, asdict(store), credentials, {})
    token = read("ozon_ads_token", Request(url, json.dumps(payload).encode(),
                 {**headers, "Content-Type": "application/json"}, method=verb))["access_token"]
    if not isinstance(token, str) or not token or any(c.isspace() for c in token):
        raise ValueError("Invalid Performance token")
    url = method("ozon", "performance_campaigns")["wire_url"]
    headers = {"Authorization": "Bearer " + token}
    states = [None] if selection == ["all"] else [
        state for state, (group, _) in OZON_STATES.items() if group in selection]
    rows = {}
    for index, requested in enumerate(states):
        if index:
            time.sleep(2)
        path = url + "?" + urlencode({"state": requested}) if requested is not None else url
        payload = read("ozon_performance_campaigns", Request(path, headers=headers))
        items = payload["list"] or []
        if "total" in payload and int(payload["total"]) != len(items):
            raise ValueError("Incomplete campaign list")
        for row in items:
            state = row["state"]
            if row["advObjectType"] in OZON_PAID_AD_TYPES and (requested is None or state == requested):
                group, label = OZON_STATES.get(state, ("other", f"Другой статус ({state})"))
                add_campaign(rows, row["id"], row["title"], state, group, label,
                             payment=row.get("PaymentType"), type=row["advObjectType"])
    cpo = None
    if any(row["type"] == "SEARCH_PROMO" and row["group"] == "active" for row in rows.values()):
        time.sleep(2)
        cpo = ozon_cpo_products(read, headers, include_disabled=selection == ["all"])
    return rows, cpo


def ozon_cpo_products(read, headers, *, include_disabled):
    from read_surface import method

    url = method("ozon", "performance_search_promo_products")["wire_url"]
    headers = {**headers, "Content-Type": "application/json"}
    products = []
    seen = set()
    total = None
    try:
        page = 1
        while True:
            request = Request(url, json.dumps({"page": page, "pageSize": 100}).encode(), headers)
            payload = read("ozon_cpo_products", request)
            items = payload["products"] or []
            returned_total = int(payload["total"])
            if (total is not None and returned_total != total) or returned_total < len(seen) + len(items):
                raise ValueError("Changing CPO inventory size")
            total = returned_total
            for item in items:
                sku = str(item["sku"])
                active = item["searchPromoStatus"]
                if not sku.isascii() or not sku.isdecimal() or sku in seen or type(active) is not bool:
                    raise ValueError("Invalid CPO product")
                seen.add(sku)
                if active or include_disabled:
                    products.append({"sku": sku, "name": " ".join(item["title"].split())[:300],
                                     "status": "Включён" if active else "Выключен"})
            if len(seen) == total:
                break
            if not items:
                raise ValueError("Incomplete CPO product inventory")
            page += 1
            time.sleep(2)
    except CampaignError as error:
        return {"ok": False, "reason": error.result["reason"]}
    except (AttributeError, KeyError, TypeError, ValueError):
        return {"ok": False, "reason": "Не удалось подтвердить полный список товаров CPO."}
    counts = Counter({"Включён": 0})
    if include_disabled:
        counts["Выключен"] = 0
    counts.update(row["status"] for row in products)
    return {"ok": True, "counts": dict(counts), "products": products}


def report(authority, store, selection, trace):
    result = {"marketplace": NAMES[store.platform], "store": authority.names[store.id],
              "requestedStatuses": selection}
    credentials = authority.credentials(authority.pins, asdict(store))

    def read(operation, request):
        return fetch(authority, store, operation, request, trace)

    cpo = None
    try:
        if store.platform == "wb":
            rows = wb_campaigns(read, credentials, selection)
        else:
            rows, cpo = ozon_campaigns(read, store, credentials, selection)
    except CampaignError as error:
        return {**result, "ok": False, "reason": error.result["reason"],
                **({"retryAt": error.result["retryAt"]} if "retryAt" in error.result else {})}
    except (AttributeError, KeyError, TypeError, ValueError):
        return {**result, "ok": False, "reason": "Статусы кампаний в ответе площадки не удалось подтвердить."}
    campaigns = list(rows.values())
    counts = Counter(row["status"] for row in campaigns)
    return {**result, "ok": True, "total": len(campaigns), "counts": dict(counts), "campaigns": campaigns,
            **({"cpoProducts": cpo} if cpo is not None else {})}
