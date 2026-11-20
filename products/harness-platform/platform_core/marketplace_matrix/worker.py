"""Run the registered template compiler, HTTP recipes and renderer in an isolated process."""
from contextlib import redirect_stdout
from contextvars import copy_context
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import sys
import tarfile
import time
from types import SimpleNamespace
from zoneinfo import ZoneInfo


from .authority import ChatAuthority

BUNDLE = Path(__file__).with_name("runtime.tar.gz")
BUNDLE_SHA256 = "795cfb1da8dfe94f0415d2b450aa8f805ef44f2a334503b71b59a7c4e4cbdfc7"


def unpack(directory):
    if hashlib.sha256(BUNDLE.read_bytes()).hexdigest() != BUNDLE_SHA256:
        raise RuntimeError("Unexpected marketplace runtime")
    with tarfile.open(BUNDLE) as archive:
        archive.extractall(directory, filter="data")
    sys.path.insert(0, str(directory))


def configure_catalogue(engine, fields):
    from http_transport import MATRICES, SCALARS, SCALAR_SOURCES
    from platform_store_credentials import required_fields
    from template_catalog import TEMPLATES, dependencies
    proofs = json.loads(Path(sys.path[0], "source_qualifications.json").read_bytes())
    caps = {cid: proofs for cid in fields}
    engine.table_capabilities = engine.dataset_capabilities = lambda: caps

    def supported(template, store):
        for dependency in dependencies(template["id"]):
            for step in TEMPLATES[dependency]["steps"]:
                op = step.get("operation")
                if step.get("platform") != store.platform or op not in MATRICES:
                    continue
                recipe = MATRICES[op].recipe(op)
                needed = required_fields(recipe)
                profile = SCALARS.profile_for(op)
                if profile:
                    grant_op = SCALARS.auth[profile]["operation"]
                    if grant_op not in proofs:
                        return False
                    needed |= required_fields(SCALAR_SOURCES.recipe(grant_op))
                if op not in proofs or not needed.issubset(fields[store.id]):
                    return False
        return True
    engine.store_template_available = supported
    return proofs


def catalogue(profiles):
    from template_catalog import discovery
    from semantics import Scope, Store

    # This is static discovery on credential types. No account data or keys go to this process.
    stores = tuple(Store(key, provider, key, "", "") for key, provider, _ in profiles)
    fields = {key: set(names) for key, _, names in profiles}
    engine = SimpleNamespace()
    configure_catalogue(engine, fields)
    return [row for row in discovery(engine, Scope("", "", stores)) if row["available_stores"]]


def execute(packet, directory):
    from direct_response import answer_step
    from engine import CallError, Engine, Worker
    from failure_explanations import explain
    from http_transport import HTTPTransport
    import model_answer
    from repository import Repository
    from semantics import Rejected, fingerprint
    from template_catalog import HASH, TEMPLATES, dependencies, _availability
    from template_runtime import submit

    authority = ChatAuthority(packet)
    turn, pins = packet["turn"], authority.pins
    guard = {"pins": pins}
    repo = Repository(str(directory / "requests.sqlite"))
    engine = Engine(repo, lambda tenant: authority.scope_for(guard), execution_policy=authority, template_mode=True)
    allowed = {store.id: store for store in authority.scope_for(guard).stores}
    proofs = configure_catalogue(engine, {cid: authority.field_names(store) for cid, store in allowed.items()})
    calls = []
    for index, item in enumerate(packet["selections"], 1):
        tid, cid = item["templateId"], item["connectionId"]
        if tid not in TEMPLATES or cid not in allowed or not _availability(engine, TEMPLATES[tid], allowed[cid]):
            raise Rejected("SOURCE_ACCESS")
        calls.append({"id": str(index), "template_id": tid, "store_id": cid, "input": item["input"]})
    engine.chat_template_selection = {
        "action": "plan", "complete": True, "missing": [], "invocations": calls,
        "requirements": [{"id": call["id"], "description": TEMPLATES[call["template_id"]]["purpose"],
                          "invocations": [call["id"]]} for call in calls],
    }
    engine.harness_store_names = lambda plan: authority.names
    engine.program_answers = False
    model_answer.step = answer_step  # Only in this request's private child interpreter.
    operations = []

    class ChatTransport(HTTPTransport):
        def execute(self, request, store, *, on_dispatch=None):
            if store is None:
                raise CallError("MARKETPLACE_OPERATION_REQUIRED")
            context = copy_context()
            guard_dispatch = (lambda: context.run(on_dispatch)) if on_dispatch else None
            answer = super().execute(request, store, on_dispatch=guard_dispatch)
            operations.append({"operation": request.operation, "connectionId": store["id"]})
            return answer

    transport = ChatTransport(directory, {}, proofs, enabled=True)
    worker = Worker(engine, transport, execution_ready=authority.check)
    today = datetime.now(ZoneInfo("Europe/Moscow")).date()
    root = submit(engine, pins["tenant_id"], turn["question"], turn["requestId"],
                  fingerprint([turn["question"], calls]), today, execution_context=guard)
    while time.time() < authority.deadline:
        row = repo.get(pins["tenant_id"], root["job_id"])
        if row["state"] != "QUEUED":
            break
        delay = row["due"] - time.time()
        if delay > 0:
            if time.time() + delay >= authority.deadline:
                return {"ok": False, "reason": "Источник ограничил частоту запросов.", "retryAt": row["due"]}
            time.sleep(delay)
        worker.step()
    else:
        raise Rejected("DEADLINE_EXCEEDED")
    authority.check()
    plan = json.loads(row["plan"])
    selected = plan.get("selection", {}).get("invocations", [])
    for receipt in operations:
        platform = next(r[1] for r in authority.frozen if r[0] == receipt["connectionId"])
        field_map = {}
        for selection in selected:
            if selection["store_id"] != receipt["connectionId"]:
                continue
            for tid in dependencies(selection["template_id"]):
                for step in TEMPLATES[tid]["steps"]:
                    if step.get("platform") == platform and step.get("operation") == receipt["operation"]:
                        field_map.update(step.get("bind", {}).get("fields", {}))
        if field_map:
            receipt["metricFields"] = field_map
    trace = {"selectionBy": "chat_agent", "catalogHash": HASH, "catalogSize": len(TEMPLATES),
             "templates": [{"id": item["template_id"], "connectionId": item["store_id"]} for item in selected],
             "operations": operations}
    if turn.get("model"):
        trace["selectionModel"] = turn["model"]
    if row["state"] != "READY":
        code = row.get("error") or row["state"]
        return {"ok": False, "code": code, "reason": explain(code)["text"], "trace": trace}
    result = json.loads(row["result"])
    if result.get("clarification"):
        return {"ok": True, "clarification": result["clarification"]["question"], "trace": trace}
    presentation = result.get("chat_presentation") or {}
    return {"ok": not bool(result.get("failure_code")), "answer": presentation.get("details") or "\n".join(result.get("pages", [])),
            "code": result.get("failure_code"), "trace": trace}


def main():
    packet = json.load(sys.stdin)
    root = Path(packet["workingDirectory"])
    unpack(root / "runtime")
    from semantics import Rejected
    with open(os.devnull, "w") as sink, redirect_stdout(sink):
        try:
            result = catalogue(packet["profiles"]) if "profiles" in packet else execute(packet, root)
        except Rejected as error:
            from failure_explanations import explain
            result = {"ok": False, "code": error.code, "reason": explain(error.code)["text"]}
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
