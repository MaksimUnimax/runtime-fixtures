import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import resource_runner as rr


class AdmissionTests(unittest.TestCase):
    def resources(self, available=7000):
        return {"available_mib": available, "disk_free_mib": 25000,
                "inodes_free": 100000, "memory_full_avg10": 0}

    def test_independent_jobs_overlap_when_memory_fits(self):
        active = [{"role": "A", "memory_mib": 1536, "current_mib": 700},
                  {"role": "B", "memory_mib": 2048, "current_mib": 1000}]
        self.assertIsNone(rr.admission(self.resources(), active, 2048, "C"))

    def test_future_growth_is_reserved_not_only_current_usage(self):
        jobs = [{"role": "A", "memory_mib": 4096, "current_mib": 100}]
        self.assertEqual(rr.admission(self.resources(5000), jobs, 512, "B"),
                         "MEMORY_CAPACITY_REVIEW_REQUIRED")

    def test_active_memory_is_not_double_counted(self):
        jobs = [{"role": "A", "memory_mib": 2048, "current_mib": 2048}]
        self.assertIsNone(rr.admission(self.resources(2200), jobs, 1024, "B"))

    def test_no_same_role_destructive_db_collision(self):
        jobs = [{"role": "B", "memory_mib": 100, "current_mib": 50, "with_db": True}]
        self.assertEqual(rr.admission(self.resources(), jobs, 100, "B", True), "ROLE_TEST_DATABASE_BUSY")
        self.assertIsNone(rr.admission(self.resources(), jobs, 100, "A", True))
        self.assertIsNone(rr.admission(self.resources(), jobs, 100, "B", False))

    def test_pressure_and_disk_deferral_not_host_cleanup(self):
        resources = self.resources()
        resources["memory_full_avg10"] = 8
        self.assertEqual(rr.admission(resources, [], 512, "A"), "MEMORY_PRESSURE_RETRY_LATER")
        resources["disk_free_mib"] = 10
        self.assertEqual(rr.admission(resources, [], 512, "A"), "DISK_CAPACITY_REVIEW_REQUIRED")

    def test_pid_reuse_not_same_owner(self):
        self.assertIsNotNone(rr.process_identity(os.getpid()))
        self.assertIsNone(rr.process_identity(999999999))

    def test_invalid_unit_cannot_target_existing_service(self):
        for unit in ["ssh.service", "octoport-test-a-../ssh.service", ""]:
            with self.assertRaisesRegex(RuntimeError, "INVALID_OWNED_UNIT"):
                rr.unit_properties(unit)

    def test_budget_learns_peak_and_oom(self):
        with tempfile.TemporaryDirectory() as name:
            jobs = Path(name)
            p = jobs / "one";p.mkdir()
            rr.atomic_json(p / "receipt.json", {"state": "FINISHED", "profile": "focused",
                "memory_mib": 1024, "peak_bytes": 1000 * rr.MIB, "oom_kill": 1})
            self.assertGreaterEqual(rr.effective_budget(jobs, "focused", None), 1280)
            self.assertEqual(rr.effective_budget(jobs, "focused", 256), 256)

    def test_private_transport_has_private_permissions(self):
        with tempfile.TemporaryDirectory() as name:
            p = Path(name) / "payload.json"
            rr.atomic_json(p, {"env": {"SYNTHETIC_SECRET": "fixture-only"}})
            self.assertEqual(p.stat().st_mode & 0o777, 0o600)

    def test_live_unit_reservation_survives_owner_loss(self):
        with tempfile.TemporaryDirectory() as name:
            p = Path(name) / "job";p.mkdir()
            rr.atomic_json(p / "receipt.json", {"state": "RUNNING", "unit": "fixture",
                "owner_pid": 999999999, "owner_start": "0", "created_at": 0})
            with patch.object(rr, "unit_properties", return_value={"ActiveState": "active"}), \
                 patch.object(rr, "group_metrics", return_value={"current_mib": 15, "committed_mib": 10, "populated": True}):
                self.assertEqual(len(rr.active_jobs(Path(name))), 1)


