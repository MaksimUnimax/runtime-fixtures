"""Bind forecasts to this authorized chat and temporary, verified inputs."""
from copy import deepcopy
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, localcontext


def normalise_owner_inputs(value):
    from parameter_support import parameter_contract as pc

    fields = {"unit_cost", "unit_cost_by_sku", "tax_amount", "own_cost_amount"}
    pc.need(isinstance(value, dict) and set(value) <= fields, "ECONOMICS_OWNER_INPUT")
    pc.need(not {"unit_cost", "unit_cost_by_sku"} <= set(value), "ECONOMICS_OWNER_INPUT")

    def money(raw):
        pc.need(type(raw) in (str, int, float), "ECONOMICS_OWNER_INPUT")
        if type(raw) in (int, float):
            try:
                raw = pc.decimal_text(Decimal(str(raw)))
            except InvalidOperation:
                raise pc.ParameterError("ECONOMICS_OWNER_INPUT") from None
        amount = pc.number(raw)
        pc.need(amount >= 0, "ECONOMICS_OWNER_INPUT")
        return pc.decimal_text(amount)

    result = {field: money(raw) for field, raw in value.items() if field != "unit_cost_by_sku"}
    if "unit_cost_by_sku" in value:
        costs = value["unit_cost_by_sku"]
        pc.need(isinstance(costs, dict) and bool(costs), "ECONOMICS_OWNER_INPUT")
        for sku in costs:
            pc.scope({"kind": "sku", "sku": sku})
        result["unit_cost_by_sku"] = {sku: money(cost) for sku, cost in costs.items()}
    return result


def coefficient_lines(rows):
    labels = {"loss_rate": ("Доля потерь", "%", Decimal("100")),
              "delivery_mean": ("Средняя прямая и последняя доставка", " ₽/шт.", Decimal("1"))}
    lines = []
    for row in rows:
        if row.get("origin") not in ("calculated_preview", "manual", "calculated") or row["parameter"] not in labels:
            continue
        label, unit, factor = labels[row["parameter"]]
        with localcontext() as arithmetic:
            arithmetic.prec = 80
            value = (Decimal(row["value"]) * factor).quantize(Decimal(".01"), rounding=ROUND_HALF_UP)
        period = row.get("actual_period")
        scope = (" Для SKU " + row["sku"] + ".") if row.get("sku") else ""
        if row["origin"] == "manual":
            detail = "Значение из настроек товара, введено вручную." if row.get("sku") else "Значение из настроек магазина, введено вручную."
        else:
            start, end = (".".join(reversed(period[key].split("-"))) for key in ("from", "to"))
            dates = start if start == end else f"{start} — {end}"
            detail = f"Рассчитано по данным Ozon за {dates}."
        lines.append(f"{label} {str(value).replace('.', ',')}{unit}.{scope} {detail}")
    return list(dict.fromkeys(lines))


def unit_cost_lines(rows):
    basis = {(row.get("sku"), row["value"]) for row in rows if row.get("origin") == "chat_input"}
    if not basis:
        return []
    shared = [value for sku, value in basis if sku is None]
    if shared:
        return [f"Себестоимость по данным продавца {shared[0].replace('.', ',')} ₽ за единицу для всех товаров."]
    by_sku = sorted(basis, key=lambda item: int(item[0]))
    shown = ", ".join(f"SKU {sku} — {value.replace('.', ',')} ₽" for sku, value in by_sku[:20])
    summary = [f"Себестоимость за единицу по данным продавца: {shown}."]
    if len(by_sku) > 20:
        summary.append(f"Показано 20 из {len(by_sku)} SKU с заданной себестоимостью.")
    return summary


