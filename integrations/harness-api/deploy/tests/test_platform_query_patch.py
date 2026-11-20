"""Exercise the exact patched QueryService functions without Django or a DB.

The source fixture is the unmodified audited release, hash-checked by the patch.
Only imports are replaced with explicit in-memory dependencies. The real actor,
owned, list, submit, read, clarify and cancel implementations execute below.
"""
from __future__ import annotations

import ast
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid


DEPLOY = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("platform_query_patch", DEPLOY / "platform_query_patch.py")
patcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patcher)
ORIGINAL = (Path(__file__).parent / "fixtures/platform_queries_service_original.py").read_bytes()
PATCHED = patcher.patch_source(ORIGINAL)
NOW = datetime(2026, 11, 18, 12, tzinfo=timezone.utc)
ACTOR, TENANT, STORE, QUERY, REQUEST = (str(uuid.UUID(int=i)) for i in range(1, 6))


class RuntimeFailure(Exception):
    def __init__(self, code="VALIDATION_FAILED", *, outcome="NOT_SENT"):
        self.code, self.outcome = code, outcome
        super().__init__(code)


def need(condition, code="VALIDATION_FAILED"):
    if not condition:
        raise RuntimeFailure(code)


def identifier(value):
    need(str(uuid.UUID(value)) == value)
    return value


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


class Row:
    def __init__(self, pk=QUERY, **values):
        self.__dict__.update({
            "pk": pk, "customer_id": ACTOR, "tenant_id": TENANT,
            "store_ids": [STORE], "created_at": NOW, "expires_at": NOW + timedelta(days=1),
            "checked_at": None, "state": "UNKNOWN", "runtime_job_ref": None,
            "continuation": {}, "lease_until": None, "attempt": None,
            "trace_id": str(uuid.uuid4()), "channel": "WEB", "voice_session_hash": "",
            "input_hash": hashlib.sha256(encode({"stores": [STORE], "utterance": "Отчёт"})).hexdigest(),
            "saves": [],
        })
        self.__dict__.update(values)

    def save(self, *, update_fields):
        self.saves.append(tuple(update_fields))


class Rows:
    def __init__(self, values=None):
        self.values = list(values or [])

    @staticmethod
    def matches(row, fields):
        for name, value in fields.items():
            if name.endswith("__gt"):
                if not getattr(row, name[:-4]) > value:
                    return False
            elif name == "continuation__has_key":
                if value not in row.continuation:
                    return False
            elif getattr(row, name) != value:
                return False
        return True

    def filter(self, **fields):
        return Rows(row for row in self.values if self.matches(row, fields))

    def exclude(self, **fields):
        return Rows(row for row in self.values if not self.matches(row, fields))

    def first(self):
        return self.values[0] if self.values else None

    def select_for_update(self):
        return self

    def order_by(self, field):
        return Rows(sorted(self.values, key=lambda row: getattr(row, field.lstrip("-")), reverse=field.startswith("-")))

    def get_or_create(self, *, pk, defaults):
        value = self.filter(pk=pk).first()
        if value is not None:
            return value, False
        value = Row(pk=pk, **defaults)
        self.values.append(value)
        return value, True

    def get(self, **fields):
        value = self.filter(**fields).first()
        if value is None:
            raise AssertionError("missing fixture row")
        return value

    def update(self, **fields):
        for row in self.values:
            row.__dict__.update(fields)

    def __getitem__(self, item):
        return self.values[item]

    def __iter__(self):
        return iter(self.values)


class NativeApi:
    def __init__(self):
        self.calls = []
        self.authorizer = SimpleNamespace(prepare=self.prepare, current=lambda context, operation: True)

    def prepare(self, operation):
        self.calls.append(("prepare", operation))
        return {}

    def submit(self, utterance, **kwargs):
        self.calls.append(("submit", utterance, kwargs))
        return {"job_ref": str(uuid.UUID(int=8))}

    submit_collection = submit

    def status(self, job_ref):
        self.calls.append(("status", job_ref))
        return {"state": "RUNNING"}

    def read_result(self, job_ref):
        self.calls.append(("read_result", job_ref))
        return {"state": "READY", "result_expires_at": (NOW + timedelta(hours=1)).timestamp()}

    def cancel(self, job_ref, **kwargs):
        self.calls.append(("cancel", job_ref, kwargs))
        return {"state": "CANCELLED"}

    def clarify(self, answer, *, job_ref, **kwargs):
        self.calls.append(("clarify", answer, kwargs))
        return {"job_ref": job_ref}


