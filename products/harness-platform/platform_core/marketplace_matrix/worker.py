"""Run the pinned selector, compiler, HTTP recipes and renderer in an isolated process."""
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
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import httpx

from .authority import ChatAuthority

BUNDLE = Path(__file__).with_name("runtime.tar.gz")
BUNDLE_SHA256 = "dd6c1f0fc70b6646d790304d9e8532b98732251ce400664cd83f27b03f41f870"


def unpack(directory):
    if hashlib.sha256(BUNDLE.read_bytes()).hexdigest() != BUNDLE_SHA256:
        raise RuntimeError("Unexpected marketplace runtime")
    with tarfile.open(BUNDLE) as archive:
        archive.extractall(directory, filter="data")
    sys.path.insert(0, str(directory))


def metered_selection(turn, request, on_dispatch):
    from engine import CallError
    from template_protocol import payload
    wire = payload(request.operation, request.body)
    url = urlsplit(turn["gateway"])
    if url.scheme != "http" or url.hostname != "127.0.0.1" or url.path not in ("", "/") or url.username or url.password or url.query or url.fragment:
        raise CallError("SELECTOR_GATEWAY_UNAVAILABLE")
    system = [m["content"] for m in wire["messages"] if m["role"] == "system"]
    messages = [m for m in wire["messages"] if m["role"] != "system"]
    body = {"model": wire["model"], "system": "\n".join(system), "messages": messages,
            "thinking": wire["thinking"], "temperature": wire["temperature"], "max_tokens": 4096}
    on_dispatch()
    start = time.monotonic()
    try:
        with httpx.Client(trust_env=False, follow_redirects=False, timeout=max(.1, turn["deadline"]/1000-time.time())) as http:
            response = http.post(turn["gateway"].rstrip("/") + "/v1/messages",
                                 headers={"x-api-key": turn["token"]}, json=body)
    except httpx.RequestError:
        raise CallError("SELECTOR_OUTCOME_UNCONFIRMED", unknown=True) from None
    if not response.is_success:
        raise CallError("HTTP_" + str(response.status_code), status=response.status_code)
    message = response.json()
    content = "".join(block["text"] for block in message["content"] if block["type"] == "text")
    finish = {"end_turn": "stop", "stop_sequence": "stop", "max_tokens": "length"}.get(message.get("stop_reason"))
    return {"content": content, "finish_reason": finish}, {"status": response.status_code,
            "elapsed_ms": round(1000*(time.monotonic()-start)), "bytes": len(response.content)}


def execute(packet, directory, selector=metered_selection):
    from direct_response import answer_step
    from engine import CallError, Engine, Worker
    from failure_explanations import explain
    from http_transport import HTTPTransport, MATRICES, SCALARS, SCALAR_SOURCES
    from platform_store_credentials import required_fields
    import model_answer
    from repository import Repository
    from semantics import Rejected, fingerprint
    from template_catalog import HASH, TEMPLATES, dependencies
    from template_runtime import submit

    authority = ChatAuthority(packet)
    turn, pins = packet["turn"], authority.pins
    guard = {"pins": pins}
    proofs = json.loads(Path(sys.path[0], "source_qualifications.json").read_bytes())
    caps = {cid: proofs for cid in authority.ids}
    repo = Repository(str(directory / "requests.sqlite"))
    engine = Engine(repo, lambda tenant: authority.scope_for(guard), execution_policy=authority,
                    template_mode=True, table_capabilities=lambda: caps, dataset_capabilities=lambda: caps,
                    selector_policy=lambda: {"layout": "catalog_prefix_v2", "isolation": "legacy_none"})
    # Only field names are retained for discovery. Dispatch resolves fresh credentials.
    fields = {store.id: authority.field_names(store) for store in authority.scope_for(guard).stores}
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
    engine.chat_selector_context = {"recent_user_questions": turn.get("recentQuestions", []),
                                    "store_names": authority.names}
    engine.store_template_available = supported
    engine.harness_store_names = lambda plan: authority.names
    engine.program_answers = False
    model_answer.step = answer_step  # Only in this request's private child interpreter.
    operations = []

    class ChatTransport(HTTPTransport):
        def execute(self, request, store, *, on_dispatch=None):
            if request.operation == "template_select":
                return selector(turn, request, on_dispatch)
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
                  fingerprint([turn["question"], authority.ids]), today, execution_context=guard)
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
    trace = {"catalogHash": HASH, "catalogSize": len(TEMPLATES),
             "templates": [{"id": item["template_id"], "connectionId": item["store_id"]} for item in selected],
             "operations": operations}
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
            result = execute(packet, root)
        except Rejected as error:
            from failure_explanations import explain
            result = {"ok": False, "code": error.code, "reason": explain(error.code)["text"]}
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
