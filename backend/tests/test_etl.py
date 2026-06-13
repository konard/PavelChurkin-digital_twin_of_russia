from __future__ import annotations

from datetime import date

from backend.etl.base import CsvSource, SourceMetadata


def test_csv_source_supports_windows_1251_and_builds_passport() -> None:
    payload = "ОКТМО,value\n45000000,42\n".encode("cp1251")
    source = CsvSource(
        SourceMetadata(
            id="synthetic-csv",
            title="Синтетический CSV",
            domain="statistics",
            region="Москва",
            owner="тест",
            source="unit-test",
            source_url="https://example.test/source.csv",
            license="тестовая-лицензия",
            update_frequency="monthly",
            classifier_alignment=["ОКТМО"],
            known_limitations=["Синтетический тестовый фикстур."],
        ),
        payload=payload,
    )

    rows = source.parse(source.fetch())
    records = source.normalize(rows)
    passport = source.build_passport(source_version=date(2026, 6, 1))

    assert rows == [{"ОКТМО": "45000000", "value": "42"}]
    assert records[0]["classifier_codes"]["oktmo"] == "45000000"
    assert records[0]["contour"] == "open"
    assert passport.source_version.isoformat() == "2026-06-01"
    assert passport.known_limitations == ["Синтетический тестовый фикстур."]
