"""The model discovers report contracts on demand, by metric and permitted shop."""
import re
from collections import Counter
from math import log

from ..catalog import Capability
from . import plugin


def terms(text):
    return {word[:5] for word in re.findall(r"[а-яa-z0-9]+", text.lower().replace("ё", "е"))
            if len(word) > 2 and word not in {"для", "или", "магазина", "ozon", "wildberries", "озон"}}


def model_tools(stores):
    profiles = plugin.profile_keys(stores)
    if not profiles:
        return []
    ids = [cid for cid, _, _ in profiles]
    store_id = {"type": "string", "enum": ids}
    selection = {"type": "object", "properties": {"connectionId": store_id,
                 "templateId": {"type": "string", "minLength": 1, "maxLength": 128},
                 "input": {"type": "object"}}, "required": ["connectionId", "templateId"],
                 "additionalProperties": False}

    def find(scope, args):
        query = terms(args["query"])
        candidates = [row for row in [*plugin.catalogue(profiles), *plugin.extensions.catalogue(profiles)]
                      if args["connectionId"] in row["available_stores"]]
        vocab = [terms(row["purpose"] + " " + row["id"]) for row in candidates]
        counts = Counter(term for row in vocab for term in row)
        def score(i):
            exact = candidates[i]["id"] == args["query"].strip()
            return 100 * exact + sum(log(1 + len(vocab)/counts[t]) for t in vocab[i] & query)
        ranked = sorted(range(len(vocab)), key=lambda i: (-score(i), candidates[i]["id"]))
        ranked = [i for i in ranked if score(i) > 0]
        offset = args.get("offset", 0)
        matches = [candidates[i] for i in ranked[offset:offset + 4]]
        result = {"matches": [{"templateId": row["id"], "purpose": row["purpose"],
                               "inputs": row["input_policy"]} for row in matches],
                  "nextOffset": offset + 4 if offset + 4 < len(ranked) else None}
        if matches:
            # Reuse the execution validator's conditional contract, restricted to
            # this shop and page. Do not include the old catalogue prompt.
            cap = plugin.capability([s for s in stores if s["id"] == args["connectionId"]],
                                    {row["id"] for row in matches})
            result["selectionSchema"] = cap.input_schema["properties"]["selections"]["items"]
            result["guidance"] = ("Даты from/to включительно. Для текущего состояния period=null. "
                "Обычно group_by=marketplace. Бери точные исходные суммы из sourceValues. "
                "Для уточнения периода сохрани магазин и показатель из беседы.")
            if any(r["id"] in plugin.campaign_inventory.TEMPLATES for r in matches):
                result["guidance"] += " " + plugin.campaign_inventory.GUIDE
        return result

    def run(scope, args):
        requested = {item["templateId"] for item in args["selections"]}
        full = plugin.capability(stores, requested)
        if full is None:
            return {"ok": False, "reason": "Для выбранного магазина такой отчёт недоступен."}
        try:
            full.validate(args)
        except ValueError:
            return {"ok": False, "reason": "Проверьте магазин и параметры выбранного отчёта."}
        return full.handler(scope, args)

    search = Capability("find_marketplace_reports",
        "Только для получения фактических данных магазина. Найди отчёт по одному показателю на русском и магазину. "
        "Для двух площадок ищи для каждой. Для справки, настройки и пересказа предыдущих цифр поиск не нужен.",
        {"type": "object", "properties": {"query": {"type": "string", "minLength": 1, "maxLength": 256},
         "connectionId": store_id, "offset": {"type": "integer", "minimum": 0}},
         "required": ["query", "connectionId"], "additionalProperties": False}, find)
    report = Capability("marketplace_report", "Запроси выбранные данные по форме из find_marketplace_reports.",
        {"type": "object", "properties": {"selections": {"type": "array", "minItems": 1,
        "uniqueItems": True, "items": selection}}, "required": ["selections"], "additionalProperties": False}, run)
    return [search, report]
