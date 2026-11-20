"""Optional, read-only composition for operator-imported marketplace snapshots."""

import hashlib
import os
from datetime import date
from pathlib import Path

from platform_core.catalog import Capability, Plugin

from .normalize import read_report


PLUGIN_ID = "marketplace-report-archive"


def archive_path(root, workspace_id, day):
    if not isinstance(day, str) or date.fromisoformat(day).isoformat() != day:
        raise ValueError("Expected a date in YYYY-MM-DD format")
    root = Path(root)
    if not root.is_absolute():
        raise ValueError("The report archive root must be absolute")
    workspace_key = hashlib.sha256(workspace_id.encode("utf-8")).hexdigest()
    return root / workspace_key / (day + ".zip")


def archive_root():
    explicit = os.environ.get("HARNESS_REPORT_ARCHIVE_ROOT")
    if explicit:
        return Path(explicit)
    # The authenticated HTTP service gives each worker its own database path.
    database = os.environ.get("HARNESS_PLATFORM_DATABASE")
    if not database or not Path(database).is_absolute():
        raise ValueError("The report archive location is not configured")
    return Path(database + ".reports")


def daily_archive(scope, arguments):
    day = arguments["date"]
    return read_report(archive_path(archive_root(), scope.workspace_id, day), day)


PLUGINS = (
    Plugin(
        id=PLUGIN_ID, version="1.0.0",
        capabilities=(Capability(
            name="marketplace_daily_archive",
            description=(
                "Read an archived daily Ozon and WB report for this workspace. "
                "ordered_units counts physical units. remaining_with_rub and remaining_without_rub "
                "are the amounts remaining before tax with and without the returns/refusals coefficient. "
                "Both include advertising. WB advertising_rub and DRR use posted charges. "
                "The missing campaign count describes only operational advertising statistics. "
                "It does not qualify posted charges or the calculated DRR."
            ),
            input_schema={
                "type": "object",
                "properties": {"date": {"type": "string", "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"}},
                "required": ["date"],
                "additionalProperties": False,
            },
            handler=daily_archive,
        ),),
    ),
)
