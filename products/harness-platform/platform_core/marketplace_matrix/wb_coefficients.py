"""Typed WB report templates for plugin calculations. Decimal throughout."""
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from functools import lru_cache
import asyncio
import json
import tarfile
import hashlib
import gzip
from pathlib import Path
from collections import defaultdict

METRICS = {
    "loss": ("Доля отмен и возвратов", "%", ("orders",)),
    "forward": ("Прямая доставка", "₽/заказанную единицу", ("orders", "finance")),
    "reverse": ("Обратная доставка", "₽/обратное событие", ("finance",)),
    "commission": ("Поправка к комиссии", "п.п.", ("finance", "tariffs")),
}
FORWARD = {"К клиенту при продаже", "К клиенту при отмене"}
REVERSE = {"От клиента при отмене", "От клиента при возврате"}
SALES = {"Продажа", "Возврат", "Коррекция продаж"}


class DataError(ValueError):
    pass


def number(value):
    try:
        if isinstance(value, bool) or len(str(value)) > 64:
            raise ValueError
        result = Decimal(str(value).replace(",", "."))
        if not result.is_finite() or (result and abs(result.adjusted()) > 30):
            raise ValueError
        return result
    except (InvalidOperation, ValueError):
        raise DataError("В отчёте отсутствует корректное число.") from None


def validate(metric, value):
    v = number(value)
    if metric not in METRICS or (metric == "loss" and not 0 <= v <= 100
        or metric in ("forward", "reverse") and v < 0 or metric == "commission" and abs(v) > 100):
        raise DataError("Значение выходит за границы показателя.")
    return format(v, "f")


async def products(read):
    cursor, result, seen = {}, {}, set()
    while True:
        response = await read("cards", {"settings": {"cursor": {"limit": 100, **cursor},
                              "sort": {"ascending": True}, "filter": {"withPhoto": -1}}})
        cards, point = response["cards"], response["cursor"]
        if not isinstance(cards,list) or len(cards) != point["total"]:
            raise DataError("WB не подтвердил полноту списка товаров.")
        for card in cards:
            sku = card["nmID"]
            if type(sku) != int or sku <= 0 or str(sku) in result:
                raise DataError("WB вернул повторяющийся или неизвестный артикул.")
            result[str(sku)] = (str(sku), str(card["vendorCode"]), str(card["title"]))
        if len(cards) < 100:
            return list(result.values())
        marker = (point["updatedAt"], point["nmID"])
        if marker in seen:
            raise DataError("WB повторил страницу каталога.")
        seen.add(marker)
        cursor = {"updatedAt": marker[0], "nmID": marker[1]}


