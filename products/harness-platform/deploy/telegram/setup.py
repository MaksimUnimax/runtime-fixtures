#!/usr/bin/python3
"""Configure report delivery from an interactive root terminal on the application server."""
import getpass
import http.client
import json
import os
import re
import sys
import tempfile
from pathlib import Path

CONFIG_DIR = Path("/etc/harness-prod")
CREDENTIAL = Path("/etc/credstore/octoport-telegram.json")


def bot_username(bot_id, token, port):
    connection = http.client.HTTPSConnection("127.0.0.1", port, timeout=10)
    connection.set_tunnel("api.telegram.org", 443)
    try:
        connection.request("POST", "/bot" + token + "/getMe", body=b"")
        response = connection.getresponse()
        payload = json.loads(response.read(16384))
        if response.status != 200 or payload.get("ok") is not True:
            sys.exit("Telegram отклонил проверку бота. Данные не сохранены.")
        result = payload["result"]
        if not result.get("is_bot") or str(result.get("id")) != bot_id:
            sys.exit("Telegram вернул другой идентификатор. Данные не сохранены.")
        return result["username"]
    except (OSError, http.client.HTTPException, ValueError, KeyError, TypeError):
        sys.exit("Не удалось подтвердить бота через роутер Telegram. Данные не сохранены.")
    finally:
        connection.close()


def main():
    if os.geteuid() != 0 or not sys.stdin.isatty():
        sys.exit("Запустите в интерактивном терминале сервера с правами root.")
    port = int((CONFIG_DIR / "telegram-connect-port").read_text().strip())
    if not 1 <= port <= 65535:
        sys.exit("Проверьте локальный порт Telegram.")
    token = getpass.getpass("Bot Token из BotFather (скрытый ввод): ").strip()
    if not re.fullmatch(r"[1-9][0-9]{0,15}:[A-Za-z0-9_-]{20,}", token):
        sys.exit("Проверьте формат Bot Token.")
    bot_id = token.split(":", 1)[0]
    username = bot_username(bot_id, token, port)
    print("Telegram подтвердил бота @" + username)
    previous = json.loads(CREDENTIAL.read_text()) if CREDENTIAL.exists() else {}
    if previous and str(previous.get("client_id")) != bot_id:
        if input("Меняется бот. Для замены введите его @имя: ").strip() != "@" + username:
            sys.exit("Запись отменена.")
    secret = getpass.getpass("Client Secret этого бота из Login Widget (скрытый ввод): ").strip()
    if not secret or secret == token or any(ch.isspace() for ch in secret):
        sys.exit("Проверьте Client Secret.")
    config = dict(client_id=bot_id, client_secret=secret, bot_token=token, connect_proxy_port=port)
    tmp = None
    try:
        with tempfile.NamedTemporaryFile("w", dir=CREDENTIAL.parent, delete=False) as stream:
            tmp = Path(stream.name)
            os.fchmod(stream.fileno(), 0o600)
            json.dump(config, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, CREDENTIAL)
    finally:
        if tmp is not None:
            tmp.unlink(missing_ok=True)
    print("Данные сохранены. Примените их плановым перезапуском harness-prod.")


if __name__ == "__main__":
    main()
