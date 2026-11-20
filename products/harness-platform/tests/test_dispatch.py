from tempfile import TemporaryDirectory
from unittest import TestCase
from pathlib import Path

from platform_core.catalog import Capability, Catalog, Plugin
from platform_core.dispatch import Dispatcher, InvalidToolInput, ToolExecutionFailed, UnavailableTool
from platform_core.storage import Scope, Store


class CompositionTest(TestCase):
    def setUp(self):
        root = TemporaryDirectory()
        self.addCleanup(root.cleanup)
        self.store = Store(Path(root.name) / "state.sqlite3")
        self.addCleanup(self.store.close)
        self.scope = Scope("user-a", "space-a", "chat-a")
        self.store.create_workspace("user-a", "space-a")
        self.store.create_chat(self.scope)
        self.calls = []

        def handler(scope, args):
            self.calls.append(scope)
            return {"value": args["value"]}

        schema = {"type": "object", "properties": {"value": {"type": "integer"}},
                  "required": ["value"], "additionalProperties": False}
        self.plugins = [
            Plugin(pid, "1.0", (Capability(tool, tool, schema, handler),))
            for pid, tool in (("alpha", "first_tool"), ("beta", "second_tool"))
        ]
        self.catalog = Catalog(self.plugins)
        self.dispatcher = Dispatcher(self.catalog, self.store, self.scope)

    def allow(self, name):
        self.store.set_entitlement("space-a", name, True)
        self.store.set_enabled(self.scope, name, True)

    def test_add_second_plugin_via_composition_only_and_revoke(self):
        self.assertEqual(self.dispatcher.list_tools(), ())
        self.allow("beta")
        self.assertEqual([c.name for c in self.dispatcher.list_tools()], ["second_tool"])
        self.assertEqual(self.dispatcher.call_tool("second_tool", {"value": 9}), {"value": 9})
        self.assertEqual(self.calls, [self.scope])
        self.store.set_entitlement("space-a", "beta", False)
        with self.assertRaises(UnavailableTool):
            self.dispatcher.call_tool("second_tool", {"value": 5})
        self.assertEqual(self.calls, [self.scope])

    def test_unknown_and_unauthorized_look_the_same(self):
        self.allow("alpha")
        other = Dispatcher(self.catalog, self.store, Scope("user-b","space-a","chat-a"))
        self.assertEqual(other.list_tools(), ())
        for name in ("first_tool", "not_registered"):
            with self.assertRaisesRegex(UnavailableTool, "^Tool unavailable in this chat$"):
                other.call_tool(name, {})
        self.assertFalse(self.calls)

    def test_arguments_cannot_supply_authority(self):
        self.allow("alpha")
        with self.assertRaises(InvalidToolInput):
            self.dispatcher.call_tool("first_tool", {"value": 1, "actor_id": "somebody"})
        self.assertFalse(self.calls)

    def test_empty_composition_with_existing_entitlements(self):
        self.allow("alpha")
        empty = Dispatcher(Catalog(()), self.store, self.scope)
        self.assertEqual(empty.list_tools(), ())
        with self.assertRaises(UnavailableTool):
            empty.call_tool("first_tool", {"value": 1})


    def test_handler_errors_and_lossy_results_are_sanitized(self):
        for subject in (KeyError("confidential value"), float("nan"), {1: "first", "1": "second"}):
            def respond(_scope, _args):
                if isinstance(subject, Exception):
                    raise subject
                return subject

            capability = Capability("probe", "probe", {"type": "object"}, respond)
            catalog = Catalog((Plugin("probe-plugin", "v1", (capability,)),))
            self.allow("probe-plugin")
            with self.assertRaisesRegex(ToolExecutionFailed, "^Tool execution failed$"):
                Dispatcher(catalog, self.store, self.scope).call_tool("probe", {})
