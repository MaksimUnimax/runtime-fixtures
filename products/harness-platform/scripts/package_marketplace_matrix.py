"""Build the standalone source package from the pinned matrix and chat renderer releases."""
import argparse
import ast
import gzip
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
