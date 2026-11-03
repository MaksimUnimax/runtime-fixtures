"""Offline fault controls for the browser proof, not browser acceptance."""
import ast
import copy
import json
import os
import subprocess
import tempfile
import unittest
from contextlib import contextmanager, nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import browser_transfer_vault_restart as proof


class BrowserVaultProofTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="vault-proof-controls-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "manifest.json").write_text(
            '{"background":{"service_worker":"worker.js"}}')
        (self.root / "worker.js").write_text("/* inert fixture */")
        self.args = SimpleNamespace(runtime=self.root, label="offline-controls", executable=None)
        self.active = {
            "requestId": proof.REQUEST, "accountId": proof.ACCOUNT,
            "recipientDeviceId": proof.RECIPIENT, "sessionId": proof.SESSION,
            "sourceDeviceId": proof.SOURCE, "phase": "ACTIVE",
            "selectedStoreIds": ["fixture"], "expiresAt": "2099-01-01T00:00:00Z",
            "packetId": None, "result": None, "publicKeySpki": "fixture-public",
        }
        self.pending = {**self.active, "phase": "IMPORTED_PENDING_ACK",
                        "packetId": proof.PACKET,
                        "result": {"importState": "IMPORTED", "results": [{"storeId": "fixture", "kind": "IMPORTED"}]}}

    def exercise(self, *, first_change=None, pending_change=None, close_failure=None, run=None):
        opened, closed, profiles = [], [], []

        @contextmanager
        def fixture_worker(pw, profile, options, runtime, entry, expected_id=None):
            number = len(opened)
            opened.append(number)
            profiles.append(profile)
            self.assertEqual(expected_id, None if number == 0 else "a" * 32)
            try:
                yield number, "a" * 32
            finally:
                closed.append(number)
                if close_failure == number:
                    raise RuntimeError("owned context close failed")

        def evaluate(number, source, values):
            self.assertIn(number, opened, "evaluate requires its opened context")
            self.assertNotIn(number, closed, "evaluate cannot use a closed context")
            if number == 0:
                return {"envelope": "inert", "expiresAt": self.active["expiresAt"],
                        "publicKeySpki": self.active["publicKeySpki"],
                        "metadata": copy.deepcopy(self.pending)}
            if number == 1:
                result = copy.deepcopy(self.pending)
                if first_change:
                    first_change(result)
                return result
            result = copy.deepcopy(self.pending)
            if pending_change:
                pending_change(result)
            return result

        with patch.object(proof, "sync_playwright", return_value=nullcontext(object())), \
             patch.object(proof, "opened_worker", fixture_worker), \
             patch.object(proof, "evaluate", evaluate):
            try:
                result = (run or proof.run)(self.args)
            finally:
                self.assertEqual(closed, opened, "failed proof closes every opened owned context")
                self.assertEqual(len(set(profiles)), 1, "restarts use one owned persistent profile")
        self.assertEqual(len(opened), 3)
        self.assertEqual(result["status"], "PASS")
        self.assertFalse(result["apiRelayAndCatalogAcceptance"])
        self.assertFalse(result["installedOwnerAcceptance"])
        self.assertEqual(result["pendingBrowserRestarts"], 2)
        self.assertFalse(result["pendingRecordRewrittenBetweenRestarts"])

    def test_healthy_control_keeps_claims_scoped(self):
        self.exercise()

    def test_close_before_pending_write_mutation_is_rejected(self):
        tree = ast.parse(Path(proof.__file__).read_text())
        run = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "run")
        outer = next(node for node in ast.walk(run) if isinstance(node, ast.With)
                     and any(isinstance(item.context_expr, ast.Call)
                             and isinstance(item.context_expr.func, ast.Name)
                             and item.context_expr.func.id == "opened_worker" for item in node.items))
        write = next(node for node in outer.body if isinstance(node, ast.Assign)
                     and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name)
                     and node.value.func.id == "evaluate")
        parent = next(node for node in ast.walk(run) if hasattr(node, "body")
                      and isinstance(node.body, list) and outer in node.body)
        outer.body.remove(write)
        if not outer.body:
            outer.body.append(ast.Pass())
        parent.body.insert(parent.body.index(outer) + 1, write)
        module = ast.fix_missing_locations(ast.Module(body=[run], type_ignores=[]))
        namespace = dict(vars(proof))
        exec(compile(module, proof.__file__, "exec"), namespace)
        # Use the live patched globals, not a detached copy of the real browser
        # entrypoints. Only run's close/write order is mutated.
        mutated = type(proof.run)(namespace["run"].__code__, vars(proof))
        with self.assertRaisesRegex(AssertionError, "closed context"):
            self.exercise(run=mutated)

    def test_changed_pending_identity_after_first_restart_is_not_accepted(self):
        for field in ("accountId", "recipientDeviceId", "sessionId", "sourceDeviceId"):
            with self.subTest(field=field), self.assertRaises(AssertionError):
                self.exercise(first_change=lambda row: row.update({field: "changed"}))

    def test_changed_pending_fields_are_not_accepted(self):
        for field, value in (("phase", "ACTIVE"), ("packetId", "P2"),
                             ("expiresAt", "2099-02-01T00:00:00Z"),
                             ("selectedStoreIds", ["foreign-store"]),
                             ("result", {"importState": "IMPORTED", "results": []})):
            for restart in (1, 2):
                with self.subTest(field=field, restart=restart), self.assertRaises(AssertionError):
                    change = lambda row: row.update({field: value})
                    self.exercise(**{"first_change" if restart == 1 else "pending_change": change})

    def test_each_failed_browser_close_prevents_pass(self):
        for number in range(3):
            with self.subTest(number=number), self.assertRaisesRegex(RuntimeError, "close failed"):
                self.exercise(close_failure=number)

    def test_real_opened_worker_closes_on_selection_failure(self):
        closed = []
        context = SimpleNamespace(close=lambda: closed.append(True))
        pw = SimpleNamespace(chromium=SimpleNamespace(launch_persistent_context=lambda *a, **k: context))
        with patch.object(proof, "worker", side_effect=RuntimeError("identity mismatch")):
            with self.assertRaisesRegex(RuntimeError, "identity mismatch"):
                with proof.opened_worker(pw, "owned", {}, self.root, "worker.js"):
                    self.fail("selection failure reached consumer")
        self.assertEqual(closed, [True])

    def test_symlink_preflight_never_launches_browser(self):
        outside = self.root / "outside.js"
        outside.write_text("/* inert */")
        worker = self.root / "worker.js"
        worker.unlink()
        worker.symlink_to(outside)
        with patch.object(proof, "sync_playwright") as launch:
            with self.assertRaisesRegex(RuntimeError, "symlink"):
                proof.run(self.args)
            launch.assert_not_called()

    def test_embedded_setup_precedes_two_read_only_pending_restores(self):
        tree = ast.parse(Path(proof.__file__).read_text())
        calls = sorted((node for node in ast.walk(tree) if isinstance(node, ast.Call)
                        and isinstance(node.func, ast.Name) and node.func.id == "evaluate"),
                       key=lambda node: node.lineno)
        self.assertEqual(len(calls), 3)
        fragments = [eval(compile(ast.Expression(call.args[1]), proof.__file__, "eval"),
                          {"KEY_AND_PAYLOAD": proof.KEY_AND_PAYLOAD}) for call in calls]
        # Execute the actual embedded fixture fragments. These are offline
        # protocol controls; the CryptoKey/IndexedDB implementations are fake.
        program = r"""
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const fragments=JSON.parse(fs.readFileSync(0,'utf8'));
let row=null, writes=0, removes=0;
const copy=v=>structuredClone(v);
const realm=vm.createContext({
  SellerAgentsCredentialTransferVault:{VERSION:1,
    put:async value=>{writes++;row=copy(value);return copy(row);},
    get:async()=>copy(row),
    update:async(_id,fn)=>{writes++;row=copy(fn(copy(row)));return copy(row);},
    remove:async()=>{removes++;row=null;},
  },
  SellerAgentsCredentialTransferCrypto:{
    generateRecipientKeyPair:async()=>({publicKeySpki:'fixture-public',privateKey:{type:'private',extractable:false}}),
    encrypt:async value=>copy(value.payload),
    decrypt:async value=>copy(value.envelope),
  },
  crypto:{subtle:{exportKey:async()=>{throw Error('nonextractable fixture');}}},
});
const values={requestId:'request',accountId:'account',recipientDeviceId:'recipient',sessionId:'session',sourceDeviceId:'source',packetId:'P1'};
const initial=await vm.runInContext('('+fragments[0]+')',realm)(values);
assert.equal(row.phase,'IMPORTED_PENDING_ACK','pending must be durable before the FIRST browser close');
assert.equal(row.packetId,'P1');assert.equal(row.result.importState,'IMPORTED');
const before=copy(row), written=writes;
Object.assign(values,initial);
const first=await vm.runInContext('('+fragments[1]+')',realm)(values);
assert.deepEqual(copy(first),copy(initial.metadata));
assert.deepEqual(row,before,'first pending restart must not rewrite any vault field');
assert.equal(writes,written);assert.equal(removes,0,'no ACK/removal between restarts');
const second=await vm.runInContext('('+fragments[2]+')',realm)(values);
assert.deepEqual(copy(second),copy(initial.metadata));
assert.equal(writes,written);assert.equal(removes,1);assert.equal(row,null);
console.log('PASS actual embedded setup + two read-only pending restore fragments');
"""
        result = subprocess.run([os.environ.get("SA_NODE_BIN", "node"), "--input-type=module", "-e", program],
                                input=json.dumps(fragments), capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
