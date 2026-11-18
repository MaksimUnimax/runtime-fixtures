#!/usr/bin/env python3
"""Prepare an isolated native Alisa QueryService release; never activate it.

Copies the audited active platform release, preserves its dependency symlinks,
applies the pinned query patch and writes a reviewable systemd drop-in plus
static activation/rollback instructions. No systemd mutation, restart, migration,
credential read or authority-service change is performed by this script.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
from datetime import datetime, timezone

from platform_query_patch import SOURCE_RELEASE, SOURCE_RELATIVE_PATH, SOURCE_SHA256, patch_source


SOURCE_DIRECTORY = Path("/opt/alisa-platform/stage/releases") / SOURCE_RELEASE
LAUNCH_SHA256 = "eed73e92028d3a6ddbb5e92bae526826c9e9513d4783ee0f609d296bc1f82899"
MANIFEST_SHA256 = "3de5506935f76e482560076facc683815e4963aecede144f88b8fb267a563d1a"
VENV_LINK = "/opt/alisa-platform/stage/releases/alisa-coefficient-station-platform-485a2034ac0dc36f/.venv"
UNIT = "alisa-platform@stage.service"
DROPIN_DIRECTORY = Path("/etc/systemd/system") / f"{UNIT}.d"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def check_source(source: Path) -> dict:
    expected = {SOURCE_RELATIVE_PATH: SOURCE_SHA256, "infra/launch.py": LAUNCH_SHA256,
                "manifest.json": MANIFEST_SHA256}
    for relative, digest in expected.items():
        path = source / relative
        require(not path.is_symlink(), f"Audited source file became a symlink: {relative}")
        require(sha256(path) == digest, f"Audited source changed: {relative}")
    require((source / ".venv").is_symlink(), "Expected the existing symlinked venv")
    require(os.readlink(source / ".venv") == VENV_LINK, "Dependency symlink changed")
    require((source / ".venv/bin/python").is_file(), "Original dependency Python is unavailable")
    manifest = json.loads((source / "manifest.json").read_text())
    require(manifest["artifact_id"] == SOURCE_RELEASE, "Source release identity changed")
    require(manifest["files"][SOURCE_RELATIVE_PATH] == SOURCE_SHA256, "Source manifest query hash changed")
    return expected


def inspect_live_unit(source: Path) -> dict:
    result = subprocess.run(
        ["systemctl", "show", UNIT, "--property=WorkingDirectory,ExecStart,DropInPaths,EnvironmentFiles"],
        check=True, capture_output=True, text=True,
    )
    properties = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
    require(properties.get("WorkingDirectory") == str(source), "Active platform release changed")
    command = properties.get("ExecStart", "")
    require(f"{source}/.venv/bin/python" in command and f"{source}/infra/launch.py platform" in command,
            "Active platform launcher changed")
    paths = shlex.split(properties.get("DropInPaths", ""))
    require(paths, "Could not inspect existing platform drop-ins")
    return {"properties": properties, "dropins": {p: sha256(Path(p)) for p in paths}}


def dropin_name(paths: list[str]) -> str:
    names = [Path(p).name for p in paths]
    longest_z = max((len(name) - len(name.lstrip("z")) for name in names), default=0)
    candidate = "z" * (longest_z + 1) + "-harness-query.conf"
    require(len(candidate.encode()) <= 255, "No safe drop-in filename fits NAME_MAX")
    require(all(candidate > name for name in names), "Proposed drop-in would not be last")
    return candidate


def write_new(path: Path, value: bytes, reference: Path | None = None) -> None:
    with path.open("xb") as stream:
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())
        if reference is not None:
            info = reference.stat()
            os.fchmod(stream.fileno(), info.st_mode & 0o777)
            if os.geteuid() == 0:
                os.fchown(stream.fileno(), info.st_uid, info.st_gid)
        else:
            os.fchmod(stream.fileno(), 0o644)


def prepare(source: Path, output: Path, plan: Path, snapshot: dict) -> dict:
    source = source.resolve(strict=True)
    require(source.name == SOURCE_RELEASE, "Unexpected source release directory")
    require(not output.exists() and not output.is_symlink(), "Output release already exists")
    require(not plan.exists() and not plan.is_symlink(), "Plan directory already exists")
    output, plan = output.resolve(), plan.resolve()
    require(output.parent == source.parent, "Overlay must be a new sibling release")
    require(re.fullmatch(r"alisa-[a-z0-9][a-z0-9-]*", output.name) is not None, "Invalid overlay release name")
    for path in (source, output, plan):
        require(re.fullmatch(r"/[A-Za-z0-9_./-]+", str(path)) is not None, "Unsafe systemd path characters")
    require(not plan.is_relative_to(source) and not plan.is_relative_to(output), "Plan must be outside release trees")
    expected = check_source(source)
    require(snapshot["properties"]["WorkingDirectory"] == str(source), "Snapshot release mismatch")
    filename = dropin_name(list(snapshot["dropins"]))
    installed_dropin = DROPIN_DIRECTORY / filename
    require(not installed_dropin.exists() and not installed_dropin.is_symlink(), "Overlay drop-in already exists")
    for path, digest in snapshot["dropins"].items():
        require(sha256(Path(path)) == digest, f"Live drop-in changed during preparation: {Path(path).name}")

    # GNU cp preserves ownership, modes, dependency symlinks and internal links.
    # It creates independent destination inodes (or safe copy-on-write reflinks).
    subprocess.run(["cp", "-a", "--reflink=auto", "--", str(source), str(output)], check=True)
    check_source(output)
    target = output / SOURCE_RELATIVE_PATH
    patched = patch_source((source / SOURCE_RELATIVE_PATH).read_bytes())
    staged = target.with_name(target.name + ".harness-new")
    write_new(staged, patched, reference=target)
    os.replace(staged, target)
    patched_digest = sha256(target)

    manifest_path = output / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["artifact_id"] = output.name
    manifest["acceptance"] = "PREPARED_NOT_ACTIVATED"
    manifest["files"][SOURCE_RELATIVE_PATH] = patched_digest
    manifest["harness_query_overlay"] = {
        "source_release": SOURCE_RELEASE,
        "source_manifest_sha256": MANIFEST_SHA256,
        "source_query_sha256": SOURCE_SHA256,
        "output_query_sha256": patched_digest,
        "marker": "harness_runtime_v1",
    }
    staged_manifest = manifest_path.with_name("manifest.json.harness-new")
    write_new(staged_manifest, (json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode(), reference=manifest_path)
    os.replace(staged_manifest, manifest_path)
    require(sha256(output / "infra/launch.py") == LAUNCH_SHA256, "Copied launcher changed")
    require(os.readlink(output / ".venv") == VENV_LINK, "Copied venv target changed")
    check_source(source)

    plan.mkdir(parents=True, exist_ok=False)
    planned_dropin = plan / filename
    content = (
        "# Prepared Harness receipt isolation; existing environment and hardening are inherited.\n"
        "[Service]\n"
        f"WorkingDirectory={output}\n"
        f"Environment=ALISA_RELEASE={output.name}\n"
        "ExecStart=\n"
        f"ExecStart={output}/.venv/bin/python {output}/infra/launch.py platform\n"
    )
    write_new(planned_dropin, content.encode())
    record = {
        "status": "PREPARED_NOT_ACTIVATED", "created_at": datetime.now(timezone.utc).isoformat(),
        "unit": UNIT, "source_release": str(source), "output_release": str(output),
        "source_sha256": expected,
        "output_sha256": {SOURCE_RELATIVE_PATH: patched_digest, "infra/launch.py": LAUNCH_SHA256,
                          "manifest.json": sha256(manifest_path)},
        "venv_link": VENV_LINK, "live_unit_snapshot": snapshot,
        "planned_dropin": str(planned_dropin), "installed_dropin": str(installed_dropin),
        "dropin_sha256": sha256(planned_dropin),
    }
    write_new(plan / "plan.json", (json.dumps(record, sort_keys=True, indent=2) + "\n").encode())
    # These are static instructions only. There is deliberately no activation
    # command or restart subprocess anywhere in this preparation program.
    steps = f"""# Prepared platform overlay

