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
            detail="Only the open contour is enabled in v0.1.",
        )
    if item.pii_status in {"aggregated", "anonymized"} and (item.k_anonymity or 0) < 5:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Open-contour data must satisfy k-anonymity >= 5.",
        )


def require_write_role(role: str) -> None:
    if role == "guest":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Guest demo mode is read-only. Register to run scenarios or create API keys.",
        )
