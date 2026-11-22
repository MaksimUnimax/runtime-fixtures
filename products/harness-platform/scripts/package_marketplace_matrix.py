"""Build the standalone source package from the pinned matrix and chat renderer releases."""
import argparse
import ast
from copy import deepcopy
import gzip
import hashlib
import io
import json
import tarfile
from pathlib import Path


def bind_report_currency(files):
    # The chat uses seller-owned connections, whose currency may only be known
    # when a financial report arrives. Supply it to the existing row decoder.
    anchor = b"        currency=_read(d['currency'],env)"
    if files["matrix_sources.py"].count(anchor) != 1:
        raise ValueError("Review source decoder context before updating the runtime")
    files["matrix_sources.py"] = files["matrix_sources.py"].replace(anchor,
        b"        from platform_core.marketplace_matrix.store_currency import report_store\n"
        b"        store=report_store(operation,records,store,old)\n"
        b"        env['store']=store\n" + anchor)

    catalog = json.loads(files["template_catalog.json"])
    for name in ("B06.finance_deductions", "B06.finance_penalties", "B06.finance_acceptance_cost"):
        note = ("Назови запрошенную статью финансового отчёта, сумму, валюту и период. "
                "Нулевое значение допустимо только при наличии отчёта за весь период. "
                "На остальные статьи этот результат не распространяется.")
        if note not in catalog["templates"][name]["notes"]:
            catalog["templates"][name]["notes"].append(note)
    files["template_catalog.json"] = json.dumps(catalog, ensure_ascii=False, indent=2).encode() + b"\n"


def digest(value):
    data = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(data.encode()).hexdigest()


def group_table_requests(files):
    # Event templates with identical table, store and period use the same provider page.
    key = b"        key=fingerprint({'bucket':bucket,'store':store.id,'input':inputs,'specific':t['id']if bucket!='scalar'else None})"
    if files["template_catalog.py"].count(key) != 1:
        raise ValueError("Review fragment grouping before updating the runtime")
    files["template_catalog.py"] = files["template_catalog.py"].replace(key,
        b"        specific = t['table_request'] if bucket == 'event' else (None if bucket == 'scalar' else t['id'])\n"
        b"        key=fingerprint({'bucket':bucket,'store':store.id,'input':inputs,'specific':specific})")


def bind_node_runtime(files):
    # All child processes run with the server's trusted executable search path.
    fixed = b"['/usr/local/bin/node',str(DATA/'contract_bridge.mjs')]"
    if files["read_surface.py"].count(fixed) != 1:
        raise ValueError("Review the executable path of the read contract compiler")
    files["read_surface.py"] = files["read_surface.py"].replace(fixed, fixed.replace(b"/usr/local/bin/node", b"node"))


def bind_provider_retry(files):
    source = files["http_transport.py"].decode()
    start = "            retry=exc.headers.get('Retry-After');retry_at=None"
    end = "            if is_read and meta.get('completion',{}).get('mode')=='opaque-file'"
    if source.count(start) != 1 or source.count(end) != 1:
        raise ValueError("Review marketplace retry headers before updating the runtime")
    left, rest = source.split(start)
    _, right = rest.split(end)
    files["http_transport.py"] = (left +
        "            from platform_core.marketplace_matrix.store_currency import retry_time\n"
        "            retry_at=retry_time(exc.headers,time.time(),store is not None and store['platform']=='wb')\n"
        + end + right).encode()


def bind_table_contracts(portable, planner_proofs, files):
    sources = json.loads(files["source_matrix.json"])
    table_hash = digest({"table": json.loads(files["table_catalog.json"]), "source_matrix": sources})
    for operation, recipe in sources["sources"].items():
        required = recipe["proof_requirements"]
        decoder = portable.get(operation, {})
        if not required or not recipe["auth"].get("claims") or recipe.get("options", {}).get("qualification_scope"):
            continue
        if decoder.get("status") != "READ_ONLY_CANARY" or decoder.get("table_hash") != table_hash or not decoder.get("registry_hash"):
            continue
        for group in planner_proofs.values():
            proof = group.get(operation, {})
            if {"scope", "contract_scopes"} & (decoder.keys() | proof.keys()):
                continue
            if proof.get("registry_hash", decoder["registry_hash"]) != decoder["registry_hash"]:
                continue
            expected = {**required, "status": "READ_ONLY_CANARY", "table_hash": table_hash}
            if all(proof.get(k) == v for k, v in expected.items()):
                # Matrix.http checks the actual connection's token claims before every request.
                decoder.update(required)
                break


def bind_dataset_contracts(portable, planner_proofs, files):
    """Bind an observed query revision only to its independently qualified portable decoder."""
    sources = json.loads(files["dataset_sources.json"])
    queries = json.loads(files["dataset_queries.json"])
    source_hash = digest(sources)
    query_hash = digest({"queries": queries, "sources": sources})
    for operation, spec in sources["sources"].items():
        decoder = portable.get(operation, {})
        if spec.get("options", {}).get("qualification_scope") or decoder.get("status") != "READ_ONLY_CANARY":
            continue
        required = {**spec["proof_requirements"], "dataset_source_hash": source_hash,
                    "status": "READ_ONLY_CANARY"}
        if not decoder.get("registry_hash") or not all(decoder.get(k) == v for k, v in required.items()):
            continue
        for group in planner_proofs.values():
            observed = group.get(operation, {})
            if observed.get("registry_hash", decoder["registry_hash"]) != decoder["registry_hash"]:
                continue
            if {"scope", "contract_scopes"} & observed.keys():
                continue
            if observed.get("dataset_query_hash") == query_hash and all(observed.get(k) == v for k, v in required.items()):
                decoder["dataset_query_hash"] = query_hash
                break


