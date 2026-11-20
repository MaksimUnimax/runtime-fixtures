"""Reconcile an offline joint-marketplace-statistics/v2 export at display precision."""

import argparse
import csv
import io
import json
import sys
from collections import Counter
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, localcontext
from pathlib import Path
from zipfile import BadZipFile, ZipFile


CENT = Decimal("0.01")
LEDGER_COLUMNS = {
    "original_turnover_rub": "revenue_without",
    "advertising_rub": "advertising_with",
    "remaining_with_rub": "profit_with",
    "remaining_without_rub": "profit_without",
}


def number(value, field):
    if isinstance(value, bool) or not isinstance(value, (str, int, Decimal)):
        raise ValueError(f"{field}: expected a number")
    try:
        result = Decimal(value)
    except InvalidOperation:
        raise ValueError(f"{field}: expected a number") from None
    if not result.is_finite():
        raise ValueError(f"{field}: expected a finite number")
    return result


def display(value):
    if value is None:
        return None
    rounded = value.quantize(CENT, rounding=ROUND_HALF_UP)
    return format(rounded if rounded else abs(rounded), "f")


def object_field(record, field):
    if not isinstance(record, dict) or field not in record:
        raise ValueError(f"missing field: {field}")
    return record[field]


def summarize(totals):
    turnover = totals["original_turnover_rub"]
    drr = totals["advertising_rub"] * 100 / turnover if turnover else None
    return {
        "ordered_units": totals["ordered_units"],
        **{key: display(totals[key]) for key in LEDGER_COLUMNS},
        "drr_percent": display(drr),
    }


def check_totals(label, declared, totals):
    result = summarize(totals)
    for key, expected in result.items():
        value = object_field(declared, key)
        if key == "ordered_units":
            value = number(value, key)
        elif value is not None:
            value = display(number(value, key))
        if value != expected:
            if totals["ordered_units"] == 0 and key == "advertising_rub" and value is not None:
                raise ValueError(f"{label}: cannot verify unallocated advertising from an empty ledger")
            raise ValueError(f"{label}.{key}: disagrees with ledger")
    return result


def read_ledger(archive, filename):
    totals = dict.fromkeys(LEDGER_COLUMNS, Decimal(0))
    totals["ordered_units"] = 0
    with archive.open(filename) as member, io.TextIOWrapper(
        member, encoding="utf-8-sig", newline=""
    ) as stream:
        rows = csv.DictReader(stream, strict=True)
        headers = rows.fieldnames or []
        required = {"original_quantity", *LEDGER_COLUMNS.values()}
        if len(set(headers)) != len(headers) or not required.issubset(headers):
            raise ValueError(f"{filename}: invalid ledger header")
        for row in rows:
            if None in row or number(row["original_quantity"], "original_quantity") != 1:
                raise ValueError(f"{filename}: expected one physical unit per row")
            totals["ordered_units"] += 1
            for key, column in LEDGER_COLUMNS.items():
                totals[key] += number(row[column], column)
    return totals


def reconcile_ads(record, day, wb_totals):
    if object_field(record, "date") != day:
        raise ValueError("advertising reconciliation date differs from summary")
    posted = number(object_field(record, "wb_posted_rub"), "wb_posted_rub")
    if display(posted) != display(wb_totals["advertising_rub"]):
        raise ValueError("wb_posted_rub disagrees with WB ledger")
    operational = object_field(record, "wb_operational_rub")
    declared_gap = object_field(record, "wb_posted_minus_operational_rub")
    gap = None
    if operational is not None:
        operational = number(operational, "wb_operational_rub")
        gap = posted - operational
    if declared_gap is not None:
        declared_gap = number(declared_gap, "wb_posted_minus_operational_rub")
    if display(declared_gap) != display(gap):
        raise ValueError("WB advertising reconciliation difference is inconsistent")
    missing = record.get("missing_wb_fullstats_campaign_ids")
    missing_count = None
    if missing is not None:
        if not isinstance(missing, list) or any(
            type(item) not in (str, int) or not str(item).strip() for item in missing
        ):
            raise ValueError("invalid list of missing WB campaigns")
        missing_count = len({str(item) for item in missing})
    if operational is None:
        coverage = "unavailable"
    elif missing_count is None:
        coverage = "unknown"
    elif missing_count:
        coverage = "partial"
    else:
        coverage = "reported_complete"
    return {
        "posted_rub": display(posted),
        "operational_rub": display(operational),
        "posted_minus_operational_rub": display(gap),
        "operational_coverage": coverage,
        "missing_campaign_count": missing_count,
    }


