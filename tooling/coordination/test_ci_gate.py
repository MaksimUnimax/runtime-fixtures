import unittest
from ci_gate import REQUIRED, evaluate

class CiGateTests(unittest.TestCase):
    def rows(self):
        return [{"name":name,"id":i+1,"head_sha":"a"*40,"head_branch":"work/c-integration","event":"push","status":"completed","conclusion":"success"} for i,name in enumerate(REQUIRED)]
    def test_complete_exact_candidate(self):
        self.assertEqual(evaluate(self.rows(),"a"*40,"work/c-integration")["status"],"PASS")
    def test_missing_workflow_and_in_progress_block(self):
        rows=self.rows()
        self.assertEqual(evaluate(rows[:-1],"a"*40,"work/c-integration")["status"],"BLOCKED")
        rows[-1]["status"]="in_progress"
        self.assertEqual(evaluate(rows,"a"*40,"work/c-integration")["status"],"BLOCKED")
    def test_new_failure_overrides_old_success(self):
        rows=self.rows(); rows.append({**rows[0],"id":999,"conclusion":"failure"})
        self.assertEqual(evaluate(rows,"a"*40,"work/c-integration")["status"],"BLOCKED")
    def test_other_sha_branch_and_pull_request_cannot_supply_missing_gate(self):
        for field,value in [("head_sha","b"*40),("head_branch","main"),("event","pull_request")]:
            rows=self.rows();rows[0][field]=value
            with self.subTest(field=field):self.assertEqual(evaluate(rows,"a"*40,"work/c-integration")["status"],"BLOCKED")
    def test_rerun_success_is_current(self):
        rows=self.rows();rows[0]["conclusion"]="failure";rows.append({**rows[0],"run_attempt":2,"conclusion":"success"})
        self.assertEqual(evaluate(rows,"a"*40,"work/c-integration")["status"],"PASS")