def bind_wb_advertising_coverage(files, portable):
    """Keep strict row IDs and document omissions from a successful WB fullstats request."""
    sources = json.loads(files["dataset_sources.json"])
    queries = json.loads(files["dataset_queries.json"])
    previous_source = digest(sources)
    previous_query = digest({"queries": queries, "sources": sources})
    check = sources["sources"]["ds_wb_adstats"]["response"]["root_asserts"][0]
    expected = ["eq", {"$fn": ["len", {"$path": ["records"]}]},
                {"$fn": ["len", {"$path": ["params", "campaigns"]}]}]
    if check != {"test": {"$fn": expected}, "code": "DATASET_CAMPAIGN_COVERAGE"}:
        raise ValueError("Review the source coverage condition before packaging")
    # Missing rows are visible in the chat. Membership, unique IDs, date bounds
    # and daily-to-period validation still run on every returned campaign.
    check["test"]["$fn"][0] = "le"
    for key in ("wb_active_ads", "wb_active_ads_totals", "wb_supported_ads"):
        queries["queries"][key]["notes"][1] = (
            "Если Wildberries не прислал строки по части кампаний, сводка охватывает только полученные строки. "
            "Отсутствие строк не означает нулевой расход, показы или заказы."
        )
    files["dataset_sources.json"] = json.dumps(sources, ensure_ascii=False, indent=2).encode() + b"\n"
    files["dataset_queries.json"] = json.dumps(queries, ensure_ascii=False, indent=2).encode() + b"\n"
    for name, proof in portable.items():
        if name not in sources["sources"] or proof.get("dataset_source_hash") != previous_source:
            continue
        proof["dataset_source_hash"] = digest(sources)
        if proof.get("dataset_query_hash") == previous_query:
            proof["dataset_query_hash"] = digest({"queries": queries, "sources": sources})


def bind_wb_advertising_statuses(files, portable):
    """Keep current campaign status separate from statistics over a period."""
    sources = json.loads(files["dataset_sources.json"])
    queries = json.loads(files["dataset_queries.json"])
    templates = json.loads(files["template_catalog.json"])
    previous_source = digest(sources)
    previous_query = digest({"queries": queries, "sources": sources})

    inventory = sources["sources"]["ds_wb_campaigns"]["response"]
    raw_campaign = inventory["items"]["$fn"][1]["$map"][2]["$map"][2]
    raw_campaign["changed_at"] = {"$path": ["ad", "changeTime"], "default": None}
    inventory["map"]["changed_at"] = {"$path": ["row", "changed_at"]}
    status = {"$path": ["row", "status"]}
    label = "другой статус"
    for code, text in ((4, "готова к запуску"), (7, "завершена"), (9, "активна"), (11, "на паузе")):
        label = {"$if": [{"$fn": ["eq", status, code]}, text, label]}
    inventory["map"]["status_label"] = label

    active_note = "В этот отчёт входят только кампании со статусом 9 на момент запроса WB. Кампании на паузе, завершённые и готовые к запуску учитываются отдельно."
    supported_note = "Статус кампании относится к моменту запроса, показатели относятся к запрошенному периоду. Различай активные, приостановленные и завершённые кампании."
    coverage_note = "Если WB не вернул строку за период, соответствующие метрики остаются неизвестными. Нулевые значения допускаются только по полученным строкам."
    for key in ("wb_active_ads", "wb_active_ads_totals", "wb_supported_ads"):
        query = queries["queries"][key]
        template = templates["templates"][key]
        stage = next(s for s in query["flows"]["wb"] if s["source"] == "ds_wb_adstats")
        if key in ("wb_active_ads", "wb_active_ads_totals"):
            predicate = stage["foreach"]["$map"][0]["$fn"][1]["$map"][0]["$filter"][2]["$fn"]
            if predicate[-1] != [9, 11]:
                raise ValueError("Review the active WB campaign selection")
            predicate[-1] = [9]
            template["notes"][0] = query["notes"][0] = active_note
        else:
            query["columns"].insert(1, {"field": "status_at_request", "label": "статус на момент запроса", "kind": "text"})
            query["relations"] = [{
                "id": "classified", "label": "текущий статус кампании",
                "left": "rows", "right": ["campaigns"], "on": [["key", "key"]],
                "parent_keys": [], "left_where": True, "capacity": None, "preserve": ["spend", "views", "clicks", "orders"],
                "fields": {"status_at_request": {"source": "status_label", "unknown": "неизвестно", "unknown_values": []}},
                "coverage_field": "status_match", "missing": "reject",
            }]
            query["output_stage"] = "classified"
            template["columns"] = deepcopy(query["columns"])
            template["relations"] = deepcopy(query["relations"])
            template["output_stage"] = query["output_stage"]
            template["notes"][0] = query["notes"][0] = supported_note
        template["notes"][1] = query["notes"][1] = coverage_note
        step = next(s for s in template["steps"] if s["operation"] == "ds_wb_adstats")
        step["params"] = deepcopy(stage["foreach"])

    source_hash = digest(sources)
    query_hash = digest({"queries": queries, "sources": sources})
    for name, proof in portable.items():
        if name not in sources["sources"] or proof.get("dataset_source_hash") != previous_source:
            continue
        proof["dataset_source_hash"] = source_hash
        if proof.get("dataset_query_hash") == previous_query:
            proof["dataset_query_hash"] = query_hash
    for name, value in (("dataset_sources.json", sources), ("dataset_queries.json", queries),
                        ("template_catalog.json", templates)):
        files[name] = json.dumps(value, ensure_ascii=False, indent=2).encode() + b"\n"


