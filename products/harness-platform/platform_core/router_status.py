"""Operator-visible health events. Persist only categories and times."""
import hashlib
import time

SCHEMA = """CREATE TABLE IF NOT EXISTS openrouter_health (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1), key_id TEXT NOT NULL,
    checked_at INTEGER NOT NULL, stage TEXT NOT NULL, detail TEXT NOT NULL,
    catalog_at INTEGER, generated_at INTEGER)"""

def fingerprint(key):
    return hashlib.sha256(key.encode()).hexdigest()

def note(router, key, stage, detail, success=False):
    if not key or key != router.credential():
        return
    now = int(time.time())
    with router.identity._write() as db:
        db.execute("""INSERT INTO openrouter_health VALUES(1,?,?,?,?,?,?)
            ON CONFLICT(singleton) DO UPDATE SET key_id=excluded.key_id, checked_at=excluded.checked_at,
            stage=excluded.stage,detail=excluded.detail,
            catalog_at=COALESCE(excluded.catalog_at,CASE WHEN key_id=excluded.key_id THEN catalog_at END),
            generated_at=COALESCE(excluded.generated_at,CASE WHEN key_id=excluded.key_id THEN generated_at END)""",
            (fingerprint(key),now,stage,detail,now if success and stage=='catalog' else None,
             now if success and stage=='generation' else None))

def read(router):
    with router.identity._lock:
        row=router.identity._db.execute("SELECT checked_at,stage,detail,catalog_at,generated_at FROM openrouter_health WHERE key_id=?",
                                        (fingerprint(router.credential()),)).fetchone()
    return dict(zip(('checkedAt','stage','detail','catalogAt','generatedAt'),row)) if row else {}

def refusal(status):
    return {401:"Провайдер отклонил ключ.",403:"Провайдер ограничил доступ к этой модели.",
            402:"На счёте провайдера недостаточно средств.",404:"Модель больше недоступна.",
            429:"Модель занята. Ожидаем повторной попытки."}.get(status,"Провайдер не выполнил запрос.")
