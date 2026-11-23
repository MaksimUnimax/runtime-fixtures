"""Private subprocess. Use the chat's verified matrix grants for every timer read or edit."""
import json
import os
import sys

from ...chat_connections import ChatTools
from ...storage import Scope, Store
from .store import require_plugin
from .recipe import PlanError


def call(packet):
    scope = Scope(*packet["scope"])
    turn = packet["turn"]
    os.environ["HARNESS_MATRIX_TURN"] = json.dumps(turn)
    with Store(turn["databasePath"], create=False) as account:
        require_plugin(account._db, scope)
        tools = {tool.name: tool for tool in ChatTools(account, scope).tools()}
        if packet["op"] == "catalog":
            return {name: {"description": tool.description, "input": tool.input_schema} for name,tool in tools.items()
                    if name in ("marketplace_report","marketplace_read","wordstat_keywords","check_store_access")}
        name, args = packet["tool"], packet["args"]
        tool = tools.get(name)
        if tool is None:
            raise PlanError("Источник отключён в этом чате.")
        if packet["op"] == "read":
            if name == "marketplace_read" and args.get("action") not in ("read","find"):
                raise PlanError("Предпросмотр выполняет только чтение.")
        elif packet["op"] == "write":
            if name != "marketplace_read" or args.get("action") != "edit":
                raise PlanError("Неизвестная операция записи.")
            with account._write() as db:
                from .jobs import verify_write
                verify_write(db, scope, packet["run"], args)
        else:
            raise PlanError("Неизвестный режим вызова.")
        tool.validate(args)
        result = tool.handler(scope, args)
        return result.get("public",result) if isinstance(result,dict) else result


def main():
    try:
        value = call(json.load(sys.stdin))
        print(json.dumps({"result":value},ensure_ascii=False,allow_nan=False))
    except PlanError as exc:
        print(json.dumps({"error":str(exc)},ensure_ascii=False))
    except Exception:
        print(json.dumps({"error":"Источник не подтвердил запрос. Проверьте доступ и параметры шаблона."},ensure_ascii=False))


if __name__ == "__main__":
    main()