@unittest.skipUnless(os.environ.get("OCTOPORT_TEST_SYSTEMD") == "1", "explicit bounded Linux systemd smoke")
class SystemdLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="octoport-resource-test-")
        self.root = Path(self.tmp.name)
        self.processes = []

    def tearDown(self):
        # Only exact units created in this test's private registry.
        for p in self.processes:
            if p.poll() is None:
                p.terminate()
                try:p.wait(timeout=12)
                except subprocess.TimeoutExpired:p.kill();p.wait()
        for path in self.root.glob("resource-jobs/*/receipt.json"):
            unit = json.loads(path.read_text())["unit"]
            rr.unit_properties(unit)
            rr.systemctl("stop", unit)
            rr.systemctl("reset-failed", unit)
        self.tmp.cleanup()

    def start(self, code, role="A", timeout=15, memory=64):
        script = ("import sys,os;sys.path.insert(0,sys.argv[1]);import resource_runner as r;"
                  "sys.exit(r.run(sys.argv[2],[sys.executable,'-c',sys.argv[3]],sys.argv[4],"
                  "dict(os.environ,SYNTHETIC_SECRET='DO_NOT_RECORD_SENTINEL'),sys.argv[4],"
                  "'focused',int(sys.argv[5]),int(sys.argv[6])))")
        p = subprocess.Popen([sys.executable, "-c", script, str(Path(rr.__file__).parent),
                              role, code, str(self.root), str(memory), str(timeout)],
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        self.processes.append(p)
        return p

    def receipts(self):
        return [json.loads(p.read_text()) for p in self.root.glob("resource-jobs/*/receipt.json")]

    def wait_file(self, path):
        until=time.monotonic()+12
        while not path.exists():
            if time.monotonic()>until:self.fail("fixture did not start")
            time.sleep(.1)

    def assert_finished(self, p, expected=0):
        out,_=p.communicate(timeout=25)
        self.assertEqual(p.returncode, expected, out)
        self.assertNotIn("DO_NOT_RECORD_SENTINEL", out)
        for r in self.receipts():
            if r.get("state") == "FINISHED":self.assertTrue(r["cleanup_verified"])
            self.assertNotIn("DO_NOT_RECORD_SENTINEL", json.dumps(r))

    def test_success_cleans_detached_descendant_and_keeps_unrelated_process(self):
        outside=subprocess.Popen([sys.executable,"-c","import time;time.sleep(40)"])
        pidfile=self.root/'detached.pid'
        code=("import subprocess,sys,time,pathlib;"
              "p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(40)'],start_new_session=True);"
              f"pathlib.Path({str(pidfile)!r}).write_text(str(p.pid));time.sleep(.4)")
        try:
            p=self.start(code);self.assert_finished(p)
            self.assertIsNone(rr.process_identity(int(pidfile.read_text())))
            self.assertIsNone(outside.poll())
            self.assertFalse(list(self.root.glob('resource-jobs/*/payload.json')))
        finally:outside.terminate();outside.wait()

    def test_failure_preserved(self):
        self.assert_finished(self.start("raise SystemExit(23)"),23)

    def test_three_roles_actually_run_at_once(self):
        ps=[self.start(f"import pathlib,time;pathlib.Path('{role}.ready').touch();time.sleep(3)",role) for role in 'ABC']
        for role in 'ABC':self.wait_file(self.root/(role+'.ready'))
        self.assertTrue(all(p.poll() is None for p in ps))
        for p in ps:self.assert_finished(p)

    def test_timeout_cleans_group(self):
        p=self.start("import time;time.sleep(40)",timeout=2)
        out,_=p.communicate(timeout=15)
        self.assertNotEqual(p.returncode,0,out)
        self.assertTrue(self.receipts()[0]['cleanup_verified'])

    def test_killed_controller_cleans_detached_descendant(self):
        pidfile=self.root/'orphan.pid'
        p=self.start("import subprocess,sys,time,pathlib;"
                     "c=subprocess.Popen([sys.executable,'-c','import time;time.sleep(40)'],start_new_session=True);"
                     f"pathlib.Path({str(pidfile)!r}).write_text(str(c.pid));time.sleep(40)")
        self.wait_file(pidfile);pid=int(pidfile.read_text());p.kill();p.communicate(timeout=10)
        deadline=time.monotonic()+10
        while rr.process_identity(pid) is not None and time.monotonic()<deadline:time.sleep(.1)
        self.assertIsNone(rr.process_identity(pid))
        self.assertEqual(rr.active_jobs(self.root/'resource-jobs'),[])

    def test_sigterm_controller_cleans_group(self):
        ready=self.root/'term.ready'
        p=self.start(f"import pathlib,time;pathlib.Path({str(ready)!r}).touch();time.sleep(40)")
        self.wait_file(ready);p.terminate()
        self.assert_finished(p,143)

    def test_memory_limit_contains_oom_in_owned_job(self):
        p=self.start("import time;x=bytearray(120*1024*1024);time.sleep(2)",memory=64)
        out,_=p.communicate(timeout=20)
        self.assertNotEqual(p.returncode,0,out)
        r=self.receipts()[0]
        self.assertTrue(r['cleanup_verified'])
        self.assertTrue(r['oom_kill'] or r['systemd_result']=='oom-kill',r)


if __name__ == "__main__":
    unittest.main()
