#!/usr/bin/env python3
"""Owner-only interactive secret entry. No network and no service activation."""
import getpass
import os
from pathlib import Path
import re
import sys
import tempfile

DEST = Path('/root/octoport-owner-intake')

def token_valid(value):
    return re.fullmatch(r'[0-9]{5,20}:[A-Za-z0-9_-]{20,200}', value) is not None

def normalize_ids(value, chats=False):
    if not value.strip():
        return ''
    values = [x.strip() for x in value.split(',')]
    pattern = r'-?[1-9][0-9]{0,19}' if chats else r'[1-9][0-9]{0,19}'
    if len(values) > 20 or any(re.fullmatch(pattern, x) is None for x in values):
        raise ValueError('Некорректный список числовых ID; значения не выводятся.')
    return ','.join(dict.fromkeys(values))

def main():
    if not sys.stdin.isatty() or not sys.stderr.isatty():
        raise SystemExit('Нужна личная интерактивная консоль с TTY. Не передавайте секрет аргументом или через чат.')
    if os.geteuid() != 0:
        raise SystemExit('Этот путь принадлежит root. Используйте свой разрешённый доступ к серверу.')
    if DEST.is_symlink() or not DEST.is_dir() or DEST.stat().st_uid != os.geteuid():
        raise SystemExit('Защищённый каталог не соответствует ожидаемому. Секрет не запрашивался.')
    if DEST.stat().st_mode & 0o077:
        raise SystemExit('Каталог должен иметь права 0700. Секрет не запрашивался.')
    target = DEST / 'telegram.env'
    if target.is_symlink():
        raise SystemExit('Неожиданная ссылка вместо файла. Секрет не запрашивался.')
    print('Ввод только в своей консоли. Запись заменит staging telegram.env; сервисы не изменятся.')
    token = getpass.getpass('Токен своего Telegram-бота (ввод скрыт): ').strip()
    if not token_valid(token):
        raise SystemExit('Неожиданный формат токена; ничего не записано, значение не выводится.')
    try:
        operators = normalize_ids(input('User ID администраторов через запятую (Enter, если пока неизвестны): '))
        chats = normalize_ids(input('Chat ID доставки через запятую (Enter, если пока неизвестны): '), chats=True)
    except ValueError as exc:
        raise SystemExit(str(exc))
    if input('Записать в staging-файл? Введите ДА: ').strip() != 'ДА':
        raise SystemExit('Отменено, файл не изменён.')
    temp_name = None
    try:
        fd, temp_name = tempfile.mkstemp(prefix='.telegram-', dir=DEST)
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            handle.write('TELEGRAM_BOT_TOKEN=' + token + '\n')
            handle.write('TELEGRAM_OPERATOR_IDS=' + operators + '\n')
            handle.write('TELEGRAM_NOTIFICATION_CHAT_IDS=' + chats + '\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, target)
        temp_name = None
        dir_fd = os.open(DEST, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    finally:
        if temp_name is not None:
            os.unlink(temp_name)
    print('Staging-файл сохранён с правами 0600. Секрет не проверялся по сети. Бот не запущен.')
    print('Сообщите контроллеру только: токен внесён; ID заполнены или ещё нужны.')

if __name__ == '__main__':
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        raise SystemExit('Ввод отменён.')
