from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Barrier
from concurrent.futures import ThreadPoolExecutor
import unittest
from uuid import uuid4

from starlette.exceptions import HTTPException

from platform_core.storage import Scope, Store
from platform_core.user_plugins.timer import schedule, store


def utc(text):
    return schedule.instant(datetime.fromisoformat(text))


INTERVAL = {"kind": "interval", "zone": "Asia/Qyzylorda", "every_us": 37_000_000}
PLAN = {"steps": [{"templateId": "fixture.orders", "connectionId": "fixture-shop"}],
        "telegram": False, "format": "Итого по дням"}


class Schedules(unittest.TestCase):
    def test_interval_has_no_clock_rounding_or_drift(self):
        anchor = utc("2026-11-22T08:00:00+05:00")
        for delta in (1, 37000000, 8100000000):
            rule = dict(INTERVAL, every_us=delta)
            self.assertEqual(schedule.next_after(rule, anchor + 12 * delta, anchor), anchor + 13 * delta)
            self.assertEqual(schedule.next_after(rule, anchor + 13 * delta - 1, anchor), anchor + 13 * delta)

    def test_calendar_weekdays_and_times_in_owner_zone(self):
        rule = {"kind": "calendar", "zone": "Asia/Qyzylorda", "weekdays": [1, 2, 3, 4, 5],
                "times": ["17:45", "08:00"]}
        self.assertEqual(schedule.next_after(rule, utc("2026-11-20T17:45:00+05:00"), 0),
                         utc("2026-11-23T08:00:00+05:00"))
        self.assertEqual(schedule.next_after(rule, utc("2026-11-23T08:01:00+05:00"), 0),
                         utc("2026-11-23T17:45:00+05:00"))

    def test_dst_gap_is_skipped_and_repeated_hour_runs_once(self):
        rule = {"kind": "calendar", "zone": "Europe/Berlin", "weekdays": list(range(1, 8)), "times": ["02:30"]}
        self.assertEqual(schedule.next_after(rule, utc("2026-03-28T23:00:00+00:00"), 0),
                         utc("2026-03-30T00:30:00+00:00"))
        first = utc("2026-10-25T00:30:00+00:00")
        self.assertEqual(schedule.next_after(rule, first-1, 0), first)
        self.assertEqual(schedule.next_after(rule, first, 0), utc("2026-10-26T01:30:00+00:00"))

    def test_once_and_invalid_schedules(self):
        rule = {"kind": "once", "zone": "Europe/Moscow", "at": "2026-11-24T08:00:00+03:00"}
        expected = utc(rule["at"])
        self.assertEqual(schedule.next_after(rule, expected - 1, 0), expected)
        self.assertIsNone(schedule.next_after(rule, expected, 0))
        for bad in (dict(rule, at="2026-11-24T08:00"), dict(INTERVAL, zone="Never/Here"),
                    dict(INTERVAL, every_us=False), dict(INTERVAL, every_us=0),
                    {"kind": "calendar", "zone": "UTC", "weekdays": [0], "times": ["08:00"]}):
            with self.subTest(rule=bad), self.assertRaises(ValueError):
                schedule.validate(bad)