def patch_runtime(files, filename, old, new):
    source = files[filename].decode()
    if source.count(old) != 1:
        raise ValueError(f"Review the chat integration point in {filename}")
    files[filename] = source.replace(old, new).encode()


def bind_ozon_packaging_cost(files):
    """Put materials and packing services on independent reconciled expense lines."""
    articles = {"packaging": (38, "Материалы для упаковки"), "packing_service": (39, "Услуга упаковки")}
    other_path = "parameter_support/economics_other_catalog.json"
    other = json.loads(files[other_path])
    other["approved_packaging_types"] = {name: type_id for name, (type_id, _) in articles.items()}
    files[other_path] = json.dumps(other, ensure_ascii=False, indent=2).encode() + b"\n"

    source = "parameter_support/economics_other.py"
    patch_runtime(files, source,
        "KNOWN=OTHER|set(CATALOG['excluded_delivery_types'])",
        "PACKAGING=CATALOG['approved_packaging_types']\n"
        "APPROVED=OTHER|set(PACKAGING.values())\n"
        "KNOWN=APPROVED|set(CATALOG['excluded_delivery_types'])")
    patch_runtime(files, source, "if kind in OTHER:selected.append(", "if kind in APPROVED:selected.append(")
    patch_runtime(files, source, "for entry in entries if entry['type_id']in OTHER)",
        "for entry in entries if entry['type_id']in APPROVED)")
    patch_runtime(files, source, "    inputs=_inputs(rows,selected)",
        "    inputs=_inputs(rows,[entry for entry in selected if entry['type_id']in OTHER])\n"
        "    for article,type_id in PACKAGING.items():\n"
        "        charges=_inputs(rows,[entry for entry in selected if entry['type_id']==type_id])\n"
        "        for key,line in inputs.items():\n"
        "            line[article]=charges[key]")

    cohort_path = "parameter_support/economics_cohort_catalog.json"
    cohort = json.loads(files[cohort_path])
    for name, (type_id, _) in articles.items():
        cohort["fee_groups"][name] = {**cohort["fee_groups"]["other"], "types": [type_id]}
        cohort["posting_allocations"][name] = cohort["posting_allocations"]["other"]
        cohort["line_inputs"][name] = {**deepcopy(cohort["line_inputs"]["other"]), "fee_group": name}
        cohort["row_outputs"][name] = {"input": name}
        cohort["report_outputs"]["all_selected_costs"] = {"add": [
            cohort["report_outputs"]["all_selected_costs"], {"input": name}]}
    after_other = cohort["money_outputs"].index("other") + 1
    cohort["money_outputs"][after_other:after_other] = list(articles)
    files[cohort_path] = json.dumps(cohort, ensure_ascii=False, indent=2).encode() + b"\n"
    patch_runtime(files, "parameter_support/economics_cohort.py",
        "                if group=='other'and other_inputs is not None:\n"
        "                    observed=other_inputs[c.CANON(k)]",
        f"                if group in {('other', *articles)!r} and other_inputs is not None:\n"
        "                    observed=other_inputs[c.CANON(k)]\n"
        "                    if group!='other':observed=observed[group]")

    for path, key in (("template_catalog.json", "templates"),
                      ("parameter_support/parameter_report_catalog.json", "reports")):
        catalog = json.loads(files[path])
        report = catalog[key]["economics.unit_forecast.v1"]
        after_other = report["metrics"].index("other") + 1
        report["metrics"][after_other:after_other] = list(articles)
        notes = report["notes"]
        notes[0] = notes[0].replace("все девять групп расходов", "все статьи расходов")
        notes.append("Материалы для упаковки и услуга упаковки Ozon — отдельные фактические статьи в обоих сценариях. "
                     "Сохраняй знак корректировок. Коэффициент потерь на эти расходы не влияет, прочие расходы их не включают.")
        files[path] = json.dumps(catalog, ensure_ascii=False, indent=2).encode() + b"\n"
    labels = "".join(f"{name!r}: {label!r}, " for name, (_, label) in articles.items())
    patch_runtime(files, "direct_response.py",
        "            'cogs': 'Себестоимость',",
        f"            {labels}'cogs': 'Себестоимость',")
    patch_runtime(files, "chat_response.py",
        "    labels = {'revenue': 'Выручка', 'all_selected_costs': 'Выбранные расходы',",
        f"    labels = {{'revenue': 'Выручка', {labels.rstrip()}\n"
        "              'all_selected_costs': 'Выбранные расходы',")


def bind_unclassified_ozon_fee_diagnostics(files):
    source = "parameter_support/economics_other.py"
    patch_runtime(files, source, "def _entry(entry,posting,received):\n",
        "def _require_known_fee(kind):\n"
        "    if kind not in KNOWN:\n"
        "        from platform_core.marketplace_matrix.worker import log_failure\n"
        "        log_failure('ozon_accrual_type', str(kind))\n"
        "        raise OtherError('OTHER_UNCLASSIFIED_FEE')\n\n\n"
        "def _entry(entry,posting,received):\n")
    patch_runtime(files, source, "    need(kind in KNOWN,'OTHER_UNCLASSIFIED_FEE')\n    day,",
        "    _require_known_fee(kind)\n    day,")
    patch_runtime(files, source, "        need(kind in KNOWN,'OTHER_UNCLASSIFIED_FEE')\n        entry=",
        "        _require_known_fee(kind)\n        entry=")


