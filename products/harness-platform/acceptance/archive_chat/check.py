"""Exercise a dated archive through a disposable authenticated native chat."""

import argparse
import json
import os
import secrets
import shutil
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from starlette.testclient import TestClient

from platform_core.chat_api import create_app
from platform_core.identity import IdentityStore
from report_archive.plugin import PLUGIN_ID, archive_path


def run_check(archive, day):
    if not os.environ.get("HARNESS_NODE_MODULES"):
        raise ValueError("HARNESS_NODE_MODULES must point to the installed native Harness")
    with TemporaryDirectory() as directory, patch.dict(os.environ, {
        "HARNESS_OFFLINE_MODEL": "1", "HARNESS_OFFLINE_ADAPTER": "archive_chat",
    }):
        db = Path(directory) / "acceptance.sqlite3"
        chat_dir = Path(directory) / "chats"
        password = secrets.token_urlsafe(32)
        with IdentityStore(db) as store:
            store.create_account("archive-owner", password)
        app = create_app(db, chat_dir, composition_module="report_archive.plugin")
        with TestClient(app) as client:
            login = client.post("/api/login", json={"login": "archive-owner", "password": password})
            login.raise_for_status()
            token = login.json()["token"]
            headers = {"Authorization": f"Bearer {token}"}
            chat = client.post("/api/chats", headers=headers)
            chat.raise_for_status()
            chat_id = chat.json()["chatId"]
            with IdentityStore(db) as store:
                scope = store.resolve_chat(token, chat_id)
                dest = archive_path(Path(str(db) + ".reports"), scope.workspace_id, day)
                dest.parent.mkdir(parents=True)
                shutil.copyfile(archive, dest)
                store.set_entitlement(scope.workspace_id, PLUGIN_ID, True)
                store.set_enabled(scope, PLUGIN_ID, True)

            answer = client.post(f"/api/chats/{chat_id}/turns", headers=headers, json={
                "requestId": "daily-report", "text": f"Покажи архивный отчёт Ozon и WB за {day}",
            })
            answer.raise_for_status()
            reply = answer.json()
            if reply["role"] != "assistant" or reply["requestId"] != "daily-report":
                raise ValueError("Unexpected chat reply")
        # Read through a restarted worker and the same authenticated API.
        with TestClient(create_app(db, chat_dir, composition_module="report_archive.plugin")) as client:
            history = client.get(f"/api/chats/{chat_id}/messages", headers=headers)
            history.raise_for_status()
            if history.json()[-1:] != [reply]:
                raise ValueError("Report was not restored from chat history")
        return json.loads(reply["text"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("day", help="ISO calendar date of the report")
    args = parser.parse_args()
    print(json.dumps(run_check(args.archive, args.day), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
