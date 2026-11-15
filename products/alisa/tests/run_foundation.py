"""Run all root foundation units; specialized suites must have an assigned runner."""
from pathlib import Path
import sys,unittest,json
from suite_routing import inventory
ROOT=Path(__file__).resolve().parent
modules,groups=inventory(ROOT)
loader=unittest.TestLoader();suite=unittest.TestSuite(loader.loadTestsFromName(name)for name in modules)
result=unittest.TextTestRunner(verbosity=2).run(suite)
print(json.dumps({'foundation_tests':result.testsRun,'specialized_module_routing':groups,'foundation_skips':len(result.skipped)}))
raise SystemExit(0 if result.wasSuccessful()and not result.skipped else 1)