def bind_ozon_tariff_page_totals(files):
    """Accept Seller API's replacement field without weakening completeness checks."""
    normalizer = "parameter_support/economics_tariffs.py"
    patch_runtime(files, normalizer, "def normalize(price_pages,product_pages,target,*,verify,encode):\n",
        "def price_page_total(data):\n"
        "    required = {'items', 'cursor'}\n"
        "    count_fields = {'total', 'total_items'}\n"
        "    need(type(data) is dict and required <= data.keys() <= required | count_fields\n"
        "         and type(data['items']) is list and type(data['cursor']) is str, 'TARIFF_RESPONSE_SCHEMA')\n"
        "    totals = [data[name] for name in count_fields if name in data]\n"
        "    need(totals and all(type(value) is int and value >= 0 for value in totals), 'TARIFF_RESPONSE_SCHEMA')\n"
        "    need(len(set(totals)) == 1, 'TARIFF_TOTAL_CHANGED')\n"
        "    return totals[0]\n\n\n"
        "def normalize(price_pages,product_pages,target,*,verify,encode):\n")
    patch_runtime(files, normalizer,
        "  need(type(data)is dict and {'items','cursor','total'}<=set(data)<={'items','cursor','total','total_items'}\n"
        "      and type(data['items'])is list and type(data['cursor'])is str and type(data['total'])is int and data['total']>=0,'TARIFF_RESPONSE_SCHEMA')\n"
        "  if total is None:total=data['total']\n"
        "  need(data['total']==total and data.get('total_items',total)==total,'TARIFF_TOTAL_CHANGED')\n",
        "  page_total = price_page_total(data)\n"
        "  if total is None:total=page_total\n"
        "  need(page_total==total,'TARIFF_TOTAL_CHANGED')\n")
    patch_runtime(files, "tariff_source_runtime.py",
        "                need({'items','cursor','total'}<=set(answer)<={'items','cursor','total','total_items'}and type(answer['items'])is list\n"
        "                    and type(answer['cursor'])is str and type(answer['total'])is int and answer['total']>=0,'TARIFF_RESPONSE_SCHEMA')\n"
        "                need(answer.get('total_items',answer['total'])==answer['total'],'TARIFF_TOTAL_CHANGED')\n"
        "                if state['total']is None:state['total']=answer['total']\n"
        "                need(state['total']==answer['total'],'TARIFF_TOTAL_CHANGED')\n",
        "                page_total=source.price_page_total(answer)\n"
        "                if state['total']is None:state['total']=page_total\n"
        "                need(state['total']==page_total,'TARIFF_TOTAL_CHANGED')\n")


