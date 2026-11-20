"""Exercise the grant issuer against the product store."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from hashlib import sha256
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest



COMPONENT = Path(__file__).resolve().parent
PRODUCT = COMPONENT.parent
sys.path.insert(0, str(PRODUCT))
from platform_core.operation_grants import (
    OperationScope, initialize_grants, issue_grant, model_operation, revoke_grant,
)
from platform_core.storage import Scope, Store
from platform_core import coins
ALICE = OperationScope("actor-A", "workspace-A", "chat-A")
BOB = OperationScope("actor-B", "workspace-B", "chat-B")
LOOKUP = """SELECT o.operation_id, o.workspace_id, o.source
            FROM usage_grants AS g
            JOIN usage_operations AS o ON o.operation_id=g.operation_id
            JOIN workspaces AS w ON w.workspace_id=o.workspace_id AND w.owner_id=o.actor_id
            WHERE g.token_hash=? AND g.expires_at>unixepoch()
            AND (o.chat_id='' OR EXISTS (
                SELECT 1 FROM chats AS c WHERE c.workspace_id=o.workspace_id AND c.chat_id=o.chat_id
            ))"""


def provision(path):
    with Store(path) as store:
        for scope in (ALICE, BOB):
            store.provision(Scope(scope.actor_id, scope.workspace_id, scope.chat_id))
    initialize_grants(path)
    with closing(sqlite3.connect(path)) as db, db:
        for scope in (ALICE, BOB):
            coins.grant(db, "fixture", scope.workspace_id, scope.workspace_id, "100", "Fixture funding")


class OperationGrantTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.path = Path(temp.name) / "platform.sqlite"
        provision(self.path)

    def issue(self, scope=ALICE, source="chat", run_key="request-7", **kwargs):
        return issue_grant(self.path, scope, source=source, run_key=run_key, **kwargs)

    def lookup(self, grant):
        with closing(sqlite3.connect(self.path.as_uri() + "?mode=ro", uri=True)) as db:
            return db.execute(LOOKUP, (sha256(grant.token.encode()).hexdigest(),)).fetchone()

    def test_initialize_before_first_grant_and_reject_unknown_database(self):
        initialize_grants(self.path)
        initialize_grants(self.path)
        with closing(sqlite3.connect(self.path)) as db:
            self.assertIsNone(db.execute(LOOKUP, ("unknown",)).fetchone())
        other = self.path.with_name("other.sqlite")
        with self.assertRaises(sqlite3.OperationalError):
            initialize_grants(other)
        self.assertFalse(other.exists())
        with closing(sqlite3.connect(other)) as db:
            db.execute("CREATE TABLE unrelated(id)")
        with self.assertRaises(ValueError):
            initialize_grants(other)
        with closing(sqlite3.connect(other)) as db:
            self.assertEqual(db.execute("SELECT name FROM sqlite_schema").fetchall(), [("unrelated",)])

    def test_token_is_opaque_only_digest_is_stored_and_lifetime_is_bounded_by_argument(self):
        before = int(time.time())
        grant = self.issue(ttl_seconds=60)
        self.assertRegex(grant.token, r"^[A-Za-z0-9_-]{43}$")
        self.assertRegex(grant.operation_id, r"^[0-9a-f]{32}$")
        self.assertNotIn(grant.token, repr(grant))
        digest = sha256(grant.token.encode()).hexdigest()
        with closing(sqlite3.connect(self.path)) as db:
            stored, op, expires = db.execute("SELECT * FROM usage_grants").fetchone()
        self.assertEqual((stored, op), (digest, grant.operation_id))
        self.assertLessEqual(before + 60, expires)
        self.assertLessEqual(expires, int(time.time()) + 60)
        self.assertNotIn(grant.token.encode(), self.path.read_bytes())
        self.assertEqual(self.lookup(grant), (grant.operation_id, ALICE.workspace_id, "chat"))

    def test_retries_share_operation_across_connections_and_processes(self):
        with ThreadPoolExecutor(max_workers=8) as pool:
            grants = list(pool.map(lambda _: self.issue(), range(16)))
        self.assertEqual(len({grant.operation_id for grant in grants}), 1)
        self.assertEqual(len({grant.token for grant in grants}), len(grants))
        code = (
            "import sys; from platform_core.operation_grants import OperationScope, issue_grant; "
            "scope = OperationScope(*sys.argv[2:]); "
            "print(issue_grant(sys.argv[1], scope, source='chat', run_key='request-7').operation_id)"
        )
        proc = subprocess.run(
            [sys.executable, "-B", "-c", code, str(self.path), ALICE.actor_id,
             ALICE.workspace_id, ALICE.chat_id], cwd=PRODUCT, capture_output=True,
            text=True, check=True, timeout=10,
        )
        self.assertEqual(proc.stdout.strip(), grants[0].operation_id)

    def test_identity_source_chat_and_run_key_are_distinct(self):
        workspace = OperationScope(ALICE.actor_id, ALICE.workspace_id)
        grants = [self.issue(), self.issue(BOB), self.issue(source="scheduler"),
                  self.issue(workspace), self.issue(run_key="request-8")]
        self.assertEqual(len({g.operation_id for g in grants}), len(grants))
        with closing(sqlite3.connect(self.path)) as db:
            chat = db.execute("SELECT chat_id FROM usage_operations WHERE operation_id=?",
                              (grants[3].operation_id,)).fetchone()
        self.assertEqual(chat, ("",))
        self.assertEqual(self.lookup(grants[3]), (grants[3].operation_id, ALICE.workspace_id, "chat"))

    def test_current_owner_and_chat_are_rechecked_by_issuer_and_gateway(self):
        chat_grant = self.issue()
        workspace = OperationScope(ALICE.actor_id, ALICE.workspace_id)
        workspace_grant = self.issue(workspace, source="schedule")
        for invalid in (OperationScope(ALICE.actor_id, BOB.workspace_id, BOB.chat_id),
                        OperationScope(ALICE.actor_id, ALICE.workspace_id, BOB.chat_id),
                        OperationScope(BOB.actor_id, ALICE.workspace_id)):
            with self.assertRaises(PermissionError):
                self.issue(invalid)
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("DELETE FROM chats WHERE chat_id=?", (ALICE.chat_id,))
        self.assertIsNone(self.lookup(chat_grant))
        self.assertIsNotNone(self.lookup(workspace_grant))
        with self.assertRaises(PermissionError):
            self.issue()
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("UPDATE workspaces SET owner_id=? WHERE workspace_id=?",
                       (BOB.actor_id, ALICE.workspace_id))
        self.assertIsNone(self.lookup(workspace_grant))
        with self.assertRaises(PermissionError):
            self.issue(workspace)

    def test_expiration_and_revocation_leave_sibling_grants_and_operation_intact(self):
        first, second, third = [self.issue() for _ in range(3)]
        revoke_grant(self.path, first.token)
        revoke_grant(self.path, first.token)
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("UPDATE usage_grants SET expires_at=unixepoch() WHERE token_hash=?",
                       (sha256(second.token.encode()).hexdigest(),))
        self.assertIsNone(self.lookup(first))
        self.assertIsNone(self.lookup(second))
        self.assertIsNotNone(self.lookup(third))
        self.assertEqual(self.issue().operation_id, third.operation_id)

    def test_context_revokes_after_provider_exception(self):
        with self.assertRaisesRegex(RuntimeError, "test failure"):
            with model_operation(self.path, ALICE, source="plugin.check", run_key="occurrence") as grant:
                self.assertIsNotNone(self.lookup(grant))
                raise RuntimeError("test failure")
        self.assertIsNone(self.lookup(grant))
        self.assertEqual(self.issue(source="plugin.check", run_key="occurrence").operation_id, grant.operation_id)

    def test_invalid_inputs_do_not_issue_grants(self):
        initialize_grants(self.path)
        for kwargs in ({"scope": OperationScope(" actor", "workspace")},
                       {"scope": OperationScope("actor", "workspace", "")},
                       {"scope": OperationScope("actor", "workspace", "a" * 257)},
                       {"scope": OperationScope("actor", "workspace\0")},
                       {"source": "Chat"}, {"source": "chat/task"},
                       {"run_key": "raw prompt with whitespace"},
                       {"ttl_seconds": True}, {"ttl_seconds": 0}, {"ttl_seconds": 2**63}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                self.issue(**kwargs)
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM usage_operations").fetchone(), (0,))


if __name__ == "__main__":
    unittest.main()
