"""The model discovers report contracts on demand, by metric and permitted shop."""

from ..catalog import Capability
from . import plugin
from ..resource_index import select_page


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

    resources = None

    def describe_store(query, cid, offset):
        nonlocal resources
        if resources is None:
            resources = [*plugin.catalogue(profiles), *plugin.extensions.catalogue(profiles)]
        candidates = [row for row in resources if cid in row["available_stores"]]
        matches, more = select_page(candidates, query, offset, 5)
        result = {"matches": [{"templateId": row["id"], "purpose": row["purpose"],
                               "inputs": row["input_policy"]} for row in matches],
                  "nextOffset": more}
        if matches:
            # Reuse the execution validator's conditional contract, restricted to
            # this shop and page. Do not include the old catalogue prompt.
            cap = plugin.capability([s for s in stores if s["id"] == cid],
                                    {row["id"] for row in matches})
            result["selectionSchema"] = cap.input_schema["properties"]["selections"]["items"]
            result["selectionSchema"]["properties"].pop("connectionId", None)
            result["selectionSchema"]["required"].remove("connectionId")
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

    def describe(scope, args):
        # One response per distinct access profile. Shops with identical rights
        # can use the same contract; IDs remain scoped to this chat.
        groups = {}
        for cid, provider, fields in profiles:
            groups.setdefault((provider, fields), []).append(cid)
        return {"groups": [{"connections": members, **describe_store(args["query"], members[0], args.get("offset", 0))}
                           for members in groups.values()]}

    search = Capability("describe__marketplace_report", "Параметры доступных операций отчётности.",
        {"type": "object", "properties": {"query": {"type": "string", "minLength": 1, "maxLength": 256},
         "offset": {"type": "integer", "minimum": 0}}, "required": ["query"], "additionalProperties": False}, describe)
    report = Capability("marketplace_report", "Получить фактические данные магазинов за запрошенный период.",
        {"type": "object", "properties": {"selections": {"type": "array", "minItems": 1,
        "uniqueItems": True, "items": selection}}, "required": ["selections"], "additionalProperties": False}, run)
    return [search, report]
