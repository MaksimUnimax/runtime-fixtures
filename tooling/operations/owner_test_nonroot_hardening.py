#!/usr/bin/env python3
"""Validate and render the owner-test non-root systemd source candidate.

This module is deliberately source-only. It does not call systemctl, useradd,
groupadd, chmod/chown, or read credential contents.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

SYSTEMD_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_.-]{0,63}")
PLACEHOLDER_USER = "@SERVICE_USER@"
PLACEHOLDER_GROUP = "@SERVICE_GROUP@"
ACCEPTED_MAINTENANCE_PATH = "/var/lib/octoport-owner-test-api/maintenance.json"

SERVICES: dict[str, dict[str, str | None]] = {
    "api": {
        "unit": "seller-agents-owner-test-api.service",
        "user": "octoport-owner-test-api",
        "group": "octoport-owner-test-api",
        "template": "seller-agents-owner-test-api-hardening.conf.in",
        "state_directory": "octoport-owner-test-api",
    },
    "worker": {
        "unit": "seller-agents-owner-test-worker.service",
        "user": "octoport-owner-test-worker",
        "group": "octoport-owner-test-worker",
        "template": "seller-agents-owner-test-worker-hardening.conf.in",
        "state_directory": None,
    },
    "portal": {
        "unit": "seller-agents-owner-test-portal.service",
        "user": "octoport-owner-test-portal",
        "group": "octoport-owner-test-portal",
        "template": "seller-agents-owner-test-portal-hardening.conf.in",
        "state_directory": None,
    },
}

COMMON_REQUIRED = {
    "User": PLACEHOLDER_USER,
    "Group": PLACEHOLDER_GROUP,
    "UMask": "0077",
    "NoNewPrivileges": "yes",
    "PrivateTmp": "yes",
    "ProtectSystem": "strict",
    "ProtectHome": "yes",
    "CapabilityBoundingSet": "",
    "AmbientCapabilities": "",
}

FORBIDDEN_DIRECTIVES = {
    "MemoryHigh",
    "MemoryMax",
    "CPUQuota",
    "CPUQuotaPerSecUSec",
    "TasksMax",
    "ReadWritePaths",
    "ReadWriteDirectories",
    "BindPaths",
    "BindReadOnlyPaths",
    "IPAddressAllow",
    "IPAddressDeny",
    "RestrictAddressFamilies",
    "Environment",
    "EnvironmentFile",
}


class HardeningCandidateError(RuntimeError):
    pass


def _name(value: str, code: str) -> str:
    normalized = value.strip()
    if not normalized or not SYSTEMD_NAME.fullmatch(normalized):
        raise HardeningCandidateError(code)
    if normalized == "root":
        raise HardeningCandidateError(code)
    return normalized


def canonical_identities() -> dict[str, dict[str, str]]:
    return {
        role: {
            "user": str(spec["user"]),
            "group": str(spec["group"]),
        }
        for role, spec in SERVICES.items()
    }


def validate_identities(
    identities: dict[str, dict[str, str]],
) -> dict[str, dict[str, str]]:
    if set(identities) != set(SERVICES):
        raise HardeningCandidateError("SERVICE_SET_INVALID")
    result: dict[str, dict[str, str]] = {}
    users: set[str] = set()
    groups: set[str] = set()
    for role, spec in SERVICES.items():
        item = identities.get(role)
        if not isinstance(item, dict):
            raise HardeningCandidateError("SERVICE_IDENTITY_INVALID")
        user = _name(str(item.get("user", "")), "SERVICE_USER_INVALID")
        group = _name(str(item.get("group", "")), "SERVICE_GROUP_INVALID")
        if user in users or group in groups:
            raise HardeningCandidateError("SERVICE_IDENTITY_SHARED")
        if user != spec["user"] or group != spec["group"] or user != group:
            raise HardeningCandidateError("SERVICE_IDENTITY_NOT_CANONICAL")
        users.add(user)
        groups.add(group)
        result[role] = {"user": user, "group": group}
    return result


def validate_maintenance_path(path: str | None) -> dict[str, Any]:
    if path is None:
        return {
            "status": "NO_ACTIVE_CREDENTIAL_PATH",
            "acceptedPath": ACCEPTED_MAINTENANCE_PATH,
        }
    value = path.strip()
    if not value:
        raise HardeningCandidateError("MAINTENANCE_STORAGE_PATH_EMPTY")
    if path == ACCEPTED_MAINTENANCE_PATH:
        return {
            "status": "COMPATIBLE_PRIVATE_STATE_PATH",
            "acceptedPath": ACCEPTED_MAINTENANCE_PATH,
        }
    if value == "/root" or value.startswith("/root/"):
        raise HardeningCandidateError(
            "MAINTENANCE_STORAGE_INCOMPATIBLE_WITH_PROTECT_HOME"
        )
    raise HardeningCandidateError("MAINTENANCE_STORAGE_PATH_NOT_ACCEPTED")


def _directives(text: str) -> dict[str, str]:
    section: str | None = None
    values: dict[str, str] = {}
    saw_service = False
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line
            if section != "[Service]":
                raise HardeningCandidateError("TEMPLATE_SECTION_INVALID")
            if saw_service:
                raise HardeningCandidateError("TEMPLATE_SECTION_DUPLICATE")
            saw_service = True
            continue
        if section != "[Service]" or "=" not in raw:
            raise HardeningCandidateError("TEMPLATE_LINE_INVALID")
        key, value = raw.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key or key in values:
            raise HardeningCandidateError("TEMPLATE_DIRECTIVE_DUPLICATE")
        values[key] = value
    if not saw_service:
        raise HardeningCandidateError("TEMPLATE_SERVICE_SECTION_MISSING")
    return values


def validate_template(role: str, text: str) -> dict[str, str]:
    if role not in SERVICES:
        raise HardeningCandidateError("SERVICE_ROLE_INVALID")
    values = _directives(text)
    if FORBIDDEN_DIRECTIVES.intersection(values):
        raise HardeningCandidateError("TEMPLATE_FORBIDDEN_DIRECTIVE")
    expected = dict(COMMON_REQUIRED)
    state_directory = SERVICES[role]["state_directory"]
    if state_directory is not None:
        expected["StateDirectory"] = str(state_directory)
        expected["StateDirectoryMode"] = "0700"
    if values != expected:
        raise HardeningCandidateError("TEMPLATE_DIRECTIVES_INVALID")
    if text.count(PLACEHOLDER_USER) != 1 or text.count(PLACEHOLDER_GROUP) != 1:
        raise HardeningCandidateError("TEMPLATE_PLACEHOLDER_INVALID")
    return values


def render_service(
    role: str,
    *,
    template_dir: Path,
    identities: dict[str, dict[str, str]] | None = None,
) -> str:
    checked = validate_identities(
        canonical_identities() if identities is None else identities
    )
    if role not in SERVICES:
        raise HardeningCandidateError("SERVICE_ROLE_INVALID")
    template = template_dir / str(SERVICES[role]["template"])
    if not template.is_file() or template.is_symlink():
        raise HardeningCandidateError("TEMPLATE_PATH_INVALID")
    raw = template.read_text(encoding="utf-8")
    validate_template(role, raw)
    rendered = raw.replace(PLACEHOLDER_USER, checked[role]["user"]).replace(
        PLACEHOLDER_GROUP,
        checked[role]["group"],
    )
    if PLACEHOLDER_USER in rendered or PLACEHOLDER_GROUP in rendered:
        raise HardeningCandidateError("TEMPLATE_RENDER_INCOMPLETE")
    return rendered


def candidate_plan(
    template_dir: Path,
    *,
    maintenance_credential_file: str | None,
    identities: dict[str, dict[str, str]] | None = None,
) -> dict[str, Any]:
    checked = validate_identities(
        canonical_identities() if identities is None else identities
    )
    maintenance = validate_maintenance_path(maintenance_credential_file)
    services: dict[str, Any] = {}
    for role, spec in SERVICES.items():
        rendered = render_service(role, template_dir=template_dir, identities=checked)
        directives = _directives(rendered)
        if FORBIDDEN_DIRECTIVES.intersection(directives):
            raise HardeningCandidateError("RENDERED_FORBIDDEN_DIRECTIVE")
        services[role] = {
            "unit": spec["unit"],
            "user": checked[role]["user"],
            "group": checked[role]["group"],
            "stateDirectory": spec["state_directory"],
            "renderedSha256": hashlib.sha256(rendered.encode("utf-8")).hexdigest(),
        }
    return {
        "status": "SOURCE_CANDIDATE_VALID",
        "liveMutationPerformed": False,
        "credentialContentsRead": False,
        "maintenanceStorage": maintenance,
        "resourceLimits": "UNRESOLVED_NOT_RENDERED",
        "networkPolicy": "UNCHANGED_NOT_RENDERED",
        "releaseTreeWritable": False,
        "services": services,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate the source-only owner-test non-root hardening candidate."
    )
    parser.add_argument(
        "--template-dir",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "infra/production/systemd",
    )
    maintenance = parser.add_mutually_exclusive_group(required=True)
    maintenance.add_argument("--maintenance-credential-file")
    maintenance.add_argument(
        "--no-active-maintenance-credential",
        action="store_true",
    )
    args = parser.parse_args()
    path = None if args.no_active_maintenance_credential else args.maintenance_credential_file
    try:
        result = candidate_plan(
            args.template_dir,
            maintenance_credential_file=path,
        )
    except (HardeningCandidateError, OSError, UnicodeError) as error:
        print(json.dumps({"status": "BLOCKED", "reason": str(error)}, sort_keys=True))
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