def read_object(archive, name):
    with archive.open(name) as member:
        result = json.load(member, parse_float=Decimal)
    if not isinstance(result, dict):
        raise ValueError(f"{name}: expected a JSON object")
    return result


def replay(archive):
    filenames = {p: f"{p.upper()}_PHYSICAL_UNIT_LEDGER.csv" for p in ("ozon", "wb")}
    summary_name = "SUMMARY.json"
    ads_name = "ADVERTISING_SOURCE_RECONCILIATION.json"
    members = Counter(archive.namelist())
    for name in (summary_name, ads_name, *filenames.values()):
        if members[name] != 1:
            raise ValueError(f"expected exactly one {name}")
    summary = read_object(archive, summary_name)
    if object_field(summary, "schema") != "joint-marketplace-statistics/v2":
        raise ValueError("unsupported report schema")
    if object_field(summary, "quantity_basis") != "PHYSICAL_ORDERED_UNITS_NOT_DISTINCT_CUSTOMER_ORDERS":
        raise ValueError("unsupported quantity basis")
    day = object_field(summary, "date")
    if not isinstance(day, str) or date.fromisoformat(day).isoformat() != day:
        raise ValueError("expected ISO calendar date")
    stores = object_field(summary, "stores")
    if not isinstance(stores, list):
        raise ValueError("stores must be an array")
    by_platform = {}
    for item in stores:
        platform = object_field(item, "platform")
        if not isinstance(platform, str) or platform not in filenames or platform in by_platform:
            raise ValueError("expected unique Ozon and WB stores")
        if object_field(item, "date") != day:
            raise ValueError(f"{platform}: store date differs from summary")
        by_platform[platform] = item
    if by_platform.keys() != filenames.keys():
        raise ValueError("expected both Ozon and WB stores")

    ledger = {p: read_ledger(archive, name) for p, name in filenames.items()}
    report = {"date": day}
    for platform, totals in ledger.items():
        report[platform] = check_totals(platform, by_platform[platform], totals)
    combined = {key: ledger["ozon"][key] + ledger["wb"][key] for key in ledger["ozon"]}
    report["combined"] = check_totals("combined", object_field(summary, "combined"), combined)
    report["wb_advertising"] = reconcile_ads(read_object(archive, ads_name), day, ledger["wb"])
    return report


def verify_archive(path):
    """Return an aggregate reference result, or raise ValueError for an inconsistent export."""
    try:
        with ZipFile(path) as archive, localcontext() as context:
            context.prec = 50
            return replay(archive)
    except (BadZipFile, csv.Error, ArithmeticError) as exc:
        raise ValueError(f"invalid daily report: {exc}") from exc


def compare_output(expected, actual, path="report"):
    """Compare the reference fields while permitting unrelated connector metadata."""
    if isinstance(expected, dict) and isinstance(actual, dict):
        for key, value in expected.items():
            if key not in actual:
                raise ValueError(f"{path}.{key}: missing from connector output")
            compare_output(value, actual[key], f"{path}.{key}")
    elif type(expected) is not type(actual) or expected != actual:
        raise ValueError(f"{path}: connector output differs from reference")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="daily statistics ZIP")
    parser.add_argument("--actual", type=Path, help="normalized result returned by the connector")
    args = parser.parse_args(argv)
    try:
        report = verify_archive(args.archive)
        if args.actual is not None:
            compare_output(report, json.loads(args.actual.read_text(encoding="utf-8")))
    except (OSError, ValueError) as exc:
        print(f"replay: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
