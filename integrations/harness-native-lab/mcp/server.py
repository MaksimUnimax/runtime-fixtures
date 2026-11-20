#!/usr/bin/env python3
"""Official MCP SDK, stdio only; closed typed schemas and non-reflective errors."""
from __future__ import annotations

import asyncio
import json
import logging
import os

from jsonschema import Draft202012Validator
from mcp.server.lowlevel import Server
from mcp.server.stdio import stdio_server
from mcp.types import CallToolResult, TextContent, Tool, ToolAnnotations

from application import Application, error_result
from errors import LabError

logging.basicConfig(level=logging.WARNING)
application = None
server = Server("harness-lab-business", version="0.1.0",
                instructions="Read-only, single-owner lab tools. No secrets or account IDs in arguments. "
                "Use provider data with its freshness/currency caveats; never invent unavailable results.")

TOOLS = [
    Tool(name="lab_capabilities", description="List configured lab connectors, limits and safe setup guidance. No provider calls.",
         inputSchema={"type": "object", "properties": {}, "additionalProperties": False},
         annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False)),
    Tool(name="yandex_collect_phrases", description=(
        "Collect real Wordstat phrases and associations for ONE seed via the Yandex Marketing Bridge GetTop contract. "
        "One provider request maximum; recent exact repeats cached. Counts are historical search frequency, not sales. "
        "Official warning: statistics after 2026-10-07 unavailable. Never send keys."),
         inputSchema={"type": "object", "additionalProperties": False, "required": ["phrase"], "properties": {
             "phrase": {"type": "string", "minLength": 1, "maxLength": 400},
             "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 20},
             "regions": {"type": "array", "items": {"type": "string", "pattern": r"^[0-9]{1,10}$"},
                         "minItems": 1, "maxItems": 5, "uniqueItems": True, "default": ["225"]},
             "device": {"type": "string", "enum": ["all", "desktop", "phone", "tablet"], "default": "all"}}},
         annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=False, openWorldHint=True)),
    Tool(name="marketplace_orders_report", description=(
        "Get real ordered units and order revenue for the server-authorized Ozon store using the native matrix handler. "
        "One completed Moscow-time period of 1–31 days. If the user says yesterday/вчера, "
        "ALWAYS call with {period: yesterday} so the SERVER resolves the real date; do not guess from the model clock or earlier dates. "
        "Alternatively give exact date_from/date_to YYYY-MM-DD. Successful repeats cached 15 minutes; "
        "429 does not auto-retry; follow explicit retry_after and the minimum one-minute Ozon analytics interval. "
        "Orders are not payouts or profit; respect reported currency and caveats."),
         inputSchema={"type": "object", "additionalProperties": False, "properties": {
             "period": {"type": "string", "enum": ["yesterday"]},
             "date_from": {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2}$"},
             "date_to": {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2}$"}},
             "oneOf": [
                 {"required": ["period"], "not": {"anyOf": [{"required": ["date_from"]}, {"required": ["date_to"]}]}},
                 {"required": ["date_from", "date_to"], "not": {"required": ["period"]}}]},
         annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=False, openWorldHint=True)),
    Tool(name="marketplace_stock_snapshot", description=(
        "Get the current real stock snapshot for the server-authorized Ozon store using the native qualified matrix. "
        "FBO/FBS present and reserved units are separate; no historical date and no extra reserve subtraction. "
        "At most one request/1000 products; incomplete pagination returns an error, not a fabricated total. "
        "Exact successful repeats cached 120 seconds. Does not use the analytics/data endpoint."),
         inputSchema={"type": "object", "properties": {}, "additionalProperties": False},
         annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=False, openWorldHint=True)),
]
VALIDATORS = {tool.name: Draft202012Validator(tool.inputSchema) for tool in TOOLS}


@server.list_tools()
async def list_tools():
    return TOOLS


@server.call_tool(validate_input=False)
async def call_tool(name, arguments):
    # Same declared schema, but generic errors avoid echoing credential-like input values.
    try:
        if name not in VALIDATORS:
            raise LabError("UNKNOWN_TOOL")
        if not VALIDATORS[name].is_valid(arguments):
            raise LabError("INVALID_ARGUMENTS", "Параметры не соответствуют объявленной схеме инструмента.")
        if application is None:
            raise LabError("CONFIG_UNAVAILABLE")
        result = await application.call(name, arguments)
        return CallToolResult(content=[TextContent(type="text", text=json.dumps(result, ensure_ascii=False))],
                              structuredContent=result)
    except LabError as error:
        result = error_result(error)
        return CallToolResult(content=[TextContent(type="text", text=json.dumps(result, ensure_ascii=False))],
                              structuredContent=result, isError=True)
    except Exception:
        result = error_result(LabError("INTERNAL_ERROR", "Лабораторный инструмент недоступен; результаты не подставлялись."))
        return CallToolResult(content=[TextContent(type="text", text=json.dumps(result, ensure_ascii=False))],
                              structuredContent=result, isError=True)


async def main():
    global application
    os.umask(0o077)
    try:
        application = Application(os.environ["HARNESS_LAB_CONNECTORS_FILE"], os.environ["HARNESS_LAB_STATE_DIR"])
        application.config.read()
    except Exception:
        # No exception repr, environment values, paths or credentials in diagnostics.
        logging.error("MCP startup failed: private lab configuration unavailable")
        return 2
    async with stdio_server() as streams:
        await server.run(*streams, server.create_initialization_options())
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
