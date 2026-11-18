"""Public, deliberately non-reflective lab failures."""
from __future__ import annotations


class LabError(Exception):
    def __init__(self, code: str, message: str = "Запрос не выполнен.", *, unknown: bool = False,
                 retry_after: int | None = None, provider_code: int | str | None = None,
                 provider_reason: str | None = None):
        self.code, self.message = code, message
        self.unknown, self.retry_after = unknown, retry_after
        self.provider_code, self.provider_reason = provider_code, provider_reason
        super().__init__(code)

    def public(self) -> dict:
        return {"code": self.code, "message": self.message,
                "outcome_unknown": self.unknown,
                **({"provider_code": self.provider_code} if self.provider_code is not None else {}),
                **({"provider_reason": self.provider_reason} if self.provider_reason is not None else {}),
                **({"retry_after_seconds": self.retry_after} if self.retry_after is not None else {})}