class PlatformTests(unittest.TestCase):
    def setUp(self):
        self.rows = Rows()
        self.api = NativeApi()
        self.member = True
        self.principal = SimpleNamespace(current=lambda: (ACTOR, TENANT, None, {"kind": "WEB"}))
        self.ns = {
            "settings": SimpleNamespace(QUERIES_ENABLED=True),
            "Membership": SimpleNamespace(objects=SimpleNamespace(filter=lambda **kw: SimpleNamespace(exists=lambda: self.member))),
            "Query": SimpleNamespace(objects=self.rows),
            "transaction": SimpleNamespace(atomic=nullcontext),
            "timezone": SimpleNamespace(now=lambda: NOW),
            "RuntimeFailure": RuntimeFailure, "need": need, "identifier": identifier,
            "text": lambda value, limit: need(isinstance(value, str) and len(value) <= limit),
            "timestamp": float, "encode": encode, "hashlib": hashlib, "re": re,
            "uuid": uuid, "timedelta": timedelta,
        }
        tree = ast.parse(PATCHED.decode())
        tree.body = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef))]
        exec(compile(tree, str(DEPLOY / "patched_query_service.py"), "exec"), self.ns)
        self.ns["client"] = lambda principal, stores: self.api
        self.remember = patch.dict(sys.modules, {
            "alisa_platform.owner_data.parameter_report_rpc": SimpleNamespace(remember=lambda *args: {"web_principal": {"kind": "WEB"}}),
        })
        self.remember.start()
        self.addCleanup(self.remember.stop)

    def assertError(self, code, operation):
        with self.assertRaises(RuntimeFailure) as caught:
            operation()
        self.assertEqual(caught.exception.code, code)

    def harness_row(self, **kwargs):
        row = Row(continuation={"harness_runtime_v1": {"session_id": str(uuid.uuid4()), "runtime": "octoport-harness", "request_id": REQUEST}}, **kwargs)
        self.rows.values.append(row)
        return row

    def test_list_filters_before_limit_and_keeps_owner_expiry_order(self):
        native = [Row(pk=str(uuid.UUID(int=100 + i)), created_at=NOW + timedelta(seconds=i)) for i in range(60)]
        self.rows.values.extend(native)
        for i in range(60):
            self.harness_row(pk=str(uuid.UUID(int=200 + i)), created_at=NOW + timedelta(seconds=100 + i))
        self.rows.values.extend([Row(pk=str(uuid.UUID(int=400)), customer_id="other"), Row(pk=str(uuid.UUID(int=401)), expires_at=NOW)])
        result = self.ns["list_queries"](self.principal)
        self.assertEqual([row["id"] for row in result["items"]], [row.pk for row in reversed(native[-50:])])

    def test_list_still_rechecks_principal_before_return(self):
        scopes = iter([(ACTOR, TENANT, None, {}), ("changed", TENANT, None, {})])
        self.principal.current = lambda: next(scopes)
        self.assertError("AUTH_REQUIRED", lambda: self.ns["list_queries"](self.principal))

    def test_harness_read_result_clarify_cancel_never_dispatch_or_modify(self):
        row = self.harness_row(runtime_job_ref=str(uuid.UUID(int=9)))
        actions = [
            lambda: self.ns["read"](self.principal, QUERY),
            lambda: self.ns["read"](self.principal, QUERY, result=True, record_useful=False),
            lambda: self.ns["clarify"](self.principal, QUERY, REQUEST, "a" * 64, "Да", recover=True),
            lambda: self.ns["cancel"](self.principal, QUERY, REQUEST),
        ]
        for operation in actions:
            with self.subTest(operation=operation):
                self.assertError("NOT_FOUND", operation)
                self.assertEqual(self.api.calls, [])
                self.assertEqual(row.saves, [])

    def test_harness_submit_recovery_never_dispatches_or_changes_receipt(self):
        row = self.harness_row(lease_until=NOW - timedelta(minutes=1))
        for recover in (False, True):
            with self.subTest(recover=recover):
                self.api.calls.clear()
                self.assertError("NOT_FOUND", lambda: self.ns["submit"](self.principal, QUERY, [STORE], "Отчёт", recover=recover))
                self.assertEqual(self.api.calls, [("prepare", "submit")])
                self.assertEqual(row.saves, [])
                self.assertIsNone(row.runtime_job_ref)

    def test_guard_keeps_existing_authorization_and_expiry_precedence(self):
        row = self.harness_row()
        self.member = False
        self.assertError("PERMISSION_DENIED", lambda: self.ns["owned"](self.principal, QUERY))
        self.member = True
        row.customer_id = "different owner"
        self.assertError("NOT_FOUND", lambda: self.ns["owned"](self.principal, QUERY))
        row.customer_id = ACTOR
        row.expires_at = NOW
        self.assertError("RESULT_EXPIRED", lambda: self.ns["owned"](self.principal, QUERY))
        self.assertEqual(self.api.calls, [])

    def test_key_presence_alone_blocks_partial_harness_receipts(self):
        for marker_value in (None, False, {}, "invalid"):
            with self.subTest(marker_value=marker_value):
                self.rows.values = [Row(continuation={"harness_runtime_v1": marker_value})]
                self.assertError("NOT_FOUND", lambda: self.ns["owned"](self.principal, QUERY))
                self.assertEqual(self.ns["list_queries"](self.principal)["items"], [])

    def test_native_submit_and_recovery_still_dispatch(self):
        value, status = self.ns["submit"](self.principal, QUERY, [STORE], "Отчёт")
        self.assertEqual(status, 201)
        self.assertTrue(value["query"]["submission_confirmed"])
        row = self.rows.get(pk=QUERY)
        row.runtime_job_ref = None
        row.lease_until = NOW - timedelta(seconds=1)
        value, status = self.ns["submit"](self.principal, QUERY, [STORE], "Отчёт", recover=True)
        self.assertEqual(status, 201)
        self.assertEqual(sum(call[0] == "submit" for call in self.api.calls), 2)

    def test_native_read_clarify_cancel_remain_usable(self):
        row = Row(runtime_job_ref=str(uuid.UUID(int=9)), state="NEEDS_INPUT")
        self.rows.values.append(row)
        self.assertEqual(self.ns["read"](self.principal, QUERY)["status"]["state"], "RUNNING")
        self.assertEqual(self.ns["clarify"](self.principal, QUERY, REQUEST, "a" * 64, "Да")[1], 201)
        self.assertEqual(self.ns["cancel"](self.principal, QUERY, REQUEST)["status"]["state"], "CANCELLED")
        self.assertEqual([call[0] for call in self.api.calls if call[0] != "prepare"], ["status", "clarify", "cancel"])


