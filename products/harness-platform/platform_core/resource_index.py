"""Page a provider's published operation descriptions without loading its whole schema."""
from collections import Counter
from math import log
import re


def words(text):
    return {w[:5] for w in re.findall(r"[^\W_]+", text.casefold().replace("ё", "е")) if len(w) > 2}


def select_page(records, query, offset, size):
    wanted = words(query)
    vectors = [words(r["purpose"].split(". ")[0] + " " + r["id"]) for r in records]
    counts = Counter(w for v in vectors for w in v)
    ranked = []
    for record, vector in zip(records, vectors):
        score = sum(log(1 + len(records) / counts[w]) for w in wanted & vector)
        if query.strip() == record["id"]:
            score += 100
        if score:
            ranked.append((-score, record["id"], record))
    ranked.sort(key=lambda row: row[:2])
    return [r for _, _, r in ranked[offset:offset + size]], offset + size if offset + size < len(ranked) else None
