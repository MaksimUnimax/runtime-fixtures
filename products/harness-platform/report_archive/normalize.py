"""Read the marketplace snapshots in a configured historical daily export."""

import json
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, DecimalException, ROUND_HALF_UP, localcontext
from pathlib import PurePosixPath
from zipfile import BadZipFile, ZipFile


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (str, int, Decimal)):
        raise ValueError("Missing or invalid numeric metric")
    number = Decimal(value)
    if not number.is_finite():
        raise ValueError("Non-finite metric")
    return number


def _units(value):
    n = _number(value)
    if n < 0 or n != n.to_integral_value():
        raise ValueError("Expected a non-negative whole number of ordered units")
    return int(n.quantize(Decimal("1")))


def _display(number):
    rounded = number.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return format(rounded if rounded else abs(rounded), "f")


@dataclass(frozen=True)
class _Totals:
    units: int
    turnover: Decimal
    spend: Decimal
    remaining_with: Decimal
    remaining_without: Decimal

    def combine(self, other):
        return _Totals(
            self.units + other.units,
            self.turnover + other.turnover,
            self.spend + other.spend,
            self.remaining_with + other.remaining_with,
            self.remaining_without + other.remaining_without,
        )

    def result(self):
        return {
            "ordered_units": self.units,
            "original_turnover_rub": _display(self.turnover),
            "advertising_rub": _display(self.spend),
            "remaining_with_rub": _display(self.remaining_with),
            "remaining_without_rub": _display(self.remaining_without),
            "drr_percent": _display(self.spend * 100 / self.turnover) if self.turnover else None,
        }


def _snapshot(archive, pattern, source):
    depth = len(PurePosixPath(pattern).parts)
    matches = []
    for entry in archive.infolist():
        path = PurePosixPath(entry.filename)
        if len(path.parts) == depth and path.match(pattern):
            matches.append(entry)
    if len(matches) != 1:
        raise ValueError(f"Expected one {source} snapshot for the requested date")
    with archive.open(matches[0]) as stream:
        record = json.load(stream, parse_float=Decimal)
    if not isinstance(record, dict):
        raise ValueError(f"Invalid {source} snapshot")
    return record


def _ozon(snapshot, day):
    if snapshot["schema"] != "ozon-paired-statistics/v1" or snapshot["report_date"] != day:
        raise ValueError("Unexpected Ozon snapshot version or date")
    rows = snapshot["rows"]
    remaining = rows["Остаётся до налога"]
    return _Totals(
        _units(snapshot["ordered_units"]),
        _number(rows["Оборот"]["without_coefficient_total_unrounded"]),
        _number(snapshot["advertising_totals"]["spend_RUB_unrounded"]),
        _number(remaining["with_coefficient_total_unrounded"]),
        _number(remaining["without_coefficient_total_unrounded"]),
    )


def _wb_advertising(ads, posted):
    missing = ads.get("missing_stats_campaign_ids")
    count = None
    if missing is not None:
        if not isinstance(missing, list) or any(
            type(value) not in (int, str) or not str(value).strip() for value in missing
        ):
            raise ValueError("Invalid WB campaign coverage")
        count = len({str(value) for value in missing})

    operational = ads["operational_rub"]
    if operational is None:
        gap = None
        coverage = "unavailable"
    else:
        operational = _number(operational)
        gap = _display(posted - operational)
        if count is None:
            coverage = "unknown"
        else:
            coverage = "partial" if count else "reported_complete"
    return {
        "posted_rub": _display(posted),
        "operational_rub": None if operational is None else _display(operational),
        "posted_minus_operational_rub": gap,
        "operational_coverage": coverage,
        "missing_campaign_count": count,
    }


def _wb(snapshot, day):
    if snapshot["version"] != "wb-formula-semantics-r16" or snapshot["date"] != day:
        raise ValueError("Unexpected WB snapshot version or date")
    profit = snapshot["paired_statistics"]["profit"]
    ads = snapshot["advertising"]
    posted = _number(ads["posted_rub"])
    totals = _Totals(
        _units(snapshot["ordered_units"]),
        _number(snapshot["ordered_original_rub"]),
        posted,
        _number(profit["total_with"]),
        _number(profit["total_without"]),
    )
    return totals, _wb_advertising(ads, posted)


def read_report(path, expected_day):
    """Return the aggregate metrics for an ISO date from its two source snapshots."""
    if not isinstance(expected_day, str) or date.fromisoformat(expected_day).isoformat() != expected_day:
        raise ValueError("Expected an ISO calendar date")
    try:
        with ZipFile(path) as archive, localcontext() as context:
            context.prec = 60
            ozon_record = _snapshot(archive, f"*/snapshots/{expected_day}/*/UNIT_ECONOMICS.json", "Ozon")
            wb_record = _snapshot(archive, f"WB/snapshots/*/{expected_day}.json", "WB")
            ozon = _ozon(ozon_record, expected_day)
            wb, advertising = _wb(wb_record, expected_day)
            return {
                "date": expected_day,
                "ozon": ozon.result(),
                "wb": wb.result(),
                "combined": ozon.combine(wb).result(),
                "wb_advertising": advertising,
            }
    except (BadZipFile, OSError, EOFError, RuntimeError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("Unreadable archived marketplace report") from exc
    except (KeyError, TypeError, AttributeError, DecimalException) as exc:
        raise ValueError("Missing or invalid archived marketplace metrics") from exc