async def orders(read, start, end, sku):
    units = losses = 0
    while start <= end:
        remaining=(end-start).days+1
        days=min(183,remaining//2) if remaining>183 else remaining
        last=start+timedelta(days=days-1)
        period = {"start": start.isoformat(), "end": last.isoformat()}
        offset, seen = 0, set()
        while True:
            result = await read("orders", {"selectedPeriod": period, "nmIds": [int(sku)] if sku else [],
                "brandNames": [], "subjectIds": [], "tagIds": [], "skipDeletedNm": False, "limit": 1000,
                "offset": offset, "orderBy": {"field": "orderSum", "mode": "desc"}})
            rows = result["data"]["products"]
            for row in rows:
                nm = row["product"]["nmId"]
                stats = row["statistic"]["selected"]
                if nm in seen or (sku and str(nm) != sku) or stats["period"] != period:
                    raise DataError("Воронка WB вернула другие товары или другой период.")
                seen.add(nm)
                for key in ("orderCount","cancelCount"):
                    if type(stats[key]) != int or stats[key] < 0:
                        raise DataError("WB не подтвердил количество единиц.")
                units += stats["orderCount"]
                losses += stats["cancelCount"]
            if len(rows) < 1000:
                break
            offset += len(rows)
        start = last + timedelta(days=1)
    return units, losses


async def finances(read, start, end, metric):
    fields=["rrdId","rrDate","currency","nmId","sellerOperName"]
    if metric=="commission":
        fields.extend(("deliveryMethod","srid","officeName","docTypeName","retailPriceWithDisc",
                       "forPay","acquiringFee","subjectName","orderDt"))
    else:
        fields.extend(("bonusTypeName","deliveryService","returnAmount"))
    cursor, seen = 0, set()
    while True:
        page = await read("finance", {"dateFrom":start.isoformat(), "dateTo":end.isoformat(),
                                    "period":"daily", "limit":10000, "rrdId":cursor,"fields":fields})
        if not isinstance(page,list):
            raise DataError("WB не вернул детализацию финансового отчёта.")
        if not page:
            return
        for row in page:
            rid = row["rrdId"]
            if type(rid) != int or rid <= cursor or rid in seen or not start <= date.fromisoformat(row["rrDate"][:10]) <= end:
                raise DataError("WB не подтвердил последовательность страниц или даты отчёта.")
            seen.add(rid)
            yield row
        cursor = page[-1]["rrdId"]


@lru_cache
def reference_rates():
    import os
    path = os.environ.get("OCTOPORT_WB_TARIFF_HISTORY")
    if path:
        return json.loads(Path(path).read_text())
    historic=json.loads(Path(__file__).with_name("wb_tariffs.json").read_text())
    with gzip.open(Path(__file__).with_name("wb_tariff_snapshots.json.gz"),"rt") as f:
        return historic+json.load(f)


def offset(rows, overrides=None):
    overrides = overrides or {}
    used_overrides = {}
    linked, offices = defaultdict(set), defaultdict(set)
    for row in rows:
        scheme = (row.get("deliveryMethod") or "").split(",")[0].strip()
        if row.get("srid") and scheme in ("FBS","FBW"):
            linked[row["srid"]].add(scheme)
    for row in rows:
        modes = linked[row.get("srid")]
        if row.get("sellerOperName") == "Продажа" and row.get("officeName") and len(modes) == 1:
            offices[row["officeName"]].update(modes)
    turnover = actual = official = Decimal(0)
    for row in rows:
        if row["sellerOperName"] not in SALES:
            continue
        p = number(row["retailPriceWithDisc"])
        sign = -1 if "Возврат" in (row["sellerOperName"], row["docTypeName"]) else 1
        actual += sign * (p - number(row["forPay"]) - number(row["acquiringFee"]))
        turnover += sign * p
        if not p:
            continue
        office = row.get("officeName") or ""
        modes = linked[row.get("srid")] or ({"FBS"} if office.startswith("Склад поставщика") else
                                            {"FBW"} if office == "Склад WB" else offices[office])
        if len(modes)!=1 and office and office in overrides:
            modes={overrides[office]}
            used_overrides[office]=overrides[office]
        if len(modes) != 1:
            if office:
                raise DataError(f"WB не указал схему доставки для склада «{office}». Укажите её в настройках «Схемы складов» и повторите расчёт.")
            raise DataError("В части финансовых строк WB отсутствуют склад и схема доставки.")
        category = row["subjectName"].casefold().replace("ё","е")
        day = date.fromisoformat(row["orderDt"][:10]).isoformat()
        rates = [v for v in reference_rates() if v["from"] <= day <= v["to"] and category in v["rates"]]
        if len(rates) != 1:
            raise DataError(f"В архиве нет подтверждённого тарифа для категории «{row['subjectName']}» на {day}.")
        rate = number(rates[0]["rates"][category][next(iter(modes))])
        official += sign * p * rate / 100
    return 100*(actual-official), turnover, {"turnover":str(turnover),"actual":str(actual),"official":str(official),"operatorSchemes":used_overrides}


async def calculate(read, metric, start, end, sku, *, templates=None, overrides=None):
    needed = METRICS[metric][2] if templates is None else templates
    if set(needed)!=set(METRICS[metric][2]):
        raise DataError("Не хватает источников для выбранной формулы.")
    if "orders" in needed:
        units, losses = await orders(read,start,end,sku)
    if metric == "loss":
        numerator, denominator, basis = 100*losses, units, {"cancelled":losses,"ordered":units}
    else:
        cost, events, lines, commission_rows = Decimal(0), Decimal(0), 0, []
        async for row in finances(read,start,end,metric):
            if sku and str(row.get("nmId")) != sku:
                continue
            currency = row.get("currency") or row.get("currencyName")
            if currency not in ("RUB","RUR","руб","руб."):
                raise DataError("WB не подтвердил рублёвую валюту финансовых строк.")
            lines += 1
            if metric == "commission":
                if row.get("deliveryMethod") or row["sellerOperName"] in SALES:
                    commission_rows.append(row)
            elif row.get("bonusTypeName") in (FORWARD if metric == "forward" else REVERSE):
                cost += number(row["deliveryService"])
                if metric == "reverse":
                    events += number(row["returnAmount"])
        if not lines:
            raise DataError("За выбранный период у WB нет финансовых строк для этого расчёта.")
        if metric == "commission":
            numerator,denominator,basis = await asyncio.to_thread(offset,commission_rows,overrides)
        else:
            numerator,denominator = cost, units if metric == "forward" else events
            basis = {"costRub":str(cost),"unitsOrEvents":str(denominator),"financeRows":lines}
    if denominator <= 0:
        raise DataError("За этот период нет единиц или оборота, на которые можно разделить сумму.")
    return validate(metric, Decimal(numerator)/denominator), basis

@lru_cache
def sources():
    from .worker import BUNDLE, BUNDLE_SHA256
    if hashlib.sha256(BUNDLE.read_bytes()).hexdigest() != BUNDLE_SHA256:
        raise DataError("Не удалось проверить версию матрицы.")
    with tarfile.open(BUNDLE) as archive:
        cards=json.load(archive.extractfile("dataset_sources.json"))["sources"]["ds_wb_products"]
        orders=json.load(archive.extractfile("scalar_source_catalog.json"))["sources"]["wb_orders"]
    return {"cards":cards["url"],"orders":orders["url"],
            "finance":"https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed"}
