import json
from pathlib import Path
import sys
import tempfile
import unittest
from datetime import timedelta

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.shared.memory import create_connected_server_and_client_session

from platform_core.catalog import Capability, Catalog, Plugin
from platform_core.dispatch import Dispatcher
from platform_core.mcp_server import create_server
from platform_core.storage import Scope, Store


ROOT = Path(__file__).resolve().parents[1]


class McpTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = Path(self.temp.name) / "state.sqlite"
        self.store = Store(self.db)
        self.scope = Scope("owner-a", "space-a", "chat-a")
        self.store.create_workspace("owner-a", "space-a")
        self.store.create_chat(self.scope)

    def grant(self, plugin_id):
        self.store.set_entitlement("space-a", plugin_id, True)
        self.store.set_enabled(self.scope, plugin_id, True)

    async def test_real_stdio_discovery_call_and_revocation(self):
        params = StdioServerParameters(
            command=sys.executable,
            cwd=ROOT,
            args=[
                "-m", "platform_core", f"--db={self.db}",
                "--composition=examples.reference_plugin", "serve",
                "--actor=owner-a", "--workspace=space-a", "--chat=chat-a",
            ],
        )
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write, read_timeout_seconds=timedelta(seconds=10)) as client:
                await client.initialize()
                self.assertEqual((await client.list_tools()).tools, [])
                self.grant("reference-text")
                tools = (await client.list_tools()).tools
                self.assertEqual([tool.name for tool in tools], ["summarize_text"])
                self.assertEqual(tools[0].inputSchema["required"], ["text"])

                result = await client.call_tool("summarize_text", {"text": "два   слова"})
                self.assertFalse(result.isError)
                self.assertEqual(result.structuredContent["result"]["words"], 2)
                self.assertEqual(json.loads(result.content[0].text), result.structuredContent)

                invalid = await client.call_tool("summarize_text", {"actor_id": "another-actor"})
                self.assertTrue(invalid.isError)
                self.assertNotIn("another-actor", invalid.content[0].text)

                self.store.set_entitlement("space-a", "reference-text", False)
                # Deliberately call from the client's stale tool list before rediscovery.
                revoked = await client.call_tool("summarize_text", {"text": "try again"})
                unknown = await client.call_tool("unknown_tool", {})
                self.assertTrue(revoked.isError)
                self.assertTrue(unknown.isError)
                self.assertEqual(revoked.content, unknown.content)
                self.assertEqual((await client.list_tools()).tools, [])

    async def test_non_object_result_and_handler_failure(self):
        def probe(_scope, arguments):
            if arguments.get("fail"):
                raise RuntimeError("private fixture details")
            return [None, 0, False]

        tool = Capability(
            "probe", "Protocol test",
            {"type": "object", "properties": {"fail": {"type": "boolean"}},
             "additionalProperties": False},
            probe,
        )
        catalog = Catalog([Plugin("sample", "1.0.0", (tool,))])
        self.grant("sample")
        server = create_server(Dispatcher(catalog, self.store, self.scope))
        async with create_connected_server_and_client_session(server) as client:
            result = await client.call_tool("probe", {})
            self.assertFalse(result.isError)
            self.assertEqual(result.structuredContent["result"], [None, 0, False])
            failure = await client.call_tool("probe", {"fail": True})
            self.assertTrue(failure.isError)
            self.assertNotIn("private fixture details", failure.content[0].text)
