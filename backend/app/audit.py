from __future__ import annotations

import json
from datetime import UTC, datetime
from hashlib import sha256

from backend.app.schemas import AuditEntry, Contour, Role


class AuditLog:
    """Журнал аудита только для добавления с хеш-цепочкой для демо v0.1."""

    def __init__(self) -> None:
        self._entries: list[AuditEntry] = []

    @property
    def entries(self) -> list[AuditEntry]:
        return list(self._entries)

    @staticmethod
    def _entry_payload(entry: AuditEntry) -> dict:
        return {
            "index": entry.index,
            "timestamp": entry.timestamp.isoformat(),
            "actor": entry.actor,
            "role": entry.role,
            "action": entry.action,
            "contour": entry.contour,
            "target_id": entry.target_id,
            "data_versions": entry.data_versions,
            "previous_hash": entry.previous_hash,
        }

    def append(
        self,
        *,
        actor: str,
        role: Role,
        action: str,
        contour: Contour,
        target_id: str,
        data_versions: dict[str, str],
    ) -> AuditEntry:
        previous_hash = self._entries[-1].hash if self._entries else "0" * 64
        entry = AuditEntry(
            index=len(self._entries),
            timestamp=datetime.now(UTC),
            actor=actor,
            role=role,
            action=action,
            contour=contour,
            target_id=target_id,
            data_versions=data_versions,
            previous_hash=previous_hash,
            hash="",
        )
        payload = self._entry_payload(entry)
        entry.hash = sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()
        self._entries.append(entry)
        return entry

    def verify_chain(self) -> bool:
        previous_hash = "0" * 64
        for entry in self._entries:
            payload = self._entry_payload(entry)
            if payload["previous_hash"] != previous_hash:
                return False
            calculated = sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()
            if calculated != entry.hash:
                return False
            previous_hash = entry.hash
        return True