class Drafts(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(TemporaryDirectory()))
        self.path = self.root / "platform.db"
        self.storage = self.enterContext(Store(self.path))
        self.scope = Scope("owner", "workspace", "chat")
        self.other = Scope("other", "other-workspace", "other-chat")
        self.second_chat = Scope("owner", "workspace", "second")
        for scope in (self.scope, self.other, self.second_chat):
            self.storage.provision(scope)
            self.storage.set_entitlement(scope.workspace_id, "timer", True)
            self.storage.set_enabled(scope, "timer", True)
        with self.storage._write() as db:
            store.initialize(db)

    def call(self, fn, *args, scope=None, **kwargs):
        with self.storage._write() as db:
            return fn(db, scope or self.scope, *args, **kwargs)

    def start(self, text="Расходы вчера", target=None):
        return self.call(store.start, "report", text, target)["id"]

    def preview(self, key, revision=1, rule=INTERVAL):
        return self.call(store.record_preview, key, revision, rule, PLAN, "Расход 100 ₽")

    def accept(self):
        key = self.start()
        return self.call(store.confirm, key, 1, self.preview(key), now_us=0)

    def test_only_last_actual_test_can_be_confirmed(self):
        key = self.start()
        with self.assertRaises(HTTPException):
            self.call(store.confirm, key, 1, None)
        old = self.preview(key)
        self.call(store.refine, key, 1, "Ещё остатки")
        with self.assertRaises(HTTPException):
            self.call(store.record_preview, key, 1, INTERVAL, PLAN, "поздний старый результат")
        with self.assertRaises(HTTPException):
            self.call(store.confirm, key, 2, old)
        self.assertEqual(self.call(store.list_events), ([], None))
        first = self.preview(key, 2)
        latest = self.preview(key, 2)
        with self.assertRaises(HTTPException):
            self.call(store.confirm, key, 2, first)
        row = self.call(store.confirm, key, 2, latest, now_us=0)
        self.assertEqual(row["plan"], PLAN)
        self.assertEqual(row["instructions"], ["Расходы вчера", "Ещё остатки"])
        self.assertEqual(row["next_us"], INTERVAL["every_us"])
        self.assertEqual(self.call(store.confirm, key, 2, latest)["id"], row["id"])

    def test_draft_creation_replay_checks_contents(self):
        request_id = uuid4().hex
        a = self.call(store.start, "action", "Одна поставка", request_id=request_id)
        b = self.call(store.start, "action", "Одна поставка", request_id=request_id)
        self.assertEqual(a["id"], b["id"])
        with self.assertRaises(HTTPException):
            self.call(store.start, "report", "Другое", request_id=request_id)

    def test_two_concurrent_confirmations_commit_one_event(self):
        key = self.start()
        receipt = self.preview(key)
        barrier = Barrier(2)
        def confirm_again(_):
            with Store(self.path, create=False) as independent:
                barrier.wait(timeout=5)
                with independent._write() as db:
                    return store.confirm(db, self.scope, key, 1, receipt, now_us=0)["id"]
        with ThreadPoolExecutor(2) as pool:
            ids = list(pool.map(confirm_again, range(2)))
        self.assertEqual(len(set(ids)), 1)
        self.assertEqual(len(self.call(store.list_events)[0]), 1)

    def test_edit_keeps_previous_version_and_preserves_pause(self):
        initial = self.accept()
        key = initial["id"]
        other_draft = self.start("Показывай остатки", key)
        abandoned = self.start("Отдельный итог", key)
        self.call(store.cancel, abandoned, 1)
        self.assertEqual(self.call(store.event, key), initial)
        receipt = self.preview(other_draft)
        self.call(store.change_status, key, "pause")
        changed = self.call(store.confirm, other_draft, 1, receipt, now_us=10)
        self.assertEqual((changed["id"], changed["status"], changed["next_us"]), (key, "paused", None))
        self.call(store.change_status, key, "resume", now_us=80_000_000)
        self.assertEqual(self.call(store.event, key)["next_us"], 111_000_000)

    def test_competing_edits_do_not_overwrite_each_other(self):
        key = self.accept()["id"]
        a, b = self.start("Утром", key), self.start("Вечером", key)
        ar, br = self.preview(a), self.preview(b)
        self.call(store.confirm, b, 1, br)
        with self.assertRaises(HTTPException):
            self.call(store.confirm, a, 1, ar)
        self.assertIn("Вечером", self.call(store.event, key)["instructions"])

    def test_revocation_is_atomic_and_cross_owner_access_is_denied(self):
        key = self.accept()["id"]
        draft = self.start("Правка", key)
        for scope in (self.other, self.second_chat):
            with self.subTest(scope=scope), self.assertRaises(HTTPException):
                self.call(store.change_status, key, "delete", scope=scope)
        self.storage.set_entitlement("workspace", "timer", False)
        self.storage.set_entitlement("workspace", "timer", True)
        self.storage.set_enabled(self.scope, "timer", True)
        self.assertEqual(self.call(store.event, key)["status"], "paused")
        with self.assertRaises(HTTPException):
            self.call(store.draft, draft)

    def test_restart_expired_one_shot_and_pagination(self):
        events = [self.accept()["id"] for _ in range(53)]
        with Store(self.path, create=False) as reopened, reopened._write() as db:
            store.initialize(db)
            page, cursor = store.list_events(db, self.scope)
            rest, end = store.list_events(db, self.scope, cursor)
        self.assertIsNone(end)
        self.assertEqual([r["id"] for r in page + rest], list(reversed(events)))
        key = self.start()
        receipt = self.preview(key, rule={"kind": "once", "zone": "UTC", "at": "2026-11-22T12:00:00Z"})
        with self.assertRaises(HTTPException):
            self.call(store.confirm, key, 1, receipt, now_us=utc("2026-11-23T00:00:00Z"))
