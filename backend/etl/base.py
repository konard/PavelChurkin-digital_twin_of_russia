from __future__ import annotations

import csv
from abc import ABC, abstractmethod
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from io import StringIO
from typing import Any

from backend.app.schemas import DatasetPassport


class EtlError(RuntimeError):
    pass


@dataclass(frozen=True)
class SourceMetadata:
    id: str
    title: str
    domain: str
    region: str
    owner: str
    source: str
    source_url: str
    license: str
    update_frequency: str
    classifier_alignment: list[str]
    known_limitations: list[str]
    validators: list[str] = field(default_factory=lambda: ["required-passport-fields"])


class Source(ABC):
    def __init__(self, metadata: SourceMetadata) -> None:
        self.metadata = metadata

    @abstractmethod
    def fetch(self) -> bytes:
        """Возвращает необработанные байты источника."""

    @abstractmethod
    def parse(self, payload: bytes) -> Iterable[dict[str, Any]]:
        """Разбирает необработанные байты источника в записи источника."""

    def normalize(self, rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
        normalized: list[dict[str, Any]] = []
        for index, row in enumerate(rows, start=1):
            normalized.append(
                {
                    "id": f"{self.metadata.id}.{index}",
                    "source": self.metadata.source,
                    "source_version": date.today().isoformat(),
                    "license": self.metadata.license,
                    "quality_flag": "draft",
                    "owner": self.metadata.owner,
                    "classifier_codes": {
                        "oktmo": row.get("oktmo") or row.get("ОКТМО"),
                        "okved": row.get("okved") or row.get("ОКВЭД"),
                        "okz": row.get("okz") or row.get("ОКЗ"),
                    },
                    "geometry": row.get("geometry"),
                    "valid_from": row.get("valid_from") or date.today().isoformat(),
                    "valid_to": row.get("valid_to"),
                    "aggregation_level": row.get("aggregation_level", "municipality"),
                    "pii_status": row.get("pii_status", "aggregated"),
                    "contour": "open",
                    "payload": row,
                }
            )
        return normalized

    def build_passport(self, source_version: date | None = None) -> DatasetPassport:
        return DatasetPassport(
            id=self.metadata.id,
            title=self.metadata.title,
            domain=self.metadata.domain,
            region=self.metadata.region,
            owner=self.metadata.owner,
            source=self.metadata.source,
            source_url=self.metadata.source_url,
            source_version=source_version or date.today(),
            license=self.metadata.license,
            update_frequency=self.metadata.update_frequency,
            classifier_alignment=self.metadata.classifier_alignment,
            pii_status="aggregated",
            k_anonymity=10,
            known_limitations=self.metadata.known_limitations,
            validators=self.metadata.validators,
            signed_by="etl-open-contour",
            certificate_version="passport-v0.1",
            signed_at=datetime.now(UTC),
            quality_flag="draft",
            contour="open",
        )


class CsvSource(Source):
    def __init__(
        self,
        metadata: SourceMetadata,
        *,
        payload: bytes | None = None,
        encodings: tuple[str, ...] = ("utf-8-sig", "utf-8", "cp1251"),
        delimiter: str = ",",
    ) -> None:
        super().__init__(metadata)
        self.payload = payload
        self.encodings = encodings
        self.delimiter = delimiter

    def fetch(self) -> bytes:
        if self.payload is None:
            raise EtlError("Для демо CSV-источника не настроена нагрузка.")
        return self.payload

    def parse(self, payload: bytes) -> list[dict[str, Any]]:
        last_error: UnicodeDecodeError | None = None
        for encoding in self.encodings:
            try:
                text = payload.decode(encoding)
            except UnicodeDecodeError as exc:
                last_error = exc
                continue
            reader = csv.DictReader(StringIO(text), delimiter=self.delimiter)
            return [dict(row) for row in reader]
        raise EtlError(f"Не удалось декодировать CSV-нагрузку: {last_error}") from last_error
