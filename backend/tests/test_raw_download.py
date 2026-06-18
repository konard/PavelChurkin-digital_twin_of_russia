from __future__ import annotations

from fastapi.testclient import TestClient

from backend.app.main import app, store

client = TestClient(app)


def test_guest_cannot_download_raw_dataset() -> None:
    response = client.get("/api/v1/catalog/datasets/osm-geofabrik/download")

    assert response.status_code == 403
    assert "оператор" in response.json()["detail"].lower()


def test_non_operator_role_cannot_download_raw_dataset() -> None:
    response = client.get(
        "/api/v1/catalog/datasets/osm-geofabrik/download",
        headers={"X-Role": "citizen", "X-Actor": "user@example.test"},
    )

    assert response.status_code == 403


def test_operator_downloads_object_based_csv() -> None:
    response = client.get(
        "/api/v1/catalog/datasets/osm-geofabrik/download",
        headers={"X-Role": "operator", "X-Actor": "ops@example.test"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment" in response.headers["content-disposition"]
    body = response.text
    # CSV начинается с UTF-8 BOM, чтобы Excel не превращал кириллицу в
    # «кракозябры» (issue #17); сразу за BOM идёт заголовок.
    assert body.startswith("﻿")
    assert body.lstrip("﻿").startswith("id;name;object_type;region;oktmo;lon;lat")
    assert store.audit_log.verify_chain()


def test_operator_downloads_vacancies_raw_csv() -> None:
    response = client.get(
        "/api/v1/catalog/datasets/trudvsem-opendata/download",
        headers={"X-Role": "operator", "X-Actor": "ops@example.test"},
    )

    assert response.status_code == 200
    assert "vacancies" in response.headers["content-disposition"]
    assert "profession" in response.text.splitlines()[0]


def test_downloaded_csv_starts_with_utf8_bom() -> None:
    # BOM нужен во всех ветках выгрузки: вакансии, объекты, паспорт датасета —
    # иначе Excel под Windows читает UTF-8 как windows-1251 (issue #17).
    for dataset_id in ("trudvsem-opendata", "osm-geofabrik"):
        response = client.get(
            f"/api/v1/catalog/datasets/{dataset_id}/download",
            headers={"X-Role": "operator", "X-Actor": "ops@example.test"},
        )
        assert response.status_code == 200
        # Сырые байты должны начинаться именно с UTF-8 BOM (EF BB BF).
        assert response.content.startswith(b"\xef\xbb\xbf")
        # И не задваиваться при повторном применении.
        assert not response.content[3:].startswith(b"\xef\xbb\xbf")


def test_operator_download_unknown_dataset_returns_404() -> None:
    response = client.get(
        "/api/v1/catalog/datasets/does-not-exist/download",
        headers={"X-Role": "operator"},
    )

    assert response.status_code == 404
