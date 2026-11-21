"""Build the standalone source package from the pinned matrix and chat renderer releases."""
import argparse
import ast
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


def patch_runtime(files, filename, old, new):
    source = files[filename].decode()
    if source.count(old) != 1:
        raise ValueError(f"Review the chat integration point in {filename}")
    files[filename] = source.replace(old, new).encode()


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
    group_table_requests(files)
    bind_node_runtime(files)
    bind_provider_retry(files)
    bind_report_previews(files)
    bind_ozon_posting_money(files)
    bind_coefficient_guidance(files)
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("core", "renderer", "config", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    data = collect(args.core, args.renderer, json.loads(args.config.read_bytes()))
    with args.output.open("wb") as out, gzip.GzipFile(filename="", fileobj=out, mode="wb", mtime=0) as gz:
        with tarfile.open(fileobj=gz, mode="w") as archive:
            for name, body in sorted(data.items()):
                entry = tarfile.TarInfo(name)
                entry.size, entry.mode = len(body), 0o644
                archive.addfile(entry, io.BytesIO(body))
    print(len(data), "source and catalogue files")


if __name__ == "__main__":
    main()
