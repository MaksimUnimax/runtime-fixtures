"""Ozon rate limits shared by catalogue aliases, scoped reads and seller profiles."""
from dataclasses import dataclass
from math import ceil, isfinite
from urllib.parse import urlsplit


DEFAULT_SECONDS = 7


def endpoint(operation):
    if operation.startswith("read.ozon."):
        from read_surface import method
        return method("ozon", operation.split(".", 2)[2]).get("wire_url") or ""
    from http_transport import MATRICES
    return MATRICES[operation].recipe(operation)["url"]


@dataclass(frozen=True)
class Retry:
    due: float
    seconds: int
    from_header: bool
    label: str

    def waiting(self, number):
        if self.from_header:
            cause = f"Ozon разрешил повтор через {self.seconds} с."
        else:
            cause = f"Срок ожидания не указан. Повторю через {self.seconds} с."
        return f"Ozon вернул HTTP 429 ({self.label}). {cause} Ожидаю повтор №{number}."

    def sending(self, number):
        return f"Повтор №{number}. Отправляю запрос в Ozon ({self.label})."


def plan(url, retry_at, now):
    # Labels come exclusively from the static method catalogue, never a resolved file URL.
    label = urlsplit(url).path or "получение файла"
    if retry_at is not None and isfinite(retry_at):
        return Retry(max(now, retry_at), max(0, ceil(retry_at - now)), True, label)
    return Retry(now + DEFAULT_SECONDS, DEFAULT_SECONDS, False, label)


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
