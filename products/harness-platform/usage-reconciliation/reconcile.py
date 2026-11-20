"""Reconcile an immutable snapshot of a native gateway JSONL journal offline."""

import argparse
from decimal import DecimalException, localcontext
import json
from pathlib import Path
import sys

# Keep the historical CLI path usable from any working directory.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from platform_core.usage_reconciliation import attribution_summary, index_journal, read_tariffs, reconcile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("journal", type=Path)
    parser.add_argument("--tariffs", type=Path, required=True)
    parser.add_argument("--by-operation", action="store_true",
                        help="include operator-only workspace and operation cost summaries")
    args = parser.parse_args()
    with localcontext() as context:
        context.prec = 256
        try:
            tariffs = read_tariffs(args.tariffs)
        except (OSError, ValueError, DecimalException, RecursionError):
            print("Invalid or unreadable tariff manifest.", file=sys.stderr)
            return 2
        try:
            attempts, duplicates = index_journal(args.journal)
        except OSError:
            print("Unable to read journal.", file=sys.stderr)
            return 2
        except ValueError as exc:
            print(str(exc), file=sys.stderr)
            return 2
        report = reconcile(attempts, duplicates, tariffs)
        if args.by_operation:
            attribution = attribution_summary(attempts, tariffs)
            report["attribution"] = attribution
            if attribution["status"] == "partial":
                report["status"] = "partial"
    print(json.dumps(report, sort_keys=True))
    return 0 if report["status"] == "complete" else 1


if __name__ == "__main__":
    sys.exit(main())