def bind_ozon_cohort_tariffs(files):
    normalizer = "parameter_support/economics_tariffs.py"
    patch_runtime(files, normalizer,
        "  else:need(not next_cursor,'TARIFF_SOURCE_INCOMPLETE')\n",
        "  else:need(not next_cursor or 'product_id' in filters,'TARIFF_SOURCE_INCOMPLETE')\n")
    patch_runtime(files, normalizer,
        " need(len(prices)==total,'TARIFF_TOTAL_INCOMPLETE')\n",
        " need(len(prices)==total,'TARIFF_TOTAL_INCOMPLETE')\n"
        " if 'product_id' in filters:\n"
        "  need(set(prices)=={identifier(pid) for pid in filters['product_id']},'TARIFF_QUOTE_OR_SKU_MISSING')\n")
    patch_runtime(files, normalizer,
        "  need(type(request)is dict and set(request)=={'product_id'}and type(request['product_id'])is list and request['product_id'],'TARIFF_PRODUCT_REQUEST')\n"
        "  ids=[identifier(v)for v in request['product_id']];need(len(ids)==len(set(ids)),'TARIFF_PRODUCT_REQUEST')",
        "  need(type(request)is dict and set(request) in ({'product_id'},{'sku'}),'TARIFF_PRODUCT_REQUEST')\n"
        "  key = next(iter(request))\n"
        "  need(type(request[key]) is list and request[key],'TARIFF_PRODUCT_REQUEST')\n"
        "  ids=[identifier(v)for v in request[key]];need(len(ids)==len(set(ids)),'TARIFF_PRODUCT_REQUEST')")
    patch_runtime(files, normalizer,
        "   need(pid in ids and pid not in returned and pid not in products,'TARIFF_MAPPING_CONFLICT')\n"
        "   returned.add(pid);products[pid]=sku",
        "   requested = sku if key=='sku' else pid\n"
        "   need(requested in ids and requested not in returned and pid not in products,'TARIFF_MAPPING_CONFLICT')\n"
        "   returned.add(requested);products[pid]=sku")

    runtime = "tariff_source_runtime.py"
    patch_runtime(files, runtime,
        "from datetime import datetime, timezone\n",
        "from platform_core.marketplace_matrix import tariff_cohort\n")
    patch_runtime(files, runtime, "from parameter_source_runtime import _token\nfrom period_cost_source_runtime import _transport_body\n", "")
    patch_runtime(files, runtime, "import base64, json, secrets", "import base64, secrets")
    patch_runtime(files, runtime,
        "# These are the documented per-request capacities, not total report quotas.\n"
        "PRICE_LIMIT=1000\nPRODUCT_LIMIT=1000\nFILTER={'visibility':'ALL'}\n", "")
    patch_runtime(files, runtime,
        "    'wire_encoder':sha256(Path(__import__('period_cost_source_runtime').__file__).read_bytes()).hexdigest(),\n"
        "    'limits':[PRICE_LIMIT,PRODUCT_LIMIT],'filter':FILTER})",
        "    'wire_encoder':sha256(Path(__import__('period_cost_source_runtime').__file__).read_bytes()).hexdigest(),\n"
        "    'cohort_source':sha256(Path(tariff_cohort.__file__).read_bytes()).hexdigest()})")
    patch_runtime(files, runtime,
        "        need(type(state)is dict and set(state)=={'phase','cursor','seen_cursors','total','product_ids','mapped',\n"
        "            'price_pages','product_pages','receipts'},'TARIFF_PROGRESS_INTEGRITY')\n"
        "        need(state['phase']in('prices','products','ready'),'TARIFF_PROGRESS_INTEGRITY')",
        "        need(tariff_cohort.open_state(state),'TARIFF_PROGRESS_INTEGRITY')")
    content = files[runtime].decode()
    head, controller = content.split("def _request(store,state):\n")
    _, verifier = controller.split("def _verifier(")
    verifier, _ = verifier.split("def _normalize(")
    files[runtime] = (head + "def _verifier(" + verifier
                      + "from platform_core.marketplace_matrix.tariff_cohort import restore, step\n").encode()

    report = "economics_report_runtime.py"
    patch_runtime(files, report,
        "        'tariff_prices':('product_prices_bulk','read_surface',{'visibility':'ALL','pagination':'complete'}),\n"
        "        'tariff_skus':('seller_product_info_list','read_surface',{'product_id':'verified_price_products'}),",
        "        'tariff_prices':('product_prices_bulk','read_surface',"
        "{'visibility':'ALL','pagination':'complete','product_id':'verified_order_products'}),\n"
        "        'tariff_skus':('seller_product_info_list','read_surface',{'sku':'verified_order_skus'}),")
    for method in ("step", "restore"):
        call = f"tariff_source.{method}(worker,row,root,sources['tariffs'],state['tariffs'],authorize=authorize"
        patch_runtime(files, report, call, call.replace("authorize=", "orders=orders.data['rows'],authorize="))
    for filename, key, steps_key in (("template_catalog.json", "templates", "steps"),
                                     ("parameter_support/parameter_report_catalog.json", "reports", "source_steps")):
        catalog = json.loads(files[filename])
        steps = catalog[key]["economics.unit_forecast.v1"][steps_key]
        by_name = {step["id"]: step for step in steps}
        by_name["tariff_prices"]["params"]["product_id"] = "verified_order_products"
        by_name["tariff_skus"]["params"] = {"sku": "verified_order_skus"}
        files[filename] = json.dumps(catalog, ensure_ascii=False, indent=2).encode() + b"\n"


def bind_report_previews(files):
    filename = "parameter_report_runtime.py"
    patch_runtime(files, filename,
        "def _bind(worker,row,root,fragment):\n",
        "def _bind(worker,row,root,fragment):\n"
        " binder=_api(worker)\n"
        " if getattr(binder,'preview_only',False):return binder.bind(worker,row,root,fragment)\n")
    patch_runtime(files, filename,
        " local_root={**root,'parameter_admission':descriptor}\n",
        " local_root={**root,'parameter_admission':descriptor}\n"
        " if getattr(_api(worker),'preview_only',False):\n"
        "  local_root=root;draft['parameter_mode']='preview'\n")
    patch_runtime(files, filename,
        "   need(result.get('saved')is True,'PARAMETER_WRITE_NOT_CONFIRMED')\n",
        "   binder=_api(worker)\n"
        "   if getattr(binder,'preview_only',False):binder.accept_result(state['reference'],state['producer'],result)\n"
        "   else:need(result.get('saved')is True,'PARAMETER_WRITE_NOT_CONFIRMED')\n")
    patch_runtime(files, filename,
        "  need(reply.get('saved')is True,'PARAMETER_WRITE_NOT_CONFIRMED')\n",
        "  binder=_api(worker)\n"
        "  if getattr(binder,'preview_only',False):binder.accept_result(state['reference'],state['fragment'],reply)\n"
        "  else:need(reply.get('saved')is True,'PARAMETER_WRITE_NOT_CONFIRMED')\n")
    patch_runtime(files, filename,
        "'calendar_date':today,'timezone':'Europe/Moscow','parameter_periods':value['parameter_periods']}\n",
        "'calendar_date':today,'timezone':'Europe/Moscow','parameter_periods':value['parameter_periods'],"
        "'owner_inputs':value.get('owner_inputs',{})}\n")
    filename = "economics_report_runtime.py"
    patch_runtime(files, filename,
        "_input({'period':draft['period'],'parameter_periods':draft['parameter_periods']},root['calendar_date'])",
        "_input({'period':draft['period'],'parameter_periods':draft['parameter_periods'],"
        "'owner_inputs':draft.get('owner_inputs',{})},root['calendar_date'])")
    patch_runtime(files, filename,
        "        tariff_block=tariffs.for_cohort(orders.data['rows'],period,target)\n",
        "        from parameter_support.economics_tariffs import TariffError\n"
        "        try:tariff_block=tariffs.for_cohort(orders.data['rows'],period,target)\n"
        "        except TariffError as error:raise Rejected(error.code)from None\n")
    filename = "parameter_support/parameter_report_contract.py"
    patch_runtime(files, filename, "'group_by','parameter_periods'},'PARAMETER_REPORT_INPUT')",
        "'group_by','parameter_periods','owner_inputs'},'PARAMETER_REPORT_INPUT')")
    patch_runtime(files, filename,
        " return {'period':deepcopy(value['period']),'parameter_periods':deepcopy(periods)}",
        " from platform_core.marketplace_matrix.forecast_preview import normalise_owner_inputs\n"
        " owner=normalise_owner_inputs(value.get('owner_inputs',{}))\n"
        " return {'period':deepcopy(value['period']),'parameter_periods':deepcopy(periods),"
        "**({'owner_inputs':owner}if owner else{})}")


