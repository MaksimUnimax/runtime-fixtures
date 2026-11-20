"""Exercise the matrix in the separate interpreter used by the chat plugin."""
import os
from pathlib import Path
import subprocess
import sys
import unittest


class MarketplaceMatrixIsolation(unittest.TestCase):
    def test_selector_and_marketplace_contracts(self):
        product = Path(__file__).resolve().parents[1]
        # The archive-report plugin and the pinned matrix both have a top-level
        # report_archive module. The production boundary is a process boundary.
        result = subprocess.run(
            [sys.executable, "-m", "unittest", "discover", "-s", "tests/fixtures",
             "-p", "marketplace_matrix_cases.py", "-v"],
            cwd=product, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
            capture_output=True, text=True, timeout=90,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
