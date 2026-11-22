"""Page matching descriptions while covering distinct parts of a compound request."""
from collections import Counter
from math import log
import re


def words(text):
    return {w[:5] for w in re.findall(r"[^\W_]+", text.casefold().replace("ё", "е")) if len(w) > 2}


def select_page(records, query, offset, size):
    wanted = words(query)
    titles = [words(r["purpose"].split(". ")[0]) for r in records]
    descriptions = [words(r["purpose"] + " " + r["id"]) for r in records]
    frequency = Counter(w for vector in descriptions for w in vector)
    weights = {w: log(1 + len(records) / n) for w, n in frequency.items() if w in wanted}
    matches = []
    for row, title, description in zip(records, titles, descriptions):
        hits = wanted & description
        score = sum(weights[w] * (2 if w in title else 1) for w in hits)
        # A catalogue entry's short title may describe just one of several
        # requested measures. Ensure exact title matches are represented.
        if title and title <= wanted:
            score += sum(weights[w] for w in title)
        if query.strip() == row["id"]:
            score += 100
        if score:
            matches.append((row, hits, score))
    ranked = []
    seen = set()
    while matches and len(ranked) < offset + size:
        def priority(candidate):
            row, hits, score = candidate
            extra = sum(weights[w] for w in hits - seen)
            return -(score + 1.5 * extra), row["id"]
        index = min(range(len(matches)), key=lambda i: priority(matches[i]))
        row, hits, _ = matches.pop(index)
        ranked.append(row)
        seen.update(hits)
    return ranked[offset:offset + size], offset + size if matches else None