def bind_ozon_posting_money(files):
    filename = "parameter_support/economics_orders.py"
    patch_runtime(files, filename,
        "            price=_number(product[fields['seller_price']]);quantity=_number(product[fields['quantity']])\n",
        "            price=product[fields['seller_price']]\n"
        "            if type(price)is dict:\n"
        "                need(set(price)=={'amount','currency'},'ORDERS_NUMBER')\n"
        "                need(price['currency']=='RUB','ORDERS_CURRENCY')\n"
        "                price=price['amount']\n"
        "            price=_number(price);quantity=_number(product[fields['quantity']])\n")


def bind_read_builder_cache(files):
    filename = "read_surface.py"
    patch_runtime(files, filename, "from pathlib import Path\n",
        "from pathlib import Path\nfrom functools import lru_cache\n")
    patch_runtime(files, filename,
        "    try:\n        proc=subprocess.run(['node',str(DATA/'contract_bridge.mjs')],input=payload,capture_output=True,text=True,timeout=5)\n"
        "        response=json.loads(proc.stdout)\n",
        "    return json.loads(_checked_wire_request(payload,platform))\n\n\n"
        "@lru_cache(maxsize=256)\n"
        "def _checked_wire_request(payload,platform):\n"
        "    # Each verified report replays earlier receipts. Reuse the pure builder\n"
        "    # result for identical arguments in this worker, not data or access decisions.\n"
        "    try:\n        proc=subprocess.run(['node',str(DATA/'contract_bridge.mjs')],input=payload,capture_output=True,text=True,timeout=5)\n"
        "        response=json.loads(proc.stdout)\n")
    patch_runtime(files, filename, "    return request\n\n\ndef quota(",
        "    return canonical_json(request)\n\n\ndef quota(")


def bind_ozon_coefficient_items(files):
    """Extend the existing authenticated source workflow with item-level financial receipts."""
    files["ozon_sku_delivery.py"] = (Path(__file__).resolve().parents[1] /
        "platform_core/marketplace_matrix/ozon_sku_delivery.py").read_bytes()
    patch_runtime(files,"read_surface.py",
        "    try:\n        proc=subprocess.run(['node',str(DATA/'contract_bridge.mjs')],input=payload,capture_output=True,text=True,timeout=5)\n"
        "        response=json.loads(proc.stdout)\n"
        "    except (OSError,ValueError,subprocess.TimeoutExpired):raise Rejected('READ_BUILDER_UNAVAILABLE')from None",
        "    from platform_core.marketplace_matrix.read_builder import checked_response\n"
        "    response=checked_response(DATA/'contract_bridge.mjs',payload)")
    producer="parameter_support/parameter_producers.py"
    source="parameter_source_runtime.py"
    # Historical Seller reports also include a numeric delivery-speed field.
    # Keep it in the receipt hash; it is not a monetary service component.
    patch_runtime(files,"parameter_support/economics_accruals.py",
        "  value=record['posting'];exact(value,('delivery_schema','products'))",
        "  value=record['posting'];fields=('delivery_schema','products')\n"
        "  if type(value)is dict and 'delivery_speed'in value:\n"
        "   need(value['delivery_speed'] is None or type(value['delivery_speed'])is int,'ACCRUAL_DELIVERY_SPEED')\n"
        "   fields+=('delivery_speed',)\n"
        "  exact(value,fields)")
    # The wire report is verified and fully decoded first. Retain only the
    # requested product in SKU checkpoints and out-of-period return lookups.
    patch_runtime(files,source,"                values=_table_orders(worker,row,state['step'],answer)",
        "                values=_table_orders(worker,row,state['step'],answer)\n"
        "                sku=p['target']['scope']['sku']\n"
        "                if sku:values=[v for v in values if v['sku']==sku]")
    patch_runtime(files,source,"                values,postings=_return_rows(worker,row,answer);state['rows']+=values;state['postings'].update(postings)",
        "                values,postings=_return_rows(worker,row,answer)\n"
        "                sku=p['target']['scope']['sku']\n"
        "                if sku:values=[v for v in values if v['sku']==sku]\n"
        "                state['rows']+=values;state['postings'].update({v['posting']:postings[v['posting']] for v in values})")
    rules=json.loads(files["parameter_support/parameter_producers.json"])
    finance=rules["sources"]["finance"]
    finance["scopes"].append("sku")
    finance["operations"].extend(("finance_accrual_types","finance_accrual_by_day"))
    files["parameter_support/parameter_producers.json"]=json.dumps(rules,ensure_ascii=False,indent=2).encode()+b"\n"
    patch_runtime(files,producer,
        "        if source=='finance':need(target['scope']['kind']in spec['scopes'],'PARAMETER_SOURCE_SCOPE_UNAVAILABLE')",
        "        if source=='finance' and target['scope']['kind']=='sku':\n"
        "            from ozon_sku_delivery import steps\n"
        "            required.extend(steps(period['actual']));continue")
    patch_runtime(files,producer,"            need(target['scope']['kind']=='store','PARAMETER_SOURCE_SCOPE_UNAVAILABLE')",
        "            need(target['scope']['kind'] in spec['scopes'],'PARAMETER_SOURCE_SCOPE_UNAVAILABLE')")
    patch_runtime(files,source,"import read_surface as surface","import read_surface as surface\nimport ozon_sku_delivery as sku_delivery")
    patch_runtime(files,source,"for m in (pc,pp)","for m in (pc,pp,sku_delivery)")
    patch_runtime(files,source,"'returns_list','finance_balance','posting_fbo_get'",
        "'returns_list','finance_balance','finance_accrual_types','finance_accrual_by_day','posting_fbo_get'")
    patch_runtime(files,source,"'controls':json.loads(produced.proof_json)['controls']",
        "'controls':json.loads(produced.proof_json)['controls'],'inputs':envelope['inputs']")
    patch_runtime(files,source,"            elif operation=='finance_balance':",
        "            elif operation=='finance_accrual_types':\n"
        "                state['delivery_types']=sku_delivery.types(answer);state['i']+=1;state['phase']='next'\n"
        "            elif operation=='finance_accrual_by_day':\n"
        "                if sku_delivery.receive(state,answer,p['target']['scope']['sku']):\n"
        "                    _batch(p,state,state['step'],state['rows'],stamp)\n"
        "            elif operation=='finance_balance':")


