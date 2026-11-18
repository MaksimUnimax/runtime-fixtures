"""The process owner selects connectors. Model arguments never select credentials."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import stat

from errors import LabError


def strict_json(raw: str | bytes, **kwargs):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate key")
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite")), **kwargs)


def read_json(path: str | Path, *, private: bool = True, maximum: int = 65536) -> dict:
    """No symlink/HTTP/path inputs from tools; callers supply trusted absolute paths."""
    try:
        p = Path(path)
        if not p.is_absolute():
            raise ValueError("relative")
        fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > maximum:
                raise ValueError("type/size")
            if info.st_mode & 0o022:
                raise ValueError("untrusted writable configuration")
            if private and info.st_mode & 0o077:
                # systemd credential mounts can expose 0440 files inside a 0550
                # unit-specific directory. This path comes only from the trusted
                # launcher environment; model/tool parameters cannot select it.
                root_value = os.environ.get("HARNESS_LAB_CREDENTIALS_DIRECTORY") or os.environ.get("CREDENTIALS_DIRECTORY")
                if not root_value:
                    raise ValueError("permissions")
                root = Path(root_value)
                if (not root.is_absolute() or root.is_symlink() or not root.is_dir() or
                        root.stat().st_mode & 0o027 or
                        not p.resolve(strict=True).is_relative_to(root.resolve(strict=True)) or
                        stat.S_IMODE(info.st_mode) not in {0o400, 0o440}):
                    raise ValueError("credential permissions")
            raw = stream.read(maximum + 1)
        value = strict_json(raw)
        if not isinstance(value, dict):
            raise ValueError("object")
        return value
    except (OSError, ValueError, TypeError):
        raise LabError("CONFIG_UNAVAILABLE", "Закрытая конфигурация коннектора недоступна или некорректна.") from None


class Config:
    def __init__(self, path: str | Path):
        self.path = path

    def read(self) -> dict:
        data = read_json(self.path)
        if (data.get("schema") != "harness-lab-connectors/v1" or
                set(data) - {"schema", "scope_id", "revision", "yandex", "ozon"}):
            raise LabError("CONFIG_SCHEMA")
        for field in ("scope_id", "revision"):
            if not isinstance(data.get(field), str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,100}", data[field]):
                raise LabError("CONFIG_SCHEMA")
        for provider in ("yandex", "ozon"):
            item = data.get(provider, {"enabled": False})
            if not isinstance(item, dict) or type(item.get("enabled")) is not bool:
                raise LabError("CONFIG_SCHEMA")
            allowed = {"enabled", "credential_file", "max_daily_requests"}
            if provider == "ozon":
                allowed |= {"core_root", "native_runtime_file", "native_store_id"}
            if set(item) - allowed:
                raise LabError("CONFIG_SCHEMA")
            if item["enabled"]:
                required = allowed - {"enabled"}
                if not required <= set(item):
                    raise LabError("CONFIG_SCHEMA")
                if type(item["max_daily_requests"]) is not int or not 1 <= item["max_daily_requests"] <= 50:
                    raise LabError("CONFIG_SCHEMA")
                for key in required - {"max_daily_requests", "native_store_id"}:
                    if not isinstance(item[key], str) or not Path(item[key]).is_absolute():
                        raise LabError("CONFIG_SCHEMA")
                if provider == "ozon" and (not isinstance(item["native_store_id"], str) or
                                           not re.fullmatch(r"[A-Za-z0-9_.:-]{1,100}", item["native_store_id"])):
                    raise LabError("CONFIG_SCHEMA")
            data[provider] = item
        return data

    def connector(self, provider: str) -> tuple[dict, dict]:
        data = self.read()
        item = data[provider]
        if not item["enabled"]:
            raise LabError("CONNECTOR_DISABLED", "Коннектор не подключён в этом лабораторном доступе.")
        return data, item
