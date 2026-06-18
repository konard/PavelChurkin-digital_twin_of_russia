from __future__ import annotations

import io

from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.vacancies_service import VacancyService
from backend.etl.vacancies import (
    REFRESH_INTERVAL_HOURS,
    iter_vacancies,
    stream_remote_lines,
)

client = TestClient(app)

SAMPLE_CSV = "\n".join(
    [
        "id;profession;employer;region;latitude;longitude;salary_from;salary_to;currency",
        "vac-1;Python-разработчик;ООО Тест;Москва;55.75;37.61;180000;220000;RUB",
        "vac-2;Водитель;МУП Парк;Казань;55.79;49.10;70000;90000;RUB",
        "vac-3;Python-разработчик;АО Софт;Казань;55.80;49.12;150000;200000;RUB",
    ]
)


def test_iter_vacancies_streams_rows_and_maps_header() -> None:
    vacancies = list(iter_vacancies(SAMPLE_CSV.splitlines()))

    assert len(vacancies) == 3
    assert vacancies[0].profession == "Python-разработчик"
    assert vacancies[0].region == "Москва"
    assert vacancies[0].has_point


def test_iter_vacancies_filters_by_profession_and_limit() -> None:
    python_only = list(iter_vacancies(SAMPLE_CSV.splitlines(), profession="python", limit=1))

    assert len(python_only) == 1
    assert python_only[0].profession == "Python-разработчик"


def test_stream_remote_lines_decodes_windows_1251() -> None:
    # Реальная выгрузка «Работа России» отдаётся в windows-1251; поток должен
    # корректно декодировать кириллицу (issue #17).
    payload = "id;profession\nvac-1;Инженер-строитель\n".encode("cp1251")

    def fake_opener(_request: object) -> io.BytesIO:
        return io.BytesIO(payload)

    lines = list(
        stream_remote_lines("https://example.test/v.csv", opener=fake_opener, encoding="cp1251")
    )
    assert lines[0].startswith("id;profession")
    assert "Инженер-строитель" in "".join(lines)


def test_stream_remote_lines_replaces_undecodable_bytes() -> None:
    # Если кодировка не совпала, errors="replace" не даёт потоку оборваться
    # ошибкой декодирования (issue #17): мы получаем строки, а не исключение.
    payload = "id;profession\nvac-1;Инженер\n".encode("cp1251")

    def fake_opener(_request: object) -> io.BytesIO:
        return io.BytesIO(payload)

    lines = list(
        stream_remote_lines("https://example.test/v.csv", opener=fake_opener, encoding="utf-8")
    )
    assert lines  # поток не упал, строки разобраны


def test_demo_service_builds_geojson_and_top_professions(tmp_path) -> None:
    csv_path = tmp_path / "vacancies.csv"
    csv_path.write_text(SAMPLE_CSV, encoding="utf-8")
    service = VacancyService(csv_path)

    collection = service.geojson()
    assert collection["type"] == "FeatureCollection"
    assert len(collection["features"]) == 3
    assert collection["features"][0]["geometry"]["type"] == "Point"

    top = service.top_professions(limit=5)
    assert top[0] == {"profession": "Python-разработчик", "count": 2}

    filtered = service.geojson(profession="водитель")
    assert len(filtered["features"]) == 1


def test_geojson_paginates_with_offset_and_limit(tmp_path) -> None:
    # Постраничная выдача обеспечивает инкрементальную догрузку на фронте:
    # клиент листает страницы, пока не наберёт ``total`` (issue #17).
    csv_path = tmp_path / "vacancies.csv"
    csv_path.write_text(SAMPLE_CSV, encoding="utf-8")
    service = VacancyService(csv_path)

    first = service.geojson(offset=0, limit=2)
    assert first["total"] == 3
    assert first["offset"] == 0
    assert first["returned"] == 2
    assert len(first["features"]) == 2

    second = service.geojson(offset=2, limit=2)
    assert second["total"] == 3
    assert second["returned"] == 1
    assert len(second["features"]) == 1

    # Склейка страниц должна покрыть весь набор без потерь и дублей.
    ids = [f["properties"]["id"] for f in first["features"] + second["features"]]
    assert ids == ["vac-1", "vac-2", "vac-3"]

    # Offset за пределами набора — пустая страница, но total прежний.
    empty = service.geojson(offset=10, limit=2)
    assert empty["total"] == 3
    assert empty["returned"] == 0
    assert empty["features"] == []


def test_vacancies_endpoint_returns_points() -> None:
    response = client.get("/api/v1/vacancies")

    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "FeatureCollection"
    assert len(body["features"]) > 0
    props = body["features"][0]["properties"]
    assert "profession" in props and "employer" in props


def test_vacancies_endpoint_paginates() -> None:
    # Эндпоинт возвращает метаданные постраничной выдачи и режет набор по
    # offset/limit, что позволяет фронту догружать слой порциями (issue #17).
    full = client.get("/api/v1/vacancies").json()
    total = full["total"]
    assert total == full["returned"] == len(full["features"])

    page = client.get("/api/v1/vacancies", params={"offset": 0, "limit": 5})
    assert page.status_code == 200
    body = page.json()
    assert body["total"] == total
    assert body["offset"] == 0
    assert body["returned"] == min(5, total)
    assert len(body["features"]) == min(5, total)


def test_vacancies_endpoint_rejects_negative_offset() -> None:
    response = client.get("/api/v1/vacancies", params={"offset": -1})

    assert response.status_code == 422


def test_vacancies_profession_filter_endpoint() -> None:
    response = client.get("/api/v1/vacancies", params={"profession": "Python-разработчик"})

    assert response.status_code == 200
    professions = {feature["properties"]["profession"] for feature in response.json()["features"]}
    assert professions == {"Python-разработчик"}


def test_top_professions_endpoint_sorted_desc() -> None:
    response = client.get("/api/v1/vacancies/professions")

    assert response.status_code == 200
    counts = [row["count"] for row in response.json()]
    assert counts == sorted(counts, reverse=True)


def test_vacancies_meta_reports_refresh_interval() -> None:
    response = client.get("/api/v1/vacancies/meta")

    assert response.status_code == 200
    meta = response.json()
    assert meta["refresh_interval_hours"] == REFRESH_INTERVAL_HOURS == 36
    assert meta["incremental_param"] == "modifiedFrom"
    assert "vacancy.csv" in meta["source_csv_url"]
