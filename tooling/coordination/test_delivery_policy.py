"""Regression for obsolete mandatory handoffs in reachable active instructions."""
import re
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = Path("docs/development/coordination")
SEEDS = ["AGENTS.md"] + [str(DIRECTORY / (name + ".md")) for name in (
    "README", "WORK_METHOD", "PROTOCOL", "PLAN", "STORE_POLICY",
    "CONTINUOUS_ROADMAP_POLICY", "UNATTENDED_CONTINUATION_POLICY",
    "OPERATOR_TESTING_POLICY", "PROMPT_A", "PROMPT_B", "PROMPT_C",
    "PROMPT_CONTROLLER", "PROMPT_CONTROLLER_L1", "ORGANIZATION_AUDIT_POLICY")]
OBSOLETE = ("C один интегрирует main", "B единственный автор БД",
            "B один пишет DB/schema/migrations",
            "A владелец клиентской матрицы; C — приёмка",
            "исправление готовится A, принимается C")


def instructions(root, seeds=SEEDS):
    root = Path(root).resolve()
    todo = [root / p for p in seeds]
    found = set()
    while todo:
        path = todo.pop().resolve()
        if path in found or not path.is_relative_to(root) or not path.is_file():
            continue
        if path.suffix != ".md" or "/receipts/" in str(path) or "/archives/" in str(path):
            continue
        found.add(path)
        for target in re.findall(r"\[[^\]]*\]\(([^)#]+)(?:#[^)]*)?\)", path.read_text()):
            if "://" not in target:
                todo.append(path.parent / target)
    return found


def conflicts(root, seeds=SEEDS):
    result = []
    for path in instructions(root, seeds):
        for number, line in enumerate(path.read_text().splitlines(), 1):
            for phrase in OBSOLETE:
                if phrase in line:
                    result.append((str(path), number, phrase))
    return result


class DeliveryPolicyTests(unittest.TestCase):
    def test_reachable_instructions_preserve_end_to_end_ownership(self):
        found = instructions(ROOT)
        self.assertIn(ROOT / DIRECTORY / "OWNER_TEST_AND_MONITORING_ROADMAP_2026-09-28.md", found)
        self.assertEqual(conflicts(ROOT), [])

    def test_old_route_is_found_even_when_entry_document_looks_correct(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "entry.md").write_text("Новый порядок. [План](plan.md)")
            (root / "plan.md").write_text("[Roadmap](old.md)")
            (root / "old.md").write_text("C один интегрирует main")
            self.assertEqual(len(conflicts(root, ["entry.md"])), 1)

    def test_historical_receipts_are_evidence_not_active_commands(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "receipts").mkdir()
            (root / "entry.md").write_text("[История](receipts/past.md)")
            (root / "receipts/past.md").write_text("B единственный автор БД")
            self.assertEqual(conflicts(root, ["entry.md"]), [])

    def test_link_cycles_and_outside_paths_do_not_expand_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "entry.md").write_text("[Self](entry.md) [Outside](../outside.md)")
            self.assertEqual(instructions(root, ["entry.md"]), {root / "entry.md"})


if __name__ == "__main__":
    unittest.main()
