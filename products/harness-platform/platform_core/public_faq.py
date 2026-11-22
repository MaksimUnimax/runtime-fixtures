"""Shared public product information. Replies use only the local FAQ database."""

import json
import re
import sqlite3
from pathlib import Path


class PublicFAQ:
    def __init__(self, path):
        self._db = sqlite3.connect(path or ":memory:", check_same_thread=False)
        try:
            with self._db:
                self._db.execute("""CREATE TABLE IF NOT EXISTS public_faq (
                    topic TEXT PRIMARY KEY, answer TEXT NOT NULL, patterns TEXT NOT NULL)""")
                cards = json.loads(Path(__file__).with_name("public_faq.json").read_text(encoding="utf-8"))
                # A published answer (including a price) survives a restart.
                self._db.executemany("INSERT OR IGNORE INTO public_faq VALUES (?,?,?)", [
                    (topic, row["answer"], json.dumps(row["patterns"], ensure_ascii=False))
                    for topic, row in cards.items()
                ])
                self._db.execute("UPDATE public_faq SET answer=? WHERE topic='price' AND answer=?",
                                 (cards["price"]["answer"], "Публичный тариф сервиса пока не опубликован."))
                self._db.execute("UPDATE public_faq SET answer=replace(answer, ?, ?) WHERE instr(answer, ?) > 0",
                                 ("«Создать аккаунт и сохранить чат»", "«Создать аккаунт»", "«Создать аккаунт и сохранить чат»"))
                self._db.executemany("UPDATE public_faq SET answer=? WHERE topic=? AND answer=?", [
                    (card["answer"], topic, previous)
                    for topic, card in cards.items()
                    for previous in card.get("previous_answers", [card.get("previous_answer")])
                    if previous is not None
                ])
                # Merge new expressions into published cards without replacing editorial changes.
                row = self._db.execute("SELECT patterns FROM public_faq WHERE topic='features'").fetchone()
                merged = list(dict.fromkeys([*json.loads(row[0]), *cards["features"]["patterns"]]))
                self._db.execute("UPDATE public_faq SET patterns=? WHERE topic='features' AND patterns<>?",
                                 (json.dumps(merged, ensure_ascii=False),json.dumps(merged, ensure_ascii=False)))
            if path is not None:
                self._db.close()
                self._db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro",
                                           uri=True, check_same_thread=False)
            self._db.execute("PRAGMA query_only=ON")
        except BaseException:
            self.close()
            raise

    def close(self):
        self._db.close()

    def answer(self, message):
        text = " ".join(re.findall(r"[^\W_]+", message.casefold().replace("ё", "е")))
        text = re.sub(r"^(?:(?:здравствуйте|привет|добрый день|подскажите|скажи|пожалуйста) )+", "", text)
        text = text.removesuffix(" пожалуйста")
        matches = []
        fallback = self._db.execute("SELECT answer FROM public_faq WHERE topic='scope'").fetchone()[0]
        for topic, answer, patterns in self._db.execute("SELECT topic, answer, patterns FROM public_faq WHERE topic!='scope'"):
            if any(re.fullmatch(pattern, text) for pattern in json.loads(patterns)):
                if topic == "features":
                    from .octopus_knowledge import published
                    titles = ", ".join(card["title"] for card in published())
                    answer += " Я Октопус. В моём каталоге сейчас есть " + titles + "."
                matches.append(answer)
        if not matches and re.search(r"плагин|интеграц|подключить", text):
            from .octopus_knowledge import published
            cards = published()
            specific = [c for c in cards if c["title"].casefold() in text or
                        any(w in text.split() for w in c.get("keywords", "").split())]
            if specific or re.search(r"(?:какие|список|все).*(?:плагин|интеграц)", text):
                selected = specific or cards
                if not specific:
                    group = "Интеграции" if "интеграц" in text else "Плагины"
                    selected = [c for c in cards if c["group"] == group] or cards
                def detail(card):
                    steps = card["steps"]
                    if "подключ" in text:
                        ordered = steps if isinstance(steps, list) else [s for group in steps.values() for s in group]
                        return card["title"] + " — " + " ".join(dict.fromkeys(ordered))
                    return card["title"] + " — " + card["purpose"]
                return "В Октопорте доступны " + ". ".join(detail(c) for c in selected) + ". Для подключения войдите в свой аккаунт."
        return matches[0] if len(matches) == 1 else fallback
