"""Ozon rate limits shared by catalogue aliases, scoped reads and seller profiles."""
from dataclasses import dataclass
from math import ceil, isfinite


DEFAULT_SECONDS = 7
SENDING_NOTICE = "Запрашиваю данные у Ozon."
RECEIVED_NOTICE = "Данные от Ozon получены. Продолжаю готовить ответ."


def wait_duration(seconds):
    if seconds % 60 == 0:
        count, forms = seconds // 60, ("минуту", "минуты", "минут")
    else:
        count, forms = seconds, ("секунду", "секунды", "секунд")
    if 11 <= count % 100 <= 14:
        form = forms[2]
    elif count % 10 == 1:
        form = forms[0]
    elif 2 <= count % 10 <= 4:
        form = forms[1]
    else:
        form = forms[2]
    return f"{count} {form}"


@dataclass(frozen=True)
class Retry:
    due: float
    seconds: int
    from_header: bool

    def waiting(self):
        if not self.from_header:
            return "Озон говорит что занят, пробую еще раз"
        if not self.seconds:
            return "Ozon разрешил повторить запрос сразу. Снова запрошу данные."
        return f"Ozon просит подождать {wait_duration(self.seconds)}. Затем я снова запрошу данные."


def plan(retry_at, now):
    if retry_at is not None and isfinite(retry_at):
        return Retry(max(now, retry_at), max(0, ceil(retry_at - now)), True)
    return Retry(now + DEFAULT_SECONDS, DEFAULT_SECONDS, False)


def retry_due(repo, row, request, error):
    retry = error.ozon_retry
    # Replace only the normal spacing reservation made by this failed call.
    # A later reservation or a longer independent provider wait must still win.
    with repo.connection(True) as db:
        db.execute("""UPDATE rates SET not_before=? WHERE source=? AND not_before=(
            SELECT at+? FROM calls WHERE id=(SELECT MAX(id) FROM calls WHERE source=?)
            AND jid=? AND http=429) AND not_before>?""",
            (retry.due, request.source, request.interval, request.source, row["id"], retry.due))
    return retry.due
