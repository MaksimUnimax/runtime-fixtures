"""Normalize published model prices and chat capabilities."""
import re
from decimal import Decimal, InvalidOperation

MODEL = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.:-]+")

def amount(raw):
    if isinstance(raw, bool) or raw is None:
        raise ValueError("Missing amount")
    try:
        d = Decimal(str(raw))
        if not d.is_finite() or not 0 <= d <= 1000:
            raise ValueError("Invalid amount")
        return d
    except InvalidOperation as exc:
        raise ValueError("Invalid amount") from exc

def catalog_rows(data):
    models = {}
    if not isinstance(data["data"], list):
        raise ValueError("Invalid model catalog")
    for row in data["data"]:
        try:
            model, price = row["id"], row["pricing"]
            if (not MODEL.fullmatch(model) or model.startswith("openrouter/")
                    or "tools" not in row.get("supported_parameters", [])
                    or row["architecture"].get("output_modalities") != ["text"]):
                continue
            rates = [amount(price[k]) for k in ("prompt","completion")] + [amount(price.get("request",0))]
            free = not any(rates) and all(amount(value) == 0 for value in price.values())
            if not free and (model.endswith(":free") or not all(rates[:2]) or
                    any(amount(price.get(k,0)) > rates[0] for k in ("input_cache_read","input_cache_write"))):
                continue
            models[model] = {"id":model,"name":row["name"],"family":model.split("/",1)[0],
                             "rates":[str(r) for r in rates],"free":free}
        except (AttributeError, KeyError, ValueError, TypeError):
            continue
    return models
