from __future__ import annotations


class APIError(Exception):
    def __init__(
        self,
        code: str,
        status: int,
        message: str,
        details: list[dict[str, str]] | None = None,
    ):
        self.code = code
        self.status = status
        self.message = message
        self.details = details or []
