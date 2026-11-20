"""Local operator commands for the account and native chat acceptance service."""

import argparse
import getpass
from pathlib import Path

import uvicorn

from .chat_api import create_app
from .identity import IdentityStore


def main():
    parser = argparse.ArgumentParser(prog="python -m platform_core.chat_service")
    parser.add_argument("--db", type=Path, required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    add = commands.add_parser("create-account")
    add.add_argument("login")
    role = commands.add_parser("set-role", help="Set a local account's administrative role")
    role.add_argument("login")
    role.add_argument("role", choices=("admin", "user"))
    serve = commands.add_parser("serve")
    serve.add_argument("--chats", required=True, type=Path)
    serve.add_argument("--port", type=int, default=8765)
    serve.add_argument("--composition")
    args = parser.parse_args()
    if args.command == "create-account":
        password = getpass.getpass("Password: ")
        if password != getpass.getpass("Repeat password: "):
            parser.error("Passwords differ")
        with IdentityStore(args.db) as identity:
            try:
                recovery = identity.create_account(args.login, password)
            except ValueError as error:
                parser.error(str(error))
        print(f"One-time recovery code: {recovery}")
    elif args.command == "set-role":
        with IdentityStore(args.db) as identity:
            try:
                identity.set_admin(args.login, args.role == "admin")
            except ValueError as error:
                parser.error(str(error))
    else:
        app = create_app(args.db, args.chats, composition_module=args.composition)
        uvicorn.run(app, host="127.0.0.1", port=args.port, access_log=False)


if __name__ == "__main__":
    main()
