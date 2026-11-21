"""One MCP connection serves one scope, bound by its trusted launcher."""

import asyncio
import json

from mcp import types
from mcp.server.lowlevel import Server
from mcp.server.stdio import stdio_server

from .dispatch import Dispatcher, InvalidToolInput, UnavailableTool


def _tool_error(message: str) -> types.CallToolResult:
    return types.CallToolResult(
        is_error=True, content=[types.TextContent(type="text", text=message)]
    )


def create_server(dispatcher: Dispatcher) -> Server:
    async def list_tools(_ctx, _params) -> types.ListToolsResult:
        try:
            return types.ListToolsResult(tools=[
                types.Tool(
                    name=tool.name,
                    description=tool.description,
                    input_schema=tool.input_schema,
                )
                for tool in dispatcher.list_tools()
            ])
        except Exception:
            # Underlying storage/provider messages can contain private details.
            raise RuntimeError("Tool catalog unavailable") from None

    # The dispatcher checks current grants before it validates input. Using the
    # SDK's cached schema here could disclose a revoked tool's contract.
    async def call_tool(_ctx, params: types.CallToolRequestParams) -> types.CallToolResult:
        name, arguments = params.name, params.arguments or {}
        try:
            value = await asyncio.to_thread(dispatcher.call_tool, name, arguments)
        except UnavailableTool:
            return _tool_error("Tool unavailable in this chat")
        except InvalidToolInput:
            return _tool_error("Invalid tool input")
        except Exception:
            return _tool_error("Tool execution failed")

        try:
            diagnostics = None
            if name == "marketplace_report" and isinstance(value, dict) and "public" in value:
                diagnostics = value.get("diagnostics")
                value = value["public"]
            payload = {"result": value}
            text = json.dumps(payload, ensure_ascii=False, allow_nan=False)
            return types.CallToolResult(
                structured_content=payload, meta=diagnostics, content=[types.TextContent(type="text", text=text)]
            )
        except (TypeError, ValueError, RecursionError):
            return _tool_error("Tool produced an invalid result")

    return Server("harness-platform",on_list_tools=list_tools,on_call_tool=call_tool)


async def serve_stdio(dispatcher: Dispatcher) -> None:
    server = create_server(dispatcher)
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())
