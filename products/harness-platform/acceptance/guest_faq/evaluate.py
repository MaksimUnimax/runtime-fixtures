"""Offline lexical baseline for the guest design. Run with Python and SQLite FTS5."""

import json
import math
import re
import sqlite3
from collections import Counter
from pathlib import Path


def normalize(text):
    words = re.findall(r"[^\W_]+", text.casefold().replace("ё", "е"))
    return " ".join(words)


def grams(text):
    return {word[i:i + 3] for word in text.split() for i in range(len(word) - 2)}


def lookup(db, raw, weights):
    text = normalize(raw)
    exact = db.execute("SELECT card FROM phrases WHERE text=?", (text,)).fetchone()
    if exact:
        return exact[0]
    features = grams(text)
    if not features:
        return "clarify"
    # Index pre-tokenized trigrams, including overlapping ones, to tolerate inflections.
    match = " OR ".join('"' + g + '"' for g in sorted(features))
    rows = db.execute("""SELECT phrases.card, phrases.text FROM idx
        JOIN phrases ON phrases.rowid=idx.rowid WHERE idx MATCH ? ORDER BY rank LIMIT 12""", (match,))
    scores = {}
    for card, phrase in rows:
        candidate = grams(phrase)
        common = sum(weights.get(g, 1) for g in features & candidate)
        size = math.sqrt(sum(weights.get(g, 1) for g in features) * sum(weights[g] for g in candidate))
        scores[card] = max(scores.get(card, 0), common / size)
    ranked = sorted(scores, key=scores.get, reverse=True)
    if not ranked:
        return "clarify"
    best = scores[ranked[0]]
    runner_up = scores[ranked[1]] if len(ranked) > 1 else 0
    return ranked[0] if best >= 0.54 and best - runner_up >= 0.09 else "clarify"


def has_signal(text, signal):
    # A stem must start at a word boundary. A marketplace name alone grants no topic.
    return any(text.startswith(signal, start.start()) for start in re.finditer(r"\b\w", text))


def route(db, raw, weights, cards, config, previous=None):
    text = normalize(raw)
    hits = {key for key, card in cards.items() if any(has_signal(text, s) for s in card["signals"])}
    outside = {key for key in hits if cards[key]["kind"] == "decline"}
    positive = hits - outside
    if outside:
        return "mixed" if positive else "decline"
    prior = cards.get(previous, {})
    candidate = lookup(db, raw, weights)
    if candidate in positive and cards[candidate].get("onboarding"):
        return candidate
    if positive or prior:
        if any(has_signal(text, marker) for marker in config["private_markers"]):
            return "personal"
    if prior and any(text.startswith(start + " ") for start in config["followups"]):
        words = text.split()
        if len(words) <= 4 and words[-1] in config["marketplaces"]:
            platform = config["marketplaces"][words[-1]]
            return prior.get("followups", {}).get(platform, "clarify")
    if candidate in positive:
        return candidate
    if positive or len(text.split()) <= 3 or text.startswith(("сколько", "объясни")):
        return "clarify"
    return "decline"


def main():
    fixture = json.loads(Path(__file__).with_name("catalog.json").read_text(encoding="utf-8"))
    kinds = {card["id"]: card["kind"] for card in fixture["cards"]}
    cards = {card["id"]: card for card in fixture["cards"]}
    config = fixture["public_context"]
    frequencies = Counter()
    db = sqlite3.connect(":memory:")
    try:
        db.execute("CREATE TABLE published(card TEXT PRIMARY KEY, answer TEXT NOT NULL)")
        db.execute("CREATE TABLE phrases(card TEXT, text TEXT UNIQUE)")
        db.execute("CREATE VIRTUAL TABLE idx USING fts5(features)")
        for card in fixture["cards"]:
            db.execute("INSERT INTO published VALUES (?,?)", (card["id"], card["answer"]))
            for alias in card["phrases"]:
                normalized = normalize(alias)
                row = db.execute("INSERT INTO phrases VALUES (?,?)", (card["id"], normalized))
                features = grams(normalized)
                frequencies.update(features)
                db.execute("INSERT INTO idx(rowid,features) VALUES (?,?)", (row.lastrowid, " ".join(sorted(features))))
        count = db.execute("SELECT COUNT(*) FROM phrases").fetchone()[0]
        weights = {g: 1 + math.log((1 + count) / (1 + n)) for g, n in frequencies.items()}
        for name in ("search", "with_scope"):
            correct = 0
            for text, expected in fixture["cases"]:
                if name == "search":
                    actual = lookup(db, text, weights)
                else:
                    actual = route(db, text, weights, cards, config)
                # Decline/personal identify the route; exact FAQ and demo IDs identify the answer.
                expected_route = kinds.get(expected, expected)
                ok = (actual == expected or kinds.get(actual) == expected or
                      (expected_route in {"decline", "personal"} and actual == expected_route))
                correct += ok
                print(f"{name}: {'OK' if ok else 'MISS'} | {expected} | {actual} | {text}")
            print(f"{name}: {correct}/{len(fixture['cases'])} expected routes.")
        context_score = 0
        for case in fixture["context_cases"]:
            actual = route(db, case["text"], weights, cards, config, previous=case["previous"])
            context_score += actual == case["expected"]
            print(f"context: {case['previous']} | {case['text']} | {actual}")
        print(f"context: {context_score}/{len(fixture['context_cases'])} expected routes.")
        for prompt in ("Как посчитать долю рекламных расходов на WB?", "Заказы те же, а денег стало меньше"):
            key = route(db, prompt, weights, cards, config)
            answer = db.execute("SELECT answer FROM published WHERE card=?", (key,)).fetchone()
            print(f"{prompt} -> {answer[0] if answer else key}")
        print("External model calls: 0")
    finally:
        db.close()


if __name__ == "__main__":
    main()
