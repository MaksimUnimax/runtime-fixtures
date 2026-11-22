"""Read current Ozon quotes for the exact SKUs in a qualified order cohort."""

import base64
from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import json


# A filtered price request has at most 100 matches and room for them on one page.
BATCH_SIZE = 100
PRICE_LIMIT = 1000


def batches(rows):
    from parameter_support.economics_tariffs import identifier

    skus = sorted({identifier(row["sku"]) for row in rows})
    return [skus[start:start + BATCH_SIZE] for start in range(0, len(skus), BATCH_SIZE)]


def open_state(value):
    return (
        type(value) is dict
        and set(value) == {"products", "prices", "receipts"}
        and type(value["products"]) is list
        and type(value["prices"]) is list
        and type(value["receipts"]) is dict
        and len(value["prices"]) <= len(value["products"]) <= len(value["prices"]) + 1
    )


def product_ids(data, skus):
    from parameter_support.economics_tariffs import identifier, need

    need(type(data) is dict and set(data) == {"items"} and type(data["items"]) is list,
         "TARIFF_PRODUCT_RESPONSE")
    mapping = {}
    for item in data["items"]:
        need(type(item) is dict, "TARIFF_PRODUCT_RESPONSE")
        sku, product = identifier(item.get("sku")), identifier(item.get("id"))
        need(sku not in mapping, "TARIFF_MAPPING_CONFLICT")
        mapping[sku] = product
    need(set(mapping) == set(skus), "TARIFF_QUOTE_OR_SKU_MISSING")
    need(len(set(mapping.values())) == len(mapping), "TARIFF_MAPPING_CONFLICT")
    return sorted(mapping.values())


def prices_request(ids):
    return {"filter": {"visibility": "ALL", "product_id": ids}, "cursor": "", "limit": PRICE_LIMIT}


def normalize(worker, row, root, desc, state, groups, authorize):
    from parameter_support import economics_tariffs as source
    from parameter_source_runtime import _token
    import tariff_source_runtime as runtime

    runtime.need(groups and len(state["products"]) == len(state["prices"]) == len(groups),
                 "TARIFF_SOURCE_INCOMPLETE")
    verify = runtime._verifier(worker, row, root, desc, state, authorize)
    snapshots = []
    mapped_products = set()
    try:
        for skus, raw_product, raw_price in zip(groups, state["products"], state["prices"], strict=True):
            product, price = runtime._packet(raw_product), runtime._packet(raw_price)
            runtime.need(product["request"] == {"sku": skus}, "TARIFF_MAPPING_REQUEST_CHANGED")
            ids = product_ids(json.loads(product["body"]), skus)
            runtime.need(mapped_products.isdisjoint(ids), "TARIFF_MAPPING_CONFLICT")
            mapped_products.update(ids)
            runtime.need(price["request"] == prices_request(ids), "TARIFF_SOURCE_REQUEST_CHANGED")
            snapshots.append(source.normalize([price], [product], desc["scope"], verify=verify,
                             encode=lambda kind, value: _token(worker.repo, row, kind, value)).data)
    except (source.TariffError, source.c.ParameterError) as error:
        raise runtime.Rejected(error.code) from None
    runtime._guard(worker, row, root, desc, authorize)
    combined = dict(snapshots[0])
    for key in ("rows", "source_sha256", "receipts"):
        combined[key] = [part for data in snapshots for part in data[key]]
    runtime.need(len(combined["receipts"]) == len(set(combined["receipts"])), "TARIFF_RECEIPT_REUSED")
    for key in ("quote_observed_at", "mapping_observed_at"):
        combined[key] = min((data[key] for data in snapshots), key=source.c.stamp)
    text = source.c.CANON(combined)
    return source.CurrentTariffs(text, source._seal(text))


def restore(worker, row, root, desc, packed, *, orders, authorize):
    import tariff_source_runtime as runtime

    runtime._guard(worker, row, root, desc, authorize)
    return normalize(worker, row, root, desc, runtime._open(worker.repo, row, desc, packed),
                     batches(orders), authorize)


