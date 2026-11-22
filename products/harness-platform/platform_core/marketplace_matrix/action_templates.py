"""Inspect marketplace action drafts and their documented contracts."""

import argparse
from functools import lru_cache
import json
from pathlib import Path
import re


PROFILES = ("seller", "performance", "wb")
HTTP_METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE")
STATES = {"current": "draft", "deprecated": "reference", "retired": "reference"}


@lru_cache(maxsize=1)
def cards():
    rows = json.loads(Path(__file__).with_name("action_templates.json").read_bytes())
    result, routes = {}, set()
    for row in rows:
        profile, method, path = row["profile"], row["http"], row["path"]
        route = (profile, method, re.sub(r"\{[^{}]+\}", "{}", path))
        if (profile not in PROFILES or method not in HTTP_METHODS or not path.startswith("/")
                or not row["id"].startswith(f"action.{profile}.")
                or row["state"] != STATES.get(row["lifecycle"])):
            raise ValueError(f"Invalid marketplace action template: {row['id']}")
        if row["id"] in result or route in routes:
            raise ValueError(f"Duplicate marketplace action template: {row['id']}")
        result[row["id"]] = row
        routes.add(route)
    return result


def catalogue(*, profile=None, method=None, query="", include_reference=False):
    words = query.casefold().split()
    matches = []
    for row in cards().values():
        if (profile and row["profile"] != profile) or (method and row["http"] != method):
            continue
        if not include_reference and row["state"] == "reference":
            continue
        searchable = " ".join(row[field] for field in ("id", "path", "purpose", "category")).casefold()
        if all(word in searchable for word in words):
            matches.append(row)
    return matches


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", choices=PROFILES)
    parser.add_argument("--method", type=str.upper, choices=HTTP_METHODS)
    parser.add_argument("--query", default="")
    parser.add_argument("--id", help="Look up a template by its exact ID, including reference versions")
    parser.add_argument("--include-reference", action="store_true")
    args = parser.parse_args()
    if args.id:
        if args.profile or args.method or args.query or args.include_reference:
            parser.error("--id must be used without catalogue filters")
        result = cards().get(args.id)
        if result is None:
            parser.error("unknown marketplace action template ID")
    else:
        result = catalogue(profile=args.profile, method=args.method, query=args.query,
                           include_reference=args.include_reference)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2))


if __name__ == "__main__":
    main()
