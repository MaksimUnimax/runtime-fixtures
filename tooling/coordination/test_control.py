import argparse
import importlib.util
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("control", Path(__file__).with_name("control.py"))
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)

class CoordinationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.args = argparse.Namespace(receipt="", task="", summary="", next="")
        self.ctx = patch.object(control, "CONTROL", self.root)
        self.ctx.start()
        self.git = patch.object(control, "git", return_value="a" * 40)
        self.git.start()

    def tearDown(self):
        self.git.stop()
        self.ctx.stop()
        self.tmp.cleanup()

    def test_automatic_start_cannot_clear_stop(self):
        control.update_state("A", "pause", self.args)
        with self.assertRaisesRegex(RuntimeError, "STOPPED"):
            control.update_state("A", "start", self.args)
        self.assertEqual(json.loads((self.root / "A.json").read_text())["status"], "STOPPED")

    def test_waiting_cannot_clear_stop(self):
        control.update_state("A", "pause", self.args)
        with self.assertRaisesRegex(RuntimeError, "STOPPED"):
            control.update_state("A", "waiting", self.args)
        self.assertEqual(json.loads((self.root / "A.json").read_text())["status"], "STOPPED")

    def test_test_container_requires_exact_loopback_port_and_database_identity(self):
        import copy
        cfg = {"port":15541,"database":"octoport_a_test","password":"disposable-test-value"}
        info = {"Config":{"Labels":{"octoport.coordination":"2p1"},"Env":["POSTGRES_USER=octoport_test","POSTGRES_DB=octoport_a_test","POSTGRES_PASSWORD=disposable-test-value"]},"HostConfig":{"PortBindings":{"5432/tcp":[{"HostIp":"127.0.0.1","HostPort":"15541"}]}},"NetworkSettings":{"Ports":{"5432/tcp":[{"HostIp":"127.0.0.1","HostPort":"15541"}]}}}
        control.validate_test_container(info,cfg)
        for change in ["configured_port", "active_port", "database"]:
            bad = copy.deepcopy(info)
            if change == "configured_port": bad["HostConfig"]["PortBindings"]["5432/tcp"][0]["HostPort"] = "5432"
            elif change == "active_port": bad["NetworkSettings"]["Ports"]["5432/tcp"][0]["HostIp"] = "0.0.0.0"
            else: bad["Config"]["Env"][1] = "POSTGRES_DB=production"
            with self.subTest(change=change), self.assertRaisesRegex(RuntimeError,"TEST_DB_"):
                control.validate_test_container(bad,cfg)

    def test_due_review_does_not_stop_independent_work(self):
        state = control.update_state("A", "start", self.args)
        state["review_clock"] = time.time() - control.PERIOD - 1
        control.write_json(self.root / "A.json", state)
        state = control.update_state("A", "status", self.args)
        self.assertTrue(state["review_pending"])
        self.assertEqual(state["status"], "RUNNING")
        control.require_running("A")

    def test_owner_request_survives_checkpoint(self):
        self.args.summary = "Access to a test mailbox"
        control.update_state("B", "request-owner", self.args)
        self.args.summary = "Independent safe task finished"
        state = control.update_state("B", "checkpoint", self.args)
        self.assertEqual(state["owner_requests"], ["Access to a test mailbox"])

    def test_review_requires_receipt(self):
        with self.assertRaisesRegex(RuntimeError, "receipt"):
            control.update_state("C", "reviewed", self.args)

    def test_cross_role_edit_is_rejected(self):
        rules = {"roles":{"A":{"allow":["apps/extension/**"],"deny":[]}}}
        with patch.object(control, "policy", return_value=rules), patch.object(control, "git", side_effect=["apps/api/src/main.ts", ""]):
            with self.assertRaisesRegex(RuntimeError, "OWNERSHIP_VIOLATION"):
                control.scope_guard("A")

    def test_extension_owner_can_change_its_actual_browser_regressions_and_builders(self):
        names = "tests/regression/extension-core/client-i1/browser_c1_acceptance.py\ntooling/build/extension_composed.py\ntooling/checks/extension_i1.py"
        with patch.object(control, "git", side_effect=[names, ""]):
            self.assertEqual(len(control.scope_guard("A")), 3)
        with patch.object(control, "git", side_effect=["tests/regression/imported/frozen-source.js", ""]):
            with self.assertRaisesRegex(RuntimeError, "OWNERSHIP_VIOLATION"):
                control.scope_guard("A")

    def test_busy_heavy_slot_does_not_start_a_command(self):
        import fcntl
        with (self.root / "heavy.lock").open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch.object(control.subprocess, "Popen") as child:
                self.assertEqual(control.heavy("C", ["must-not-run"], False), 75)
                child.assert_not_called()

if __name__ == "__main__":
    unittest.main()