def step(worker, row, root, desc, packed, *, orders, authorize, save_progress, on_complete):
    from parameter_support import economics_tariffs as source
    from period_cost_source_runtime import _transport_body
    import read_surface
    import tariff_source_runtime as runtime

    store = runtime._guard(worker, row, root, desc, authorize)
    groups = batches(orders)
    state = ({"products": [], "prices": [], "receipts": {}} if packed is None
             else runtime._open(worker.repo, row, desc, packed))
    index = len(state["prices"])
    if index == len(groups):
        on_complete(normalize(worker, row, root, desc, state, groups, authorize), packed)
        return

    skus = groups[index]
    mapping = len(state["products"]) == index
    try:
        if mapping:
            operation, params = source.CATALOG["product_operation"], {"sku": skus}
        else:
            saved_product = runtime._packet(state["products"][index])
            runtime.need(saved_product["request"] == {"sku": skus}, "TARIFF_MAPPING_REQUEST_CHANGED")
            raw = saved_product["body"]
            runtime.need(sha256(raw).hexdigest() == saved_product["response_sha256"], "TARIFF_BODY_HASH")
            ids = product_ids(json.loads(raw), skus)
            operation, params = source.CATALOG["price_operation"], prices_request(ids)
    except source.TariffError as error:
        raise runtime.Rejected(error.code) from None
    runtime.need(read_surface.method("ozon", operation)["effect"] == "READ", "TARIFF_NOT_READ")
    request = read_surface.request_for(store, operation, params)
    runtime.need(request.body["params"] == params, "TARIFF_SOURCE_REQUEST_CHANGED")

    def guard():
        runtime._guard(worker, row, root, desc, authorize)

    prerequisite = worker.transport.prepare(request, store) if hasattr(worker.transport, "prepare") else None
    if prerequisite:
        worker._call(row, prerequisite, store, before_dispatch=guard)
        save_progress(runtime._seal(worker.repo, row, desc, state))
        return

    def received(answer):
        guard()
        try:
            if mapping:
                product_ids(answer, skus)
            else:
                actual = source.price_page_total(answer)
                expected = set(params["filter"]["product_id"])
                source.need(all(type(item) is dict for item in answer["items"]), "TARIFF_RESPONSE_SCHEMA")
                quoted = [source.identifier(item.get("product_id")) for item in answer["items"]]
                source.need(not answer["cursor"] and actual == len(quoted)
                            and len(set(quoted)) == len(quoted), "TARIFF_SOURCE_INCOMPLETE")
                source.need(set(quoted) == expected, "TARIFF_QUOTE_OR_SKU_MISSING")
        except source.TariffError as error:
            raise runtime.Rejected(error.code) from None
        raw = _transport_body(answer)
        with worker.repo.connection() as conn:
            event = conn.execute("SELECT id,state,http FROM calls WHERE jid=? AND source=? ORDER BY id DESC LIMIT 1",
                                 (row["id"], request.source)).fetchone()
        runtime.need(event is not None and event["state"] == "RECEIVED" and event["http"] == 200,
                     "TARIFF_RECEIPT_MISSING")
        receipt = str(event["id"])
        runtime.need(receipt not in state["receipts"], "TARIFF_RECEIPT_REUSED")
        stamp = datetime.fromtimestamp(worker.repo.clock(), timezone.utc).isoformat()
        digest = sha256(raw).hexdigest()
        state["receipts"][receipt] = {"source": request.source, "operation": request.operation,
                                     "request_hash": runtime.fingerprint(params), "response_hash": digest,
                                     "received_at": stamp}
        state["products" if mapping else "prices"].append({
            "operation": operation, "scope": deepcopy(desc["scope"]), "request": params,
            "body_b64": base64.b64encode(raw).decode(), "received_at": stamp, "receipt_id": receipt,
            "response_sha256": digest, "http": 200,
        })
        save_progress(runtime._seal(worker.repo, row, desc, state))

    worker._call(row, request, store, before_dispatch=guard, on_received=received, capture_answer_data=False)