class PatchSafetyTests(unittest.TestCase):
    def test_unreviewed_or_already_patched_source_is_rejected(self):
        for value in (ORIGINAL + b"\n", PATCHED):
            with self.subTest(value_sha=hashlib.sha256(value).hexdigest()):
                with self.assertRaises(patcher.SourceMismatch):
                    patcher.patch_source(value)

    def test_only_native_ownership_and_list_functions_change(self):
        old = ast.parse(ORIGINAL.decode())
        new = ast.parse(PATCHED.decode())
        old_functions = {node.name: ast.dump(node) for node in old.body if isinstance(node, (ast.FunctionDef, ast.ClassDef))}
        new_functions = {node.name: ast.dump(node) for node in new.body if isinstance(node, (ast.FunctionDef, ast.ClassDef))}
        self.assertEqual(set(old_functions), set(new_functions))
        changed = {name for name in old_functions if old_functions[name] != new_functions[name]}
        self.assertEqual(changed, {"owned", "list_queries"})

    def test_new_output_only_and_source_untouched(self):
        with tempfile.TemporaryDirectory() as folder:
            source, output = Path(folder) / "source.py", Path(folder) / "overlay.py"
            source.write_bytes(ORIGINAL)
            result = patcher.write_overlay(source, output)
            self.assertEqual(source.read_bytes(), ORIGINAL)
            self.assertEqual(output.read_bytes(), PATCHED)
            self.assertEqual(result["output_sha256"], hashlib.sha256(PATCHED).hexdigest())
            with self.assertRaises(ValueError):
                patcher.write_overlay(source, source)
            with self.assertRaises(FileExistsError):
                patcher.write_overlay(source, output)


if __name__ == "__main__":
    unittest.main()
