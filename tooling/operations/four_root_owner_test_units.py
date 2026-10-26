#!/usr/bin/env python3
"""Canonical source contract for the four-unit owner-test runtime.

This module renders and validates source templates only. It does not write
systemd state, read secrets, start services, or authorize deployment.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re

from verify_owner_test_release import SERVICE_ENTRIES

_RELEASE = re.compile(r"^/opt/octoport/ops-releases/[0-9a-f]{40}$")
_SERVICE_IDENTITY = re.compile(r"^[a-z_][a-z0-9_-]{0,31}$")
SYSTEMD_ROOT = Path(__file__).resolve().parents[2] / "infra/production/systemd"
PRODUCT_ENV = Path("/etc/seller-agents-owner-test/api.env")
MONITOR_ENV = Path("/etc/seller-agents-owner-test/api-monitor.env")
PORTAL_ENV = Path("/etc/seller-agents-owner-test/portal.env")
TSX_LOADERS = {
    "api": "apps/api/node_modules/tsx/dist/cli.mjs",
    "worker": "apps/worker/node_modules/tsx/dist/cli.mjs",
}


class FourRootUnitError(RuntimeError):
    pass


@dataclass(frozen=True)
class UnitContract:
    role: str
    template: str
    working_directory: str
    exec_argv: tuple[str, ...]
    environment_files: tuple[Path, ...]
    dynamic_user: bool = False


def _release_path(release_dir: str) -> str:
    if _RELEASE.fullmatch(release_dir) is None:
        raise FourRootUnitError("FOUR_ROOT_RELEASE_DIR_INVALID")
    return release_dir


def contracts(release_dir: str) -> dict[str, UnitContract]:
    root = _release_path(release_dir)
    return {
        "api": UnitContract(
            role="api",
            template="seller-agents-owner-test-api.service.in",
            working_directory=root,
            exec_argv=(
                f"{root}/.runtime/node",
                f"{root}/{TSX_LOADERS['api']}",
                f"{root}/{SERVICE_ENTRIES['api'][0]}",
            ),
            environment_files=(PRODUCT_ENV, MONITOR_ENV),
        ),
        "worker": UnitContract(
            role="worker",
            template="seller-agents-owner-test-worker.service.in",
            working_directory=root,
            exec_argv=(
                f"{root}/.runtime/node",
                f"{root}/{TSX_LOADERS['worker']}",
                f"{root}/{SERVICE_ENTRIES['worker'][0]}",
            ),
            environment_files=(PRODUCT_ENV,),
        ),
        "portal": UnitContract(
            role="portal",
            template="seller-agents-owner-test-portal.service.in",
            working_directory=f"{root}/{SERVICE_ENTRIES['portal'][1]}",
            exec_argv=(
                f"{root}/.runtime/node",
                f"{root}/{SERVICE_ENTRIES['portal'][0]}",
                "start",
                "--hostname",
                "127.0.0.1",
                "--port",
                "3100",
            ),
            environment_files=(PORTAL_ENV,),
        ),
        "admin": UnitContract(
            role="admin",
            template="seller-agents-owner-test-admin.service.in",
            working_directory=f"{root}/{SERVICE_ENTRIES['admin'][1]}",
            exec_argv=(
                f"{root}/.runtime/node",
                f"{root}/{SERVICE_ENTRIES['admin'][0]}",
                "start",
                "--hostname",
                "127.0.0.1",
                "--port",
                "3101",
            ),
            environment_files=(),
            dynamic_user=True,
        ),
    }


def _line_values(text: str, name: str) -> list[str]:
    prefix = name + "="
    return [line[len(prefix):] for line in text.splitlines() if line.startswith(prefix)]


def _is_root_identity(value: str) -> bool:
    if value == "root":
        return True
    return value.isdecimal() and int(value, 10) == 0


def render_template(
    contract: UnitContract,
    *,
    release_dir: str,
    service_user: str | None = None,
    service_group: str | None = None,
) -> str:
    root = _release_path(release_dir)
    text = (SYSTEMD_ROOT / contract.template).read_text()
    text = text.replace("@RELEASE_DIR@", root)
    if contract.dynamic_user:
        if "@SERVICE_USER@" in text or "@SERVICE_GROUP@" in text:
            raise FourRootUnitError("FOUR_ROOT_DYNAMIC_USER_TEMPLATE_INVALID")
    else:
        if not service_user or not service_group:
            raise FourRootUnitError("FOUR_ROOT_SERVICE_IDENTITY_REQUIRED")
        if _SERVICE_IDENTITY.fullmatch(service_user) is None:
            raise FourRootUnitError("FOUR_ROOT_SERVICE_USER_INVALID")
        if _SERVICE_IDENTITY.fullmatch(service_group) is None:
            raise FourRootUnitError("FOUR_ROOT_SERVICE_GROUP_INVALID")
        if _is_root_identity(service_user) or _is_root_identity(service_group):
            raise FourRootUnitError("FOUR_ROOT_ROOT_SERVICE_FORBIDDEN")
        text = text.replace("@SERVICE_USER@", service_user)
        text = text.replace("@SERVICE_GROUP@", service_group)
    if "@" in text:
        raise FourRootUnitError("FOUR_ROOT_TEMPLATE_PLACEHOLDER_REMAINS")
    return text


def validate_rendered(contract: UnitContract, text: str) -> None:
    working = _line_values(text, "WorkingDirectory")
    if working != [contract.working_directory]:
        raise FourRootUnitError("FOUR_ROOT_WORKING_DIRECTORY_MISMATCH")

    exec_start = _line_values(text, "ExecStart")
    expected_exec = " ".join(contract.exec_argv)
    if exec_start != [expected_exec]:
        raise FourRootUnitError("FOUR_ROOT_EXECSTART_MISMATCH")
    if "/src/main.ts" in expected_exec:
        raise FourRootUnitError("FOUR_ROOT_SOURCE_MODE_ENTRY_FORBIDDEN")
    if contract.role in TSX_LOADERS:
        expected_loader = f"{contract.working_directory}/{TSX_LOADERS[contract.role]}"
        # API/worker work at the release root, so the loader is package-covered
        # and the final argv element remains the verifier-attested business entry.
        if contract.exec_argv[1] != expected_loader:
            raise FourRootUnitError("FOUR_ROOT_RUNTIME_LOADER_MISMATCH")
        if contract.exec_argv[-1] != (
            f"{contract.working_directory}/{SERVICE_ENTRIES[contract.role][0]}"
        ):
            raise FourRootUnitError("FOUR_ROOT_BUSINESS_ENTRY_MISMATCH")

    env_files = tuple(Path(value) for value in _line_values(text, "EnvironmentFile"))
    if env_files != contract.environment_files:
        raise FourRootUnitError("FOUR_ROOT_ENVIRONMENT_SCOPE_MISMATCH")

    if contract.role != "api" and MONITOR_ENV in env_files:
        raise FourRootUnitError("FOUR_ROOT_MONITOR_ENV_SCOPE_INVALID")
    if contract.role == "api" and MONITOR_ENV not in env_files:
        raise FourRootUnitError("FOUR_ROOT_MONITOR_ENV_MISSING")

    if contract.dynamic_user:
        if _line_values(text, "DynamicUser") != ["yes"]:
            raise FourRootUnitError("FOUR_ROOT_DYNAMIC_USER_REQUIRED")
    else:
        users = _line_values(text, "User")
        groups = _line_values(text, "Group")
        if len(users) != 1 or len(groups) != 1:
            raise FourRootUnitError("FOUR_ROOT_SERVICE_IDENTITY_MISSING")
        if (
            _SERVICE_IDENTITY.fullmatch(users[0]) is None
            or _SERVICE_IDENTITY.fullmatch(groups[0]) is None
            or _is_root_identity(users[0])
            or _is_root_identity(groups[0])
        ):
            raise FourRootUnitError("FOUR_ROOT_ROOT_SERVICE_FORBIDDEN")


def render_and_validate(
    release_dir: str,
    *,
    service_users: dict[str, tuple[str, str]],
) -> dict[str, str]:
    result: dict[str, str] = {}
    all_contracts = contracts(release_dir)
    if set(all_contracts) != set(SERVICE_ENTRIES):
        raise FourRootUnitError("FOUR_ROOT_SERVICE_SET_MISMATCH")
    for role, contract in all_contracts.items():
        if contract.dynamic_user:
            text = render_template(contract, release_dir=release_dir)
        else:
            try:
                user, group = service_users[role]
            except KeyError as error:
                raise FourRootUnitError("FOUR_ROOT_SERVICE_IDENTITY_REQUIRED") from error
            text = render_template(
                contract,
                release_dir=release_dir,
                service_user=user,
                service_group=group,
            )
        validate_rendered(contract, text)
        result[role] = text
    return result