def configure(engine, authority=None):
    import economics_report_runtime as economics
    import parameter_report_runtime as reports

    engine.parameter_compound_policy = {"enabled": True, "pin": reports.PIN}
    engine.economics_composite_policy = {"enabled": True, "pin": economics.PIN}

    class PreviewAuthority(reports.Authority):
        preview_only = True

        def __init__(self):
            self.references = {}
            self.coefficients = {}
            self.readsets = {}

        def bind(self, worker, row, root, fragment):
            from secrets import token_urlsafe
            from semantics import Rejected

            authority.check()
            info = fragment["plan"]["parameter_report"]
            stores = fragment["plan"]["stores"]
            if (not worker.engine.authorized(root) or len(stores) != 1 or
                    stores[0]["platform"] != "ozon" or root["runtime_guard"] != {"pins": authority.pins}):
                raise Rejected("SOURCE_ACCESS")
            ref = token_urlsafe(24)
            self.references[ref] = {
                "job": row["id"], "tenant": row["tenant"], "store": stores[0]["id"],
                "template": info["template_id"], "input": deepcopy(info["input"]),
                "as_of": root["calendar_date"],
            }
            return {"reference": ref, **self.resolve(self.references[ref])}

        def resolve(self, binding, skus=("",)):
            from datetime import date
            from parameter_support import parameter_contract as pc
            from parameter_support import parameter_dependencies as dependencies
            from parameter_support import parameter_report_contract as spec
            from semantics import fingerprint

            info = spec.definition(binding["template"])
            periods = binding["input"]["parameter_periods"]
            profiles = dependencies.profile(info["profile"])["bindings"]
            slots = {profile["slot"] for profile in profiles}
            pc.need(set(periods) <= slots, "PARAMETER_DEPENDENCY_PERIOD_SLOT")
            rows = authority.saved_ozon_coefficients(binding["store"])
            stored = {}
            for sku, metric, raw, source, since, until, revision in rows:
                if metric not in ("loss", "forward"):
                    continue
                key, unit = ("loss_rate", "ratio") if metric == "loss" else ("delivery_mean", "RUB/ordered_unit")
                with localcontext() as arithmetic:
                    arithmetic.prec = max(80, len(raw) + 4)
                    value = pc.decimal_text(Decimal(raw).scaleb(-2)) if metric == "loss" else raw
                stored[sku, key] = dict(parameter=key, unit=unit, value=value, origin=source,
                                        actual_period={"from": since, "to": until} if since else None,
                                        revision=revision, sku=sku)
            snapshot = fingerprint(rows)
            by_sku, basis, producers = {sku: {} for sku in skus}, {}, []
            for profile in profiles:
                slot, key = profile["slot"], profile["parameter"]
                period = pc.resolve_period(date.fromisoformat(binding["as_of"]), periods.get(slot))
                target = {"tenant_id": binding["tenant"], "store_id": binding["store"],
                          "provider": "OZON", "scope": {"kind": "store", "sku": ""}}
                descriptor = {"key": key, "target": target, "period": period}
                preview = self.coefficients.get(fingerprint(descriptor))
                for sku, inputs in by_sku.items():
                    item = next((r for area in (sku, "") if (r := stored.get((area, key))) is not None
                                 and (slot not in periods or r["actual_period"] == period["actual"])), None)
                    if item is None and preview is not None:
                        item = dict(parameter=key, value=preview["value"], unit=preview["unit"],
                                    actual_period=period["actual"], calculated_at=preview["calculated_at"],
                                    origin="calculated_preview")
                    if item is None:
                        if descriptor not in producers:
                            producers.append(descriptor)
                        continue
                    inputs[slot] = item["value"]
                    basis[fingerprint(item)] = {**item, "slot": slot}
            basis = list(basis.values())
            return {"ready": not producers, "inputs": by_sku.get("", {}), "by_sku": by_sku,
                    "basis": basis, "producers": producers, "snapshot": snapshot,
                    "checkpoint": {"basis_fingerprint": fingerprint([binding, snapshot, basis])}}

        def accept_result(self, reference, fragment, result):
            from parameter_support import parameter_contract as pc
            from semantics import Rejected, fingerprint

            binding = self.references.get(reference)
            if binding is None:
                raise Rejected("SOURCE_ACCESS")
            authority.check()
            source = fragment["plan"]["parameter_source"]
            descriptor = {"key": source["key"], "target": source["target"], "period": source["period"]}
            if (descriptor not in self.resolve(binding)["producers"] or result.get("saved") is not False or
                    result.get("mode") != "preview" or result.get("parameter") != source["key"] or
                    result.get("period") != source["period"]["actual"]):
                raise Rejected("PARAMETER_PREVIEW_INVALID")
            pc.validate_value(pc.definition(source["key"]), result["value"], result["unit"])
            self.coefficients[fingerprint(descriptor)] = deepcopy(result)

        def call(self, payload):
            from parameter_support import parameter_contract as pc
            from semantics import Rejected, fingerprint

            authority.check()
            binding = self.references.get(payload.get("reference"))
            if not binding:
                raise Rejected("SOURCE_ACCESS")
            method = payload["method"]
            if method == "report_current":
                return {"current": True}
            skus = self.readsets.get(payload["reference"], ("",))
            if method == "report_owner_inputs":
                skus = tuple(dict.fromkeys(item["sku"] for item in payload["readset"]["rows"]))
            resolved = self.resolve(binding, skus)
            if method == "report_refresh":
                return {"reference": payload["reference"], **resolved}
            if method == "report_fence":
                return {"current": payload["checkpoint"] == resolved["checkpoint"] and resolved["ready"]}
            if method == "report_owner_fence":
                expected = self.owner_checkpoint(binding, resolved, payload["checkpoint"].get("readset"))
                return {"current": resolved["ready"] and payload["checkpoint"] == expected}
            if method != "report_owner_inputs" or payload.get("job_id") != binding["job"]:
                raise Rejected("PARAMETER_WRITE_INTENT_REQUIRED")
            readset = payload["readset"]
            expected_scope = {"tenant_id": binding["tenant"], "store_id": binding["store"],
                              "provider": "OZON", "currency": "RUB"}
            if (readset["scope"] != expected_scope or readset["period"] != binding["input"]["period"]):
                raise Rejected("ECONOMICS_CURRENT_INPUT_SCOPE")
            self.readsets[payload["reference"]] = skus
            owner = binding["input"].get("owner_inputs", {})
            shared_cost = owner.get("unit_cost")
            per_sku = owner.get("unit_cost_by_sku", {})
            sku_cost = {item["sku"]: per_sku.get(item["sku"], shared_cost) for item in readset["rows"]}
            missing = [sku for sku, cost in sku_cost.items() if cost is None]
            if missing or not resolved["ready"]:
                return {"ready": False, "missing_owner": missing, "producers": resolved["producers"]}
            costs = {pc.CANON([item["sku"], item["day"]]): sku_cost[item["sku"]] for item in readset["rows"]}
            amounts = {field: {"state": "VALUE", "value": owner[field]} if field in owner else
                       {"state": "NOT_PROVIDED", "value": None} for field in ("tax_amount", "own_cost_amount")}
            cost_basis = ([{"value": shared_cost, "origin": "chat_input"}] if shared_cost is not None else
                          [{"sku": sku, "value": cost, "origin": "chat_input"} for sku, cost in sku_cost.items()])
            return {"ready": True,
                    "coefficients": {pc.CANON([item["sku"], item["day"]]): resolved["by_sku"][item["sku"]]
                                     for item in readset["rows"]},
                    "unit_costs": costs, "owner_period": amounts,
                    "checkpoint": self.owner_checkpoint(binding, resolved, fingerprint(readset)),
                    "basis": {"owner_data_revision": fingerprint(owner), "parameters_used": resolved["basis"],
                              "unit_cost_basis": cost_basis}}

        @staticmethod
        def owner_checkpoint(binding, resolved, readset):
            from semantics import fingerprint

            return {"schema": "alisa-economics-query-fence/v1", "owner": fingerprint([binding["input"], resolved["snapshot"]]),
                    "readset": readset, "parameters": resolved["checkpoint"]}

    engine.parameter_intent_authority = PreviewAuthority()