Status: PREPARED_NOT_ACTIVATED. Source release is unchanged.
Authority, web and identity services are unchanged. No migrations are needed.

Before activation, compare the effective platform WorkingDirectory and drop-in
hashes with plan.json. A concurrent release change requires another review.
Install only the reviewed new drop-in, preserving all existing overrides:

```bash
install -m 0644 {shlex.quote(str(planned_dropin))} {shlex.quote(str(installed_dropin))}
systemctl daemon-reload
systemctl show {UNIT} --property=WorkingDirectory,ExecStart
```

The effective directory and both executable paths must point to `{output}`.
Only after that check, activate the prepared platform process:

```bash
systemctl restart {UNIT}
systemctl is-active {UNIT}
```

Verify platform health and the intended native/Harness query separation. Retain
the old release and this plan. Do not change /opt/alisa-platform/stage/current.

## Rollback

After any Harness traffic, rollback the new UI, engine and gateway while keeping
this platform QueryService guard active. Removing the guard while unexpired
Harness receipts exist would expose them to native history and native dispatch.
Stop the Harness gateway before considering removal so it cannot create more
receipts. Keep the guard in the selected rollback release if any remain.

The original unguarded platform release may be restored only after a read-only
check under the existing platform settings reports zero unexpired receipts:

```python
Query.objects.filter(continuation__has_key='harness_runtime_v1',
                     expires_at__gt=timezone.now()).count()
```

If the count is nonzero, retain the guard until ordinary TTL/retention makes
that count zero. Do not delete or rewrite receipts to satisfy this check.
The following override removal applies ONLY after this prerequisite is met,
or before Harness has accepted any traffic.

First confirm the installed drop-in hash equals `{record['dropin_sha256']}`;
do not remove a file another rollout has since changed. Remove only this
prepared override, then reload and restart the same platform unit:

```bash
rm -- {shlex.quote(str(installed_dropin))}
systemctl daemon-reload
systemctl show {UNIT} --property=WorkingDirectory,ExecStart
systemctl restart {UNIT}
systemctl is-active {UNIT}
```

The effective source should again be `{source}`. No database rollback, receipt
deletion, dependency reinstall, authority restart or web restart is required.
"""
    write_new(plan / "ACTIVATION_AND_ROLLBACK.md", steps.encode())
    return record


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-release", type=Path, default=SOURCE_DIRECTORY)
    parser.add_argument("--output-release", required=True, type=Path)
    parser.add_argument("--plan-directory", required=True, type=Path)
    args = parser.parse_args()
    try:
        source = args.source_release.resolve(strict=True)
        snapshot = inspect_live_unit(source)
        result = prepare(source, args.output_release, args.plan_directory, snapshot)
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Platform overlay preparation refused: {error}\n")
    print(json.dumps({key: result[key] for key in (
        "status", "source_release", "output_release", "planned_dropin", "installed_dropin", "output_sha256"
    )}, sort_keys=True))


if __name__ == "__main__":
    main()
