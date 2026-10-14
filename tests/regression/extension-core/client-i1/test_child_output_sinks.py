"""Native regression for the I1 launcher's unused API/portal child output.

Extract only stdout/stderr/text from the two actual Popen expressions. Never
import or execute the integration scenario, API, portal, browser or database.
"""
from __future__ import annotations

import ast
import os
from pathlib import Path
import subprocess
import sys
import unittest

SOURCE = Path(__file__).with_name("installed_local_integration.py")
VOLUME = 2 * 1024 * 1024 + 17


def child_output_options(owner: str) -> dict:
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"), filename=str(SOURCE))
    matches = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        if not any(isinstance(t, ast.Name) and t.id == owner for t in node.targets):
            continue
        call = node.value
        if (isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute)
                and isinstance(call.func.value, ast.Name)
                and call.func.value.id == "subprocess" and call.func.attr == "Popen"):
            matches.append(call)
    if len(matches) != 1:
        raise AssertionError(f"Expected one actual {owner} Popen expression")
    keywords = {kw.arg: kw.value for kw in matches[0].keywords}
    options = {}
    allowed = {"PIPE": subprocess.PIPE, "DEVNULL": subprocess.DEVNULL,
               "STDOUT": subprocess.STDOUT}
    for name in ("stdout", "stderr"):
        value = keywords.get(name)
        if not (isinstance(value, ast.Attribute) and isinstance(value.value, ast.Name)
                and value.value.id == "subprocess" and value.attr in allowed):
            raise AssertionError(f"Unexpected {owner} {name} declaration")
        options[name] = allowed[value.attr]
    value = keywords.get("text")
    if not isinstance(value, ast.Constant) or value.value is not True:
        raise AssertionError(f"Expected explicit text=True for {owner}")
    options["text"] = True
    return options


# os.write avoids Python buffering and handles partial writes explicitly.
CHILD = """
import os, sys
fd, remaining, exit_code = map(int, sys.argv[1:])
block = b'SYNTHETIC_UNUSED_I1_OUTPUT_' * 251
while remaining:
    chunk = block[:min(len(block), remaining)]
    written = os.write(fd, chunk)
    if written <= 0:
        raise RuntimeError('No progress writing synthetic output')
    remaining -= written
raise SystemExit(exit_code)
"""


class ChildOutputSinkTest(unittest.TestCase):
    def run_child(self, owner: str, fd: int, exit_code: int = 0) -> None:
        options = child_output_options(owner)
        process = subprocess.Popen(
            [sys.executable, "-I", "-c", CHILD, str(fd), str(VOLUME), str(exit_code)],
            stdin=subprocess.DEVNULL,
            env={"PATH": os.defpath},
            **options,
        )
        try:
            try:
                actual = process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.fail(f"{owner} blocks on unused fd {fd} output")
            self.assertEqual(actual, exit_code, "Child failure must not become success")
            self.assertIsNone(process.stdout, "Output must not be buffered in the parent")
            self.assertIsNone(process.stderr, "No unconsumed stderr pipe may remain")
        finally:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=5)
            if process.stdout is not None:
                process.stdout.close()
            if process.stderr is not None:
                process.stderr.close()

    def test_api_stdout_above_pipe_capacity(self):
        self.run_child("api", 1)

    def test_api_stderr_above_pipe_capacity(self):
        self.run_child("api", 2)

    def test_portal_stdout_above_pipe_capacity(self):
        self.run_child("portal", 1)

    def test_portal_stderr_above_pipe_capacity(self):
        self.run_child("portal", 2)

    def test_api_nonzero_exit_preserved(self):
        self.run_child("api", 2, 7)

    def test_portal_nonzero_exit_preserved(self):
        self.run_child("portal", 2, 7)

    def test_both_sinks_discard_without_raw_log_capture(self):
        for owner in ("api", "portal"):
            with self.subTest(owner=owner):
                self.assertEqual(child_output_options(owner), {
                    "stdout": subprocess.DEVNULL,
                    "stderr": subprocess.STDOUT,
                    "text": True,
                })


if __name__ == "__main__":
    unittest.main()
