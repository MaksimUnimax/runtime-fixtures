"""Local operator CLI. Browser and model inputs never select a composition or a scope."""

import argparse
import asyncio
import importlib
import json
import sqlite3
import sys

from .catalog import Catalog
from .dispatch import Dispatcher, ToolExecutionFailed
from .storage import Scope, Store


def arguments():
    parser = argparse.ArgumentParser(prog="python -m platform_core")
    parser.add_argument("--db", required=True, help="Private local SQLite file")
    parser.add_argument("--composition", help="Operator-selected installed module exporting PLUGINS")
    commands = parser.add_subparsers(dest="command", required=True)
    for action in ("init", "grant", "revoke", "enable", "disable", "list", "call", "serve"):
        command = commands.add_parser(action)
        command.add_argument("--workspace", required=True)
        if action not in ("grant", "revoke"):
            command.add_argument("--actor", required=True)
            command.add_argument("--chat", required=True)
        if action in ("grant", "revoke", "enable", "disable"):
            command.add_argument("--plugin", required=True)
        if action == "call":
            command.add_argument("name")
            command.add_argument("arguments", help="JSON object")
    return parser.parse_args()


def main():
    args = arguments()
    plugins = tuple(importlib.import_module(args.composition).PLUGINS) if args.composition else ()
    catalog = Catalog(plugins)
    with Store(args.db, create=args.command == "init") as store:
        execute(args, catalog, plugins, store)


def execute(args, catalog, plugins, store):
    if args.command in ("grant", "enable") and args.plugin not in {p.id for p in plugins}:
        raise ValueError("Unknown installed plugin")
    if args.command in ("grant", "revoke"):
        store.set_entitlement(args.workspace, args.plugin, args.command == "grant")
        return
    scope = Scope(args.actor, args.workspace, args.chat)
    if args.command == "init":
        store.provision(scope)
        return
    if not store.owns_chat(scope):
        raise PermissionError("Chat unavailable")
    if args.command in ("enable", "disable"):
        store.set_enabled(scope, args.plugin, args.command == "enable")
        return
    dispatcher = Dispatcher(catalog, store, scope)
    if args.command == "serve":
        from .mcp_server import serve_stdio
        asyncio.run(serve_stdio(dispatcher))
        return
    if args.command == "list":
        output = [tool.name for tool in dispatcher.list_tools()]
    else:
        output = dispatcher.call_tool(args.name, json.loads(args.arguments))
    print(json.dumps(output, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, PermissionError, LookupError, sqlite3.Error, ToolExecutionFailed) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
