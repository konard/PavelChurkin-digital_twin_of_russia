from __future__ import annotations

from typing import Protocol

from fastapi import HTTPException, status


class OpenContourItem(Protocol):
    contour: str
    pii_status: str
    k_anonymity: int | None


def require_open_contour(item: OpenContourItem) -> None:
    if item.contour != "open":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="В v0.1 включён только открытый контур.",
        )
    if item.pii_status in {"aggregated", "anonymized"} and (item.k_anonymity or 0) < 5:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Данные открытого контура должны удовлетворять условию k-анонимности >= 5.",
        )


def require_write_role(role: str) -> None:
    if role == "guest":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Гостевой демо-режим доступен только для чтения. Зарегистрируйтесь для запуска сценариев или создания API-ключей.",
        )
