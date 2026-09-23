#!/usr/bin/env python3
"""Private, local-only intake for owner-authorized marketplace JSON exports."""
import json
import os
from pathlib import Path
import select
import stat
import sys
import tempfile
import termios
import time

ROOT = Path('/root/octoport-owner-intake/marketplace-json')
MAX_BYTES = 2 * 1024 * 1024
TIMEOUT = 600


class IntakeError(Exception):
    pass


def hidden_json(fd):
    """Read noncanonical input: long one-line exports must not hit TTY line limits."""
    before = termios.tcgetattr(fd)
    mode = termios.tcgetattr(fd)
    mode[3] &= ~(termios.ECHO | termios.ECHONL | termios.ICANON)
    mode[6][termios.VMIN] = 1
    mode[6][termios.VTIME] = 0
    data = bytearray()
    line_start = 0
    deadline = time.monotonic() + TIMEOUT
    try:
        termios.tcsetattr(fd, termios.TCSANOW, mode)
        # Display readiness only after echo has been disabled.
        print('Вставь JSON. Затем Enter, слово КОНЕЦ на отдельной строке и Enter.', flush=True)
        print('Ввод скрыт. Для пропуска: КОНЕЦ без JSON. Для отмены: Ctrl+C.', flush=True)
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise IntakeError('Время ввода истекло; этот файл не сохранён.')
            if not select.select([fd], [], [], min(remaining, 1))[0]:
                continue
            chunk = os.read(fd, 4096)
            if not chunk:
                raise IntakeError('Ввод закрыт; этот файл не сохранён.')
            for byte in chunk:
                if byte == 4:
                    raise IntakeError('Ввод отменён; этот файл не сохранён.')
                data.append(byte)
                if len(data) > MAX_BYTES:
                    raise IntakeError('Файл больше 2 МиБ; этот файл не сохранён.')
                if byte == 10:
                    line = bytes(data[line_start:-1]).strip()
                    if line in ('КОНЕЦ'.encode(), b'END'):
                        return bytes(data[:line_start])
                    line_start = len(data)
    finally:
        # Discard unread paste before returning control to the shell.
        termios.tcflush(fd, termios.TCIFLUSH)
        termios.tcsetattr(fd, termios.TCSANOW, before)
        print()


def validate(raw):
    if len(raw) > MAX_BYTES:
        raise IntakeError('Файл больше 2 МиБ.')
    try:
        text = raw.decode('utf-8-sig')
        def reject_constant(_):
            raise ValueError()
        def unique_object(items):
            result = {}
            for key, value in items:
                if key in result:
                    raise ValueError()
                result[key] = value
            return result
        value = json.loads(text, parse_constant=reject_constant,
                           object_pairs_hook=unique_object)
        if not isinstance(value, (dict, list)) or not value:
            raise ValueError()
    except (ValueError, UnicodeError, RecursionError):
        raise IntakeError('JSON не распознан. Скопируй всё содержимое файла без изменений.') from None


def save(raw, root, filename):
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if any(p.is_symlink() for p in (root, *root.parents)):
        raise IntakeError('Небезопасный каталог; запись отменена.')
    if root.stat().st_uid != os.geteuid():
        raise IntakeError('Каталог принадлежит другому пользователю; запись отменена.')
    root.chmod(0o700)
    target = root / filename
    if target.is_symlink() or (target.exists() and not stat.S_ISREG(target.stat().st_mode)):
        raise IntakeError('Небезопасный файл назначения; запись отменена.')
    tmp = None
    try:
        fd, tmp = tempfile.mkstemp(prefix='.intake-', dir=root)
        with os.fdopen(fd, 'wb') as out:
            os.fchmod(out.fileno(), 0o600)
            out.write(raw)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, target)
        tmp = None
    finally:
        if tmp is not None:
            os.unlink(tmp)


def main():
    if not sys.stdin.isatty():
        print('Запусти эту команду в своей консоли сервера. Ввод из файла или чата отключён.')
        return 2
    os.umask(0o077)
    print('Приём JSON: Ozon, затем Wildberries. Секреты не показываются.')
    print('Файлы останутся только в закрытом каталоге сервера. Проверок API и импорта сейчас нет.')
    try:
        for title, filename in [('Ozon', 'ozon.json'), ('Wildberries', 'wb.json')]:
            while True:
                print('\n' + title, flush=True)
                raw = hidden_json(sys.stdin.fileno())
                if not raw.strip():
                    print('Пропущено. Существующий файл не изменён.')
                    break
                try:
                    validate(raw)
                except IntakeError as error:
                    print(str(error))
                    continue
                if input('JSON корректный. Сохранить (заменить прежний)? Введи ДА: ').strip() != 'ДА':
                    print('Не сохранён. Существующий файл не изменён.')
                    break
                save(raw, ROOT, filename)
                print(title + ': сохранено с правами 0600. Совместимость импорта ещё не проверена.')
                break
    except (KeyboardInterrupt, EOFError):
        print('\nОтменено. Уже подтверждённые файлы сохранены; текущий файл не заменён.')
        return 1
    except IntakeError as error:
        print(str(error))
        return 1
    except OSError:
        print('Ошибка доступа к консоли или файлу; содержимое не выводится.')
        return 1
    print('Готово. Сообщи контроллеру только: JSON внесены (или какой шаг пропущен).')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