def bind_coefficient_guidance(files):
    catalog = json.loads(files["template_catalog.json"])
    templates = catalog["templates"]
    previews = (
        "По умолчанию используй последние 12 месяцев по московскому календарю. "
        "Для явно указанного интервала передай его без подмены. "
        "Покажи фактический период расчёта и дату получения данных. "
        "Расчёт в чате не сохраняет коэффициент."
    )
    basis = (
        "Период прогноза относится к заказам. Периоды расчёта коэффициентов указывай отдельно. "
        "Покажи коэффициенты, их периоды и источник значений. "
        "Используй результаты матрицы, округляй только для отображения."
    )
    templates["parameter.loss_rate.v1"]["notes"] = [
        "Раздели число уникальных потерянных физических единиц на исходное число заказанных единиц FBO и FBS. "
        "К потерям относятся отмены, невыкупы и возвраты по этим исходным заказам. "
        "Один экземпляр учитывается один раз, даже если он есть и в отменах, и в возвратах. "
        "Незавершённые единицы входят в знаменатель, показываются отдельно и не считаются выкупами. "
        "Долю можно показать в процентах. При нулевом знаменателе доля не определена.",
        previews,
    ]
    templates["parameter.delivery_mean.v1"]["notes"] = [
        "Сложи подтверждённые расходы Ozon на прямую доставку и последнюю доставку за период "
        "по дате начисления с учётом корректировок. Раздели на все исходно заказанные физические единицы FBO и FBS "
        "по дате принятия в обработку за тот же интервал. Результат в рублях на заказанную единицу. "
        "Обратная логистика и обработка FBS учитываются отдельно. Доля потерь знаменатель не меняет. "
        "Сумму общего финансового отчёта нельзя распределять по SKU без детализации. "
        "При нулевом знаменателе среднее не определено.",
        previews,
    ]
    templates["economics.delivery_projection.v1"]["notes"] = [
        "Покажи ожидаемые потери N × k, ожидаемые оставшиеся единицы N × (1 − k) "
        "и прогноз прямой плюс последней доставки N × d. Здесь N — исходно заказанные единицы, "
        "k — доля потерь, d — средняя объединённая доставка в рублях. "
        "Сумма доставки считается на всё исходное количество. Это прогноз.",
        basis,
    ]
    unit_notes = templates["economics.unit_forecast.v1"]["notes"]
    unit_notes[:] = [note for note in unit_notes if "текущие коэффициенты" not in note]
    unit_notes.append(basis + " Покажи основу себестоимости. При неизвестном налоге или собственных расходах "
                             "укажи, до каких расходов рассчитан остаток.")
    files["template_catalog.json"] = json.dumps(catalog, ensure_ascii=False, indent=2).encode() + b"\n"

    report_path = "parameter_support/parameter_report_catalog.json"
    reports = json.loads(files[report_path])
    outputs = reports["reports"]["economics.delivery_projection.v1"]["outputs"]
    for field, label in {
        "estimated_retained_units": "Ожидаемые единицы, оставшиеся у покупателей",
        "estimated_failed_units": "Ожидаемые потери",
        "estimated_forward_last_delivery": "Ожидаемая прямая и последняя доставка",
    }.items():
        outputs[field]["label"] = label
    files[report_path] = json.dumps(reports, ensure_ascii=False, indent=2).encode() + b"\n"
    patch_runtime(files, "direct_response.py",
        "    if 'estimates' in context:\n",
        "    from platform_core.marketplace_matrix.forecast_preview import coefficient_lines, unit_cost_lines\n"
        "    if 'estimates' in context:\n")
    patch_runtime(files, "direct_response.py",
        """            value = str(item['value']).replace('.', ',')
            unit = item.get('unit', '')
            suffix = {'RUB': ' ₽', 'rub': ' ₽', 'units': ' шт.', 'ratio': ' (доля)'}.get(unit, ' ' + unit)
            lines.append(f'{label}: {value}{suffix}.')
""",
        """            with localcontext() as arithmetic:
                arithmetic.prec = 80
                value = str(Decimal(item['value']).quantize(Decimal('.01'), rounding=ROUND_HALF_UP)).replace('.', ',')
            unit = item.get('unit', '')
            suffix = {'RUB': ' ₽', 'rub': ' ₽', 'units': ' шт.', 'estimated_item': ' шт.',
                      'ratio': ' (доля)'}.get(unit, ' ' + unit)
            lines.append(f'{label} {value}{suffix}.')
        lines.extend(coefficient_lines(context.get('parameters_used', ())))
""")
    patch_runtime(files, "direct_response.py",
        "        lines.append('Расходы периода распределены",
        "        lines.extend(coefficient_lines(value.get('parameters_used', ())))\n"
        "        lines.extend(unit_cost_lines(value.get('unit_cost_basis', ())))\n"
        "        lines.append('Расходы периода распределены")
    patch_runtime(files, "chat_response.py",
        "    if isinstance(period, dict) and period.get('from') and period.get('to'):\n",
        "    period = period or plan.get('parameter_report', {}).get('input', {}).get('period')\n"
        "    if isinstance(period, dict) and period.get('from') and period.get('to'):\n")


