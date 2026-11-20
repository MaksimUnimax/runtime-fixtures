import hashlib
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from platform_core.identity import AuthenticationError, ChatUnavailable, IdentityStore
from platform_core.storage import Scope, Store


PASSWORD = "correct horse battery staple"
NEW_PASSWORD = "another long account passphrase"


class IdentityTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = Path(folder.name) / "platform.sqlite3"
        self.store = IdentityStore(self.path)
        self.addCleanup(self.store.close)
        self.code = self.store.create_account("Alfa", PASSWORD)

    def test_eleven_character_password_round_trip(self):
        with tempfile.TemporaryDirectory() as directory, IdentityStore(Path(directory)/"short.sqlite") as store:
            store.create_account("short-owner", "abcdefghijk")
            self.assertTrue(store.login("short-owner","abcdefghijk"))
            with self.assertRaises(ValueError):
                store.create_account("empty-owner","")

    def test_concurrent_accounts_distinct_scopes_and_reconnect(self):
        self.store.create_account("Beta", PASSWORD)

        def open_chat(name):
            with IdentityStore(self.path) as handler:
                token = handler.login(name, PASSWORD)
                return token, handler.create_user_chat(token)

        with ThreadPoolExecutor(max_workers=2) as pool:
            (a, chat_a), (b, chat_b) = list(pool.map(open_chat, ["alfa", "beta"]))
        self.assertNotEqual(chat_a.actor_id, chat_b.actor_id)
        self.assertNotEqual(chat_a.workspace_id, chat_b.workspace_id)
        for session, own, foreign in [(a, chat_a, chat_b), (b, chat_b, chat_a)]:
            self.assertEqual(self.store.list_chats(session), [own.chat_id])
            self.assertEqual(self.store.resolve_chat(session, own.chat_id), own)
            for chat_id in [foreign.chat_id, "missing"]:
                with self.assertRaisesRegex(ChatUnavailable, "^Chat unavailable$"):
                    self.store.resolve_chat(session, chat_id)
        with IdentityStore(self.path) as restarted:
            new_device = restarted.login("ALFA", PASSWORD)
            self.assertNotEqual(a, new_device)
            self.assertEqual(restarted.resolve_chat(new_device, chat_a.chat_id), chat_a)
            restarted.logout(a)
            restarted.logout(a)
            with self.assertRaises(AuthenticationError):
                restarted.create_user_chat(a)
            self.assertEqual(restarted.list_chats(new_device), [chat_a.chat_id])
            self.assertEqual(restarted.list_chats(b), [chat_b.chat_id])

    def test_existing_core_ownership_and_plugin_grants_survive_identity_init(self):
        legacy = Scope("old-owner", "legacy", "existing")
        with Store(self.path) as operator:
            operator.provision(legacy)
            operator.set_entitlement(legacy.workspace_id, "reference-text", True)
            operator.set_enabled(legacy, "reference-text", True)
        with IdentityStore(self.path) as accounts:
            self.assertEqual(accounts.enabled_plugins(legacy), ("reference-text",))
            token = accounts.login("alfa", PASSWORD)
            self.assertEqual(accounts.list_chats(token), [])
            with self.assertRaises(ChatUnavailable):
                accounts.resolve_chat(token, legacy.chat_id)

    def test_credential_storage_expiry_and_duplicate_provision(self):
        with self.assertRaises(ValueError):
            self.store.create_account(" ALFA ", PASSWORD)
        with patch("platform_core.identity.time", return_value=1_800_000_000):
            token = self.store.login("alfa", PASSWORD)
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM workspaces").fetchone()[0], 1)
            row = db.execute("SELECT salt, password_hash, recovery_digest FROM identity_accounts").fetchone()
            self.assertGreaterEqual(len(row[0]), 16)
            self.assertNotEqual(row[1], PASSWORD.encode())
            self.assertEqual(row[2], hashlib.sha256(self.code.encode()).digest())
            session = db.execute("SELECT digest, expires_at FROM identity_sessions").fetchone()
            self.assertEqual(session[0], hashlib.sha256(token.encode()).digest())
        with patch("platform_core.identity.time", return_value=session[1] - 1):
            self.assertEqual(self.store.list_chats(token), [])
        with patch("platform_core.identity.time", return_value=session[1]):
            with self.assertRaises(AuthenticationError):
                self.store.list_chats(token)

    def test_recovery_is_single_use_under_race_and_revokes_every_device(self):
        first = self.store.login("alfa", PASSWORD)
        second = self.store.login("alfa", PASSWORD)
        owned = self.store.create_user_chat(first)

        def recover(_):
            with IdentityStore(self.path) as handler:
                try:
                    return handler.reset_password("alfa", self.code, NEW_PASSWORD)
                except AuthenticationError:
                    return None

        with ThreadPoolExecutor(max_workers=2) as pool:
            successes = [code for code in pool.map(recover, range(2)) if code is not None]
        self.assertEqual(len(successes), 1)
        self.assertNotEqual(successes[0], self.code)
        for session in [first, second]:
            with self.assertRaises(AuthenticationError):
                self.store.resolve_chat(session, owned.chat_id)
        with self.assertRaises(AuthenticationError):
            self.store.reset_password("alfa", self.code, PASSWORD)
        with self.assertRaises(AuthenticationError):
            self.store.login("alfa", PASSWORD)
        fresh = self.store.login("alfa", NEW_PASSWORD)
        self.assertEqual(self.store.resolve_chat(fresh, owned.chat_id), owned)

    def test_failed_attempts_persist_and_unlock_at_window_boundary(self):
        with patch("platform_core.identity.time", return_value=1_800_000_000):
            for _ in range(5):
                with self.assertRaises(AuthenticationError):
                    self.store.login("alfa", "long but incorrect password")
        with IdentityStore(self.path) as another_handler:
            with patch("platform_core.identity.time", return_value=1_800_000_299):
                with self.assertRaises(AuthenticationError):
                    another_handler.login("alfa", PASSWORD)
            with patch("platform_core.identity.time", return_value=1_800_000_300):
                self.assertTrue(another_handler.login("alfa", PASSWORD))

    def test_old_password_check_cannot_issue_a_session_after_concurrent_reset(self):
        from platform_core import identity

        original = identity._derive

        def reset_during_check(password, salt):
            candidate = original(password, salt)
            with patch("platform_core.identity._derive", original):
                with IdentityStore(self.path) as second:
                    second.reset_password("alfa", self.code, NEW_PASSWORD)
            return candidate

        with patch("platform_core.identity._derive", reset_during_check):
            with self.assertRaises(AuthenticationError):
                self.store.login("alfa", PASSWORD)
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM identity_sessions").fetchone()[0], 0)
