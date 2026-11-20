import os
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from platform_core.storage import Scope, Store


class StorageTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "platform.sqlite3"
        self.store = Store(self.path)
        self.addCleanup(self.store.close)
        self.a = Scope("owner-a", "space-a", "chat-a")
        self.b = Scope("owner-b", "space-b", "chat-b")
        for scope in (self.a, self.b):
            self.store.create_workspace(scope.actor_id, scope.workspace_id)
            self.store.create_chat(scope)

    def test_entitlement_and_chat_choice_are_both_required(self):
        with self.assertRaises(PermissionError):
            self.store.set_enabled(self.a, "feature", True)
        self.store.set_entitlement(self.a.workspace_id, "feature", True)
        self.assertFalse(self.store.permits(self.a, "feature"))
        self.store.set_enabled(self.a, "feature", True)
        self.assertTrue(self.store.permits(self.a, "feature"))
        another_chat = Scope(self.a.actor_id, self.a.workspace_id, "another-chat")
        self.store.create_chat(another_chat)
        self.assertEqual(self.store.enabled_plugins(another_chat), ())
        self.assertFalse(self.store.permits(self.b, "feature"))

    def test_foreign_chat_workspace_and_actor_are_denied(self):
        self.store.set_entitlement(self.a.workspace_id, "feature", True)
        self.store.set_enabled(self.a, "feature", True)
        for mixed in (
            Scope(self.b.actor_id, self.a.workspace_id, self.a.chat_id),
            Scope(self.b.actor_id, self.b.workspace_id, self.a.chat_id),
            Scope(self.a.actor_id, self.b.workspace_id, self.a.chat_id),
        ):
            with self.subTest(scope=mixed):
                self.assertFalse(self.store.permits(mixed, "feature"))
                self.assertEqual(self.store.enabled_plugins(mixed), ())
                with self.assertRaises(PermissionError):
                    self.store.set_enabled(mixed, "feature", False)
                with self.assertRaises(PermissionError):
                    self.store.create_chat(mixed)
        with self.assertRaises(PermissionError):
            self.store.create_workspace(self.b.actor_id, self.a.workspace_id)
        self.assertTrue(self.store.permits(self.a, "feature"))

    def test_provision_rolls_back_new_workspace_on_chat_conflict(self):
        conflicting = Scope("owner-new", "space-new", self.a.chat_id)
        with self.assertRaises(PermissionError):
            self.store.provision(conflicting)
        with self.assertRaises(LookupError):
            self.store.set_entitlement(conflicting.workspace_id, "feature", True)
        # A different owner can now successfully provision that formerly unused ID.
        fresh = Scope("another-owner", conflicting.workspace_id, "fresh-chat")
        self.store.provision(fresh)
        self.store.provision(fresh)
        self.store.set_entitlement(fresh.workspace_id, "feature", True)
        self.store.set_enabled(fresh, "feature", True)
        self.assertTrue(self.store.permits(fresh, "feature"))

    def test_revocation_forgets_opt_ins_only_in_the_affected_workspace(self):
        other = Scope(self.a.actor_id, self.a.workspace_id, "another-chat")
        self.store.create_chat(other)
        for scope in (self.a, other, self.b):
            for plugin in ("alpha", "beta"):
                self.store.set_entitlement(scope.workspace_id, plugin, True)
                self.store.set_enabled(scope, plugin, True)
        with Store(self.path) as separate_writer:
            separate_writer.set_entitlement(self.a.workspace_id, "alpha", False)
            separate_writer.set_entitlement(self.a.workspace_id, "alpha", True)
        self.assertEqual(self.store.enabled_plugins(self.a), ("beta",))
        self.assertEqual(self.store.enabled_plugins(other), ("beta",))
        self.assertEqual(self.store.enabled_plugins(self.b), ("alpha", "beta"))
        self.store.set_enabled(self.a, "alpha", True)
        self.assertTrue(self.store.permits(self.a, "alpha"))

    def test_concurrent_retries_and_restart(self):
        def retry(_):
            with Store(self.path) as writer:
                writer.create_workspace(self.a.actor_id, self.a.workspace_id)
                writer.create_chat(self.a)
                writer.set_entitlement(self.a.workspace_id, "feature", True)
                writer.set_enabled(self.a, "feature", True)

        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(retry, range(12)))
        self.store.close()
        with Store(self.path) as reopened:
            self.assertEqual(reopened.enabled_plugins(self.a), ("feature",))
            reopened.set_enabled(self.a, "feature", False)
            reopened.set_enabled(self.a, "feature", False)
            self.assertFalse(reopened.permits(self.a, "feature"))

    def test_malformed_flags_cannot_become_truthy_grants(self):
        with self.assertRaises(ValueError):
            self.store.set_entitlement(self.a.workspace_id, "feature", "false")
        self.store.set_entitlement(self.a.workspace_id, "feature", True)
        with self.assertRaises(ValueError):
            self.store.set_enabled(self.a, "feature", 1)
        self.assertFalse(self.store.permits(self.a, "feature"))

    def test_strict_open_never_initializes_missing_or_empty_file(self):
        wrong = self.path.with_name("wrong path?#.sqlite3")
        with self.assertRaises(sqlite3.OperationalError):
            Store(wrong, create=False)
        self.assertFalse(wrong.exists())
        wrong.touch()
        with self.assertRaises(ValueError):
            Store(wrong, create=False)
        self.assertEqual(wrong.read_bytes(), b"")
        if os.name == "posix":
            self.assertEqual(self.path.stat().st_mode & 0o077, 0)
        with Store(self.path, create=False) as bound:
            self.assertTrue(bound.owns_chat(self.a))
            self.assertFalse(bound.owns_chat(Scope(self.a.actor_id, self.a.workspace_id, "missing")))
            self.assertFalse(bound.owns_chat(Scope(self.b.actor_id, self.a.workspace_id, self.a.chat_id)))

    def test_opening_unknown_or_newer_database_preserves_it(self):
        unknown = self.path.with_name("unrelated.sqlite3")
        with sqlite3.connect(unknown) as db:
            db.execute("CREATE TABLE existing (id INTEGER)")
        with self.assertRaises(ValueError):
            Store(unknown)
        with sqlite3.connect(unknown) as db:
            self.assertEqual(db.execute("SELECT name FROM sqlite_schema").fetchall(), [("existing",)])
        self.store.close()
        with sqlite3.connect(self.path) as db:
            db.execute("PRAGMA user_version = 2")
        with self.assertRaises(ValueError):
            Store(self.path)
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 2)


if __name__ == "__main__":
    unittest.main()