def collect(core, renderer, config):
    files = {}
    sources = {p.stem: p for p in core.glob("*.py")}
    sources.update({p.stem: p for p in renderer.glob("*_response.py")})
    pending = ["engine", "repository", "http_transport", "direct_response", "chat_response",
               "template_runtime", "template_catalog", "protected_reads", "failure_explanations"]
    while pending:
        name = pending.pop()
        path = sources.get(name)
        if path is None or path.name in files:
            continue
        files[path.name] = path.read_bytes()
        for node in ast.walk(ast.parse(files[path.name])):
            if isinstance(node, ast.ImportFrom) and node.module:
                pending.append(node.module.split(".")[0])
            if isinstance(node, ast.Import):
                pending.extend(a.name.split(".")[0] for a in node.names)
    for path in sorted((core / "parameter_support").glob("*")):
        if path.suffix in (".py", ".json"):
            files[str(path.relative_to(core))] = path.read_bytes()
    for glob in ("*_catalog.json", "scalar_source_catalog.json", "base_blocks.json", "dataset_queries.json",
                 "dataset_sources.json", "source_matrix.json", "registry.json", "subscription_access.json.gz",
                 "resource_limits.json", "runtime_task_v1.schema.json", "read_surface_data/contract_bridge.mjs",
                 "read_surface_data/*.gz"):
        for path in core.glob(glob):
            files[str(path.relative_to(core))] = path.read_bytes()
    # Export the qualifications for source implementations. Seller-specific attestations
    # do not authorize another account and must never be included in a release.
    portable = {}
    for operation, proof in config["qualifications"].items():
        if {"scope", "contract_scopes"} & proof.keys():
            continue
        portable[operation] = {k: v for k, v in proof.items() if k != "evidence_ref"}
        portable[operation]["evidence_ref"] = "reviewed-source/" + operation
    bind_table_contracts(portable, config.get("table_capabilities", {}), files)
    bind_dataset_contracts(portable, config.get("dataset_capabilities", {}), files)
    bind_wb_advertising_coverage(files, portable)
    bind_wb_advertising_statuses(files, portable)
    group_table_requests(files)
    bind_node_runtime(files)
    bind_provider_retry(files)
    bind_report_previews(files)
    bind_ozon_posting_money(files)
    bind_read_builder_cache(files)
    bind_coefficient_guidance(files)
    bind_ozon_coefficient_items(files)
    bind_ozon_packaging_cost(files)
    bind_unclassified_ozon_fee_diagnostics(files)
    bind_ozon_tariff_page_totals(files)
    bind_ozon_cohort_tariffs(files)
    files["source_qualifications.json"] = json.dumps(portable, sort_keys=True).encode()
    # Both discovery and selection compilation call the same catalogue hook.
    target = b"def _availability(engine,t,store):\n"
    if files["template_catalog.py"].count(target) != 1:
        raise ValueError("Review template availability before updating the runtime")
    files["template_catalog.py"] = files["template_catalog.py"].replace(target, target +
        b"    available = getattr(engine, 'store_template_available', None)\n"
        b"    if available is not None and not available(t, store):return False\n")
    target = b"        if state=='select':\n"
    if files["template_runtime.py"].count(target) != 1:
        raise ValueError("Review the direct template compilation entry point")
    files["template_runtime.py"] = files["template_runtime.py"].replace(target, target +
        b"            if getattr(worker.engine, 'chat_template_selection', None) is not None:\n"
        b"                _compile_and_save_selection(worker,row,plan,progress,worker.engine.chat_template_selection)\n"
        b"                return\n")
    bind_report_currency(files)
    return files


def write_bundle(path, data):
    with path.open("wb") as out, gzip.GzipFile(filename="", fileobj=out, mode="wb", mtime=0) as gz:
        with tarfile.open(fileobj=gz, mode="w") as archive:
            for name, body in sorted(data.items()):
                entry = tarfile.TarInfo(name)
                entry.size, entry.mode = len(body), 0o644
                archive.addfile(entry, io.BytesIO(body))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("core", "renderer", "config", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    data = collect(args.core, args.renderer, json.loads(args.config.read_bytes()))
    write_bundle(args.output, data)
    print(len(data), "source and catalogue files")


if __name__ == "__main__":
    main()
